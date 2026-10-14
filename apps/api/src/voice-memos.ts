import { randomUUID } from "node:crypto";
import {
  VOICE_MEMO_ACTION_TYPES,
  VOICE_MEMO_MAX_SECONDS,
  VOICE_MEMO_MONTHLY_MINUTES,
  hasProAccess,
  type AgentActionReceipt,
  type VoiceMemo,
  type VoiceMemoAction,
  type VoiceMemoActionType,
  type VoiceMemoListResponse,
  type VoiceMemoUsage,
} from "@nearby/shared";
import {
  createGoogleCalendarEvent,
  createGoogleTask,
  saveGmailDraft,
} from "./connectors/google-calendar.js";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";
import { isValidTimeZone } from "./timezone.js";

const MAX_MEMOS = 50;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIME_ZONE = "America/New_York";

type MemoState = {
  month: string;
  usedSeconds: number;
  memos: VoiceMemo[];
};

type ParsedRecap = {
  recap: string;
  actions: Array<{
    type: VoiceMemoActionType;
    details: Record<string, string>;
  }>;
};

export class VoiceMemoAccessError extends Error {
  constructor(
    public readonly code: "pro_required" | "voice_memo_limit",
    message: string,
  ) {
    super(message);
    this.name = "VoiceMemoAccessError";
  }
}

const localState = new Map<string, MemoState>();

export function billingMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nextMonthIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

export function assertVoiceMemoAllowed(
  plan: "free" | "pro",
  usedSeconds: number,
  requestedSeconds: number,
): void {
  if (plan !== "pro") {
    throw new VoiceMemoAccessError(
      "pro_required",
      "Voice Memo Recap is available on Pro.",
    );
  }
  if (
    !Number.isFinite(requestedSeconds) ||
    requestedSeconds <= 0 ||
    requestedSeconds > VOICE_MEMO_MAX_SECONDS
  ) {
    throw new Error("Voice memos must be between 1 second and 5 minutes.");
  }
  const capSeconds = VOICE_MEMO_MONTHLY_MINUTES * 60;
  if (usedSeconds >= capSeconds || usedSeconds + requestedSeconds > capSeconds) {
    throw new VoiceMemoAccessError(
      "voice_memo_limit",
      "You've reached this month's 300-minute voice memo limit. It resets next month.",
    );
  }
}

function cleanDetails(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const details: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    if (Object.keys(details).length >= 8) break;
    details[key.slice(0, 40)] = raw.trim().slice(0, 2000);
  }
  return details;
}

function normalizeRecap(raw: string): string | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  if (lines.length < 3 || lines.length > 5) return null;
  return lines.map((line) => `• ${line.slice(0, 280)}`).join("\n");
}

/** Strict parser for model output; exported so malformed JSON stays covered. */
export function parseVoiceMemoModelOutput(content: string): ParsedRecap | null {
  const candidate = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  if (typeof row.recap !== "string") return null;
  const recap = normalizeRecap(row.recap);
  if (!recap || !Array.isArray(row.actions)) return null;

  const actions: ParsedRecap["actions"] = [];
  for (const value of row.actions.slice(0, 8)) {
    if (!value || typeof value !== "object") return null;
    const action = value as Record<string, unknown>;
    if (
      typeof action.type !== "string" ||
      !(VOICE_MEMO_ACTION_TYPES as readonly string[]).includes(action.type)
    ) {
      return null;
    }
    const details = cleanDetails(action.details);
    if (Object.keys(details).length === 0) return null;
    actions.push({
      type: action.type as VoiceMemoActionType,
      details,
    });
  }
  return { recap, actions };
}

function emptyState(now = new Date()): MemoState {
  return { month: billingMonth(now), usedSeconds: 0, memos: [] };
}

function normalizeState(value: Record<string, unknown> | undefined): MemoState {
  const currentMonth = billingMonth();
  if (!value) return emptyState();
  const memos = Array.isArray(value.memos)
    ? (value.memos as VoiceMemo[]).slice(0, MAX_MEMOS)
    : [];
  if (value.month !== currentMonth) {
    return { month: currentMonth, usedSeconds: 0, memos };
  }
  return {
    month: currentMonth,
    usedSeconds:
      typeof value.usedSeconds === "number"
        ? Math.max(0, value.usedSeconds)
        : 0,
    memos,
  };
}

async function readState(uid: string): Promise<MemoState> {
  if (!isFirebaseConfigured()) return normalizeState(localState.get(uid));
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("voiceMemoState")
    .doc(uid)
    .get();
  return normalizeState(snap.data());
}

async function writeState(uid: string, state: MemoState): Promise<void> {
  if (!isFirebaseConfigured()) {
    localState.set(uid, state);
    return;
  }
  await getFirebaseAdmin()
    .firestore()
    .collection("voiceMemoState")
    .doc(uid)
    .set(state);
}

async function persistNewMemo(
  uid: string,
  memo: VoiceMemo,
  plan: "free" | "pro",
): Promise<MemoState> {
  if (!isFirebaseConfigured()) {
    const state = await readState(uid);
    assertVoiceMemoAllowed(plan, state.usedSeconds, memo.durationSeconds);
    state.usedSeconds += memo.durationSeconds;
    state.memos = [memo, ...state.memos].slice(0, MAX_MEMOS);
    localState.set(uid, state);
    return state;
  }

  const db = getFirebaseAdmin().firestore();
  const ref = db.collection("voiceMemoState").doc(uid);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const state = normalizeState(snap.data());
    assertVoiceMemoAllowed(plan, state.usedSeconds, memo.durationSeconds);
    state.usedSeconds += memo.durationSeconds;
    state.memos = [memo, ...state.memos].slice(0, MAX_MEMOS);
    transaction.set(ref, state);
    return state;
  });
}

async function readPlan(uid: string): Promise<"free" | "pro"> {
  if (!isFirebaseConfigured()) return "free";
  const snap = await getFirebaseAdmin().firestore().collection("users").doc(uid).get();
  return hasProAccess(snap.data() ?? {}) ? "pro" : "free";
}

function usageFor(plan: "free" | "pro", state: MemoState): VoiceMemoUsage {
  const capSeconds = VOICE_MEMO_MONTHLY_MINUTES * 60;
  return {
    plan,
    limitMinutes: VOICE_MEMO_MONTHLY_MINUTES,
    usedMinutes: Math.ceil(state.usedSeconds / 60),
    remainingMinutes: Math.max(0, Math.floor((capSeconds - state.usedSeconds) / 60)),
    month: state.month,
    resetAt: nextMonthIso(),
  };
}

async function transcribe(audio: File): Promise<{ text: string; durationSeconds: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Speech-to-text is not configured.");
  if (audio.size <= 0 || audio.size > MAX_AUDIO_BYTES) {
    throw new Error("Audio must be smaller than 25 MB.");
  }
  const form = new FormData();
  form.set("file", audio, audio.name || "memo.webm");
  form.set("model", process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1");
  form.set("response_format", "verbose_json");
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as {
    text?: string;
    duration?: number;
    error?: { message?: string };
  };
  if (!res.ok || !body.text?.trim()) {
    throw new Error(body.error?.message ?? "Could not transcribe that memo.");
  }
  return {
    text: body.text.trim().slice(0, 20_000),
    durationSeconds:
      typeof body.duration === "number" && body.duration > 0
        ? Math.ceil(body.duration)
        : 0,
  };
}

async function recapTranscript(
  transcript: string,
  timeZone: string,
): Promise<ParsedRecap> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Voice memo recaps are not configured.");
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `Turn a voice memo into a concise recap and optional follow-ups. Current time: ${new Date().toISOString()}. User timezone: ${timeZone}. ` +
            'Return JSON only: {"recap":"• bullet\\n• bullet\\n• bullet","actions":[{"type":"reminder"|"calendar_event"|"email_draft","details":{...}}]}. ' +
            "The recap must contain 3–5 useful bullets. For reminder use details {title,when}; calendar_event {title,start,end,description} with ISO timestamps; email_draft {to,subject,body}. " +
            "Do not invent recipients, dates, or commitments. Omit an action when required details are unknown. Email actions are drafts only and are never sent.",
        },
        { role: "user", content: transcript },
      ],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  const content = body.choices?.[0]?.message?.content;
  const parsed = content ? parseVoiceMemoModelOutput(content) : null;
  if (!res.ok || !parsed) {
    throw new Error(body.error?.message ?? "Could not create a reliable recap.");
  }
  return parsed;
}

export async function listVoiceMemos(uid: string): Promise<VoiceMemoListResponse> {
  const [state, plan] = await Promise.all([readState(uid), readPlan(uid)]);
  return { memos: state.memos, usage: usageFor(plan, state) };
}

export async function createVoiceMemo(
  uid: string,
  input: { audio: File; claimedDurationSeconds: number; timeZone?: string },
): Promise<{ memo: VoiceMemo; usage: VoiceMemoUsage }> {
  const [state, plan] = await Promise.all([readState(uid), readPlan(uid)]);
  assertVoiceMemoAllowed(plan, state.usedSeconds, input.claimedDurationSeconds);
  const transcription = await transcribe(input.audio);
  const durationSeconds = transcription.durationSeconds || input.claimedDurationSeconds;
  assertVoiceMemoAllowed(plan, state.usedSeconds, durationSeconds);
  const timeZone =
    input.timeZone && isValidTimeZone(input.timeZone)
      ? input.timeZone
      : DEFAULT_TIME_ZONE;
  const result = await recapTranscript(transcription.text, timeZone);
  const memo: VoiceMemo = {
    id: randomUUID(),
    transcript: transcription.text,
    recap: result.recap,
    actions: result.actions.map((action) => ({
      id: randomUUID(),
      type: action.type,
      details: action.details,
      status: "proposed",
      receipt: null,
    })),
    createdAt: Date.now(),
    durationSeconds,
  };
  const savedState = await persistNewMemo(uid, memo, plan);
  // Audio only exists in this request's memory and is never persisted.
  return { memo, usage: usageFor(plan, savedState) };
}

export async function deleteVoiceMemo(uid: string, memoId: string): Promise<boolean> {
  const state = await readState(uid);
  const before = state.memos.length;
  state.memos = state.memos.filter((memo) => memo.id !== memoId);
  if (state.memos.length === before) return false;
  await writeState(uid, state);
  return true;
}

function findAction(
  state: MemoState,
  memoId: string,
  actionId: string,
): { memo: VoiceMemo; action: VoiceMemoAction } | null {
  const memo = state.memos.find((item) => item.id === memoId);
  const action = memo?.actions.find((item) => item.id === actionId);
  return memo && action ? { memo, action } : null;
}

async function executeAction(
  uid: string,
  action: VoiceMemoAction,
  timeZone: string,
): Promise<AgentActionReceipt | null> {
  const details = action.details;
  if (action.type === "reminder") {
    const result = await createGoogleTask(uid, details.title ?? "", details.when);
    return result.receipt;
  }
  if (action.type === "calendar_event") {
    const result = await createGoogleCalendarEvent(uid, {
      title: details.title ?? "",
      start: details.start ?? "",
      end: details.end,
      description: details.description,
      timeZone,
    });
    return result.receipt;
  }
  const result = await saveGmailDraft(
    uid,
    {
      to: details.to ?? "",
      subject: details.subject ?? "",
      body: details.body ?? "",
    },
    null,
  );
  return result.receipt;
}

export async function decideVoiceMemoAction(
  uid: string,
  input: {
    memoId: string;
    actionId: string;
    decision: "confirm" | "skip";
    details?: unknown;
    timeZone?: string;
  },
): Promise<VoiceMemoAction> {
  const [state, plan] = await Promise.all([readState(uid), readPlan(uid)]);
  if (plan !== "pro") {
    throw new VoiceMemoAccessError("pro_required", "Voice Memo Recap is available on Pro.");
  }
  const found = findAction(state, input.memoId, input.actionId);
  if (!found) throw new Error("Memo action not found.");
  if (found.action.status !== "proposed") return found.action;
  if (input.details) {
    const details = cleanDetails(input.details);
    if (Object.keys(details).length === 0) throw new Error("Action details cannot be empty.");
    found.action.details = details;
  }
  if (input.decision === "skip") {
    found.action.status = "skipped";
    await writeState(uid, state);
    return found.action;
  }
  const timeZone =
    input.timeZone && isValidTimeZone(input.timeZone)
      ? input.timeZone
      : DEFAULT_TIME_ZONE;
  const receipt = await executeAction(uid, found.action, timeZone);
  if (!receipt) throw new Error("Connect Google or edit the action details, then retry.");
  found.action.status = "confirmed";
  found.action.receipt = receipt;
  await writeState(uid, state);
  return found.action;
}
