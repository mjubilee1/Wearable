import { randomUUID } from "node:crypto";
import {
  firstNameFrom,
  FREE_DAILY_DRAFTS,
  FREE_DAILY_REQUESTS,
  FREE_DAILY_RESCHEDULES,
  hasProAccess,
  isAgentToolName,
  isDeviceLocation,
  isPlaceholderNote,
  turnNeedsDeviceLocation,
  type AgentActionReceipt,
  type AgentConfirmPreview,
  type AgentFeatureUsage,
  type AgentHistoryItem,
  type AgentPendingTool,
  type AgentToolName,
  type AgentTurnRequest,
  type DeviceLocation,
  type AgentTurnResponse,
  type AgentUsageStatus,
  type LimitFeature,
} from "@nearby/shared";
import {
  applyReschedule,
  createGoogleTask,
  fetchPrimaryCalendarTimeZone,
  parseDraftRequest,
  parseRescheduleRequest,
  previewDraftFromPick,
  previewDraftReply,
  previewReschedule,
  readCalendar,
  readUnreadGmail,
  zonedClock,
  saveGmailDraft,
} from "./connectors/google-calendar.js";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";
import { LimitReachedError } from "./limits.js";
import {
  deleteMemory,
  listMemories,
  saveMemory,
  searchMemories,
} from "./memories.js";
import {
  dayBoundsInZone,
  formatClockAmPm,
  formatWhenInZone,
  isValidTimeZone,
  zonedDayKey,
} from "./timezone.js";
import { answerWithWebSearch } from "./web-search.js";

const HISTORY_LIMIT = 20;

/** Told to the model so web_search stays off calendar, mail, and task turns. */
export const WEB_SEARCH_GUIDANCE =
  "If they need current public information from the internet, such as weather, business hours, sports scores, news, or nearby places, set tool name to web_search with payload query set to a short search query. Do not use web_search for calendar, email, tasks, notes, reminders, or memories. web_search is read-only: it only returns public titles, links, and snippets, and it cannot log in, click, buy, or submit a form. The server searches and replaces reply with the spoken answer.";

const DEFAULT_TIME_ZONE = "America/New_York";

type StoredAction = {
  id: string;
  text: string;
  when?: string;
  createdAt: number;
};

type UsageDay = {
  day: string;
  count: number;
  reschedules: number;
  drafts: number;
};

type LegacyMemory = {
  id: string;
  text: string;
  createdAt: number;
};

type AgentState = {
  memories: LegacyMemory[];
  notes: StoredAction[];
  reminders: StoredAction[];
  history: AgentHistoryItem[];
  usage: UsageDay | null;
};

const localState = new Map<string, AgentState>();

function emptyState(): AgentState {
  return { memories: [], notes: [], reminders: [], history: [], usage: null };
}


function asMemory(value: unknown): LegacyMemory | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.text !== "string") return null;
  const createdAt = typeof row.createdAt === "number" ? row.createdAt : Date.now();
  return { id: row.id, text: row.text, createdAt };
}

function asAction(value: unknown): StoredAction | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.text !== "string") return null;
  const action: StoredAction = {
    id: row.id,
    text: row.text,
    createdAt: typeof row.createdAt === "number" ? row.createdAt : Date.now(),
  };
  if (typeof row.when === "string" && row.when.trim()) {
    action.when = row.when.trim();
  }
  return action;
}

function clip(text: string, max = 240): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trim()}…`;
}

function asReceipt(value: unknown): AgentActionReceipt | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.action !== "string" || !row.action.trim()) return null;
  return {
    action: clip(row.action, 200),
    href: typeof row.href === "string" ? row.href : null,
    linkLabel: typeof row.linkLabel === "string" ? row.linkLabel : null,
  };
}

function asHistoryItem(value: unknown): AgentHistoryItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.request !== "string" ||
    typeof row.reply !== "string"
  ) {
    return null;
  }
  const item: AgentHistoryItem = {
    id: row.id,
    request: clip(row.request, 500),
    reply: clip(row.reply, 520),
    receipt: asReceipt(row.receipt),
    createdAt: typeof row.createdAt === "number" ? row.createdAt : Date.now(),
  };
  if (row.status === "cancelled") item.status = "cancelled";
  return item;
}

function asUsage(value: unknown): UsageDay | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.day !== "string") return null;
  const count =
    typeof row.count === "number"
      ? row.count
      : typeof row.requests === "number"
        ? row.requests
        : null;
  if (count === null) return null;
  return {
    day: row.day,
    count: Math.max(0, Math.floor(count)),
    reschedules:
      typeof row.reschedules === "number"
        ? Math.max(0, Math.floor(row.reschedules))
        : 0,
    drafts:
      typeof row.drafts === "number" ? Math.max(0, Math.floor(row.drafts)) : 0,
  };
}

/** Firestore rejects undefined field values — only serialize defined keys. */
function serializeAction(action: StoredAction): Record<string, string | number> {
  const out: Record<string, string | number> = {
    id: action.id,
    text: action.text,
    createdAt: action.createdAt,
  };
  if (typeof action.when === "string" && action.when.trim()) {
    out.when = action.when.trim();
  }
  return out;
}

async function readState(uid: string): Promise<AgentState> {
  if (!isFirebaseConfigured()) return localState.get(uid) ?? emptyState();
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("agentState")
    .doc(uid)
    .get();
  if (!snap.exists) return emptyState();
  const data = snap.data() ?? {};
  return {
    memories: Array.isArray(data.memories)
      ? data.memories.map(asMemory).filter((row): row is LegacyMemory => row !== null)
      : [],
    notes: Array.isArray(data.notes)
      ? data.notes.map(asAction).filter((row): row is StoredAction => row !== null)
      : [],
    reminders: Array.isArray(data.reminders)
      ? data.reminders.map(asAction).filter((row): row is StoredAction => row !== null)
      : [],
    history: Array.isArray(data.history)
      ? data.history
          .map(asHistoryItem)
          .filter((row): row is AgentHistoryItem => row !== null)
          .slice(0, HISTORY_LIMIT)
      : [],
    usage: asUsage(data.usage),
  };
}

function serializeReceipt(
  receipt: AgentActionReceipt | null,
): Record<string, string | null> | null {
  if (!receipt) return null;
  return {
    action: receipt.action,
    href: receipt.href,
    linkLabel: receipt.linkLabel,
  };
}

function serializeHistoryItem(
  item: AgentHistoryItem,
): Record<string, string | number | Record<string, string | null> | null> {
  const out: Record<
    string,
    string | number | Record<string, string | null> | null
  > = {
    id: item.id,
    request: item.request,
    reply: item.reply,
    receipt: serializeReceipt(item.receipt),
    createdAt: item.createdAt,
  };
  if (item.status === "cancelled") out.status = "cancelled";
  return out;
}

async function writeState(uid: string, state: AgentState): Promise<void> {
  if (!isFirebaseConfigured()) {
    localState.set(uid, state);
    return;
  }
  const payload: Record<string, unknown> = {
    memories: state.memories,
    notes: state.notes.map(serializeAction),
    reminders: state.reminders.map(serializeAction),
    history: state.history.map(serializeHistoryItem),
  };
  if (state.usage) payload.usage = state.usage;
  await getFirebaseAdmin().firestore().collection("agentState").doc(uid).set(payload);
}

function asPayload(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    if (Object.keys(out).length >= 12) break;
    out[key.slice(0, 40)] = clip(raw, 280);
  }
  return out;
}

function usageStatus(
  state: AgentState,
  timeZone: string,
  plan: "free" | "pro" = "free",
): AgentUsageStatus {
  const day = zonedDayKey(timeZone);
  const usage = state.usage && state.usage.day === day ? state.usage : null;
  const used = usage?.count ?? 0;
  const reschedulesUsed = usage?.reschedules ?? 0;
  const draftsUsed = usage?.drafts ?? 0;
  const resetAt = dayBoundsInZone(timeZone, 1).start.toISOString();
  const feature = (usedCount: number, limit: number): AgentFeatureUsage =>
    plan === "pro"
      ? { limit: null, used: usedCount, remaining: null }
      : {
          limit,
          used: usedCount,
          remaining: Math.max(0, limit - usedCount),
        };
  if (plan === "pro") {
    return {
      plan,
      limit: null,
      used,
      remaining: null,
      reschedules: feature(reschedulesUsed, FREE_DAILY_RESCHEDULES),
      drafts: feature(draftsUsed, FREE_DAILY_DRAFTS),
      resetAt,
    };
  }
  return {
    plan: "free",
    limit: FREE_DAILY_REQUESTS,
    used,
    remaining: Math.max(0, FREE_DAILY_REQUESTS - used),
    reschedules: feature(reschedulesUsed, FREE_DAILY_RESCHEDULES),
    drafts: feature(draftsUsed, FREE_DAILY_DRAFTS),
    resetAt,
  };
}

function featureUsed(
  state: AgentState,
  timeZone: string,
  feature: LimitFeature,
): number {
  const day = zonedDayKey(timeZone);
  if (!state.usage || state.usage.day !== day) return 0;
  if (feature === "requests") return state.usage.count;
  if (feature === "reschedule") return state.usage.reschedules;
  return state.usage.drafts;
}

function assertWithinLimit(
  state: AgentState,
  timeZone: string,
  feature: LimitFeature,
  plan: "free" | "pro",
): void {
  if (plan === "pro") return;
  const limit =
    feature === "requests"
      ? FREE_DAILY_REQUESTS
      : feature === "reschedule"
        ? FREE_DAILY_RESCHEDULES
        : FREE_DAILY_DRAFTS;
  if (featureUsed(state, timeZone, feature) >= limit) {
    throw new LimitReachedError(feature, timeZone);
  }
}

async function readPlan(uid: string): Promise<"free" | "pro"> {
  if (!isFirebaseConfigured()) return "free";
  try {
    const snap = await getFirebaseAdmin()
      .firestore()
      .collection("users")
      .doc(uid)
      .get();
    return hasProAccess(snap.data() ?? {}) ? "pro" : "free";
  } catch (error) {
    console.error("[agent] plan", error);
    return "free";
  }
}

async function statusFor(
  uid: string,
  state: AgentState,
  timeZone: string,
): Promise<AgentUsageStatus> {
  return usageStatus(state, timeZone, await readPlan(uid));
}

async function bumpFeature(
  uid: string,
  timeZone: string,
  feature: "reschedule" | "draft_email",
): Promise<void> {
  const state = await readState(uid);
  const day = zonedDayKey(timeZone);
  const prev =
    state.usage && state.usage.day === day
      ? state.usage
      : { day, count: 0, reschedules: 0, drafts: 0 };
  if (feature === "reschedule") prev.reschedules += 1;
  else prev.drafts += 1;
  state.usage = prev;
  await writeState(uid, state);
}

async function appendHistory(
  uid: string,
  entry: {
    request: string;
    reply: string;
    receipt?: AgentActionReceipt | null;
  },
  consumeQuota: boolean,
  timeZone: string,
): Promise<{ usage: AgentUsageStatus; historyId: string }> {
  const state = await readState(uid);
  const item: AgentHistoryItem = {
    id: randomUUID(),
    request: clip(entry.request, 500),
    reply: clip(entry.reply, 520),
    receipt: entry.receipt ?? null,
    createdAt: Date.now(),
  };
  state.history = [item, ...state.history].slice(0, HISTORY_LIMIT);
  const countsTowardLimit =
    consumeQuota && !/\bi couldn't (?:find|search)\b/i.test(entry.reply);
  if (countsTowardLimit) {
    const day = zonedDayKey(timeZone);
    const same = state.usage && state.usage.day === day ? state.usage : null;
    state.usage = {
      day,
      count: (same?.count ?? 0) + 1,
      reschedules: same?.reschedules ?? 0,
      drafts: same?.drafts ?? 0,
    };
  }
  await writeState(uid, state);
  return { usage: await statusFor(uid, state, timeZone), historyId: item.id };
}

/** Mark the preview row cancelled. Never inserts a Cancel turn. */
export function cancelHistoryItems(
  history: AgentHistoryItem[],
  historyId?: string,
): AgentHistoryItem[] {
  if (historyId) {
    return history.map((item) =>
      item.id === historyId ? { ...item, status: "cancelled" as const } : item,
    );
  }
  if (history[0] && history[0].status !== "cancelled") {
    return [{ ...history[0], status: "cancelled" }, ...history.slice(1)];
  }
  return history;
}

async function markHistoryCancelled(
  uid: string,
  historyId: string | undefined,
  timeZone: string,
): Promise<AgentUsageStatus> {
  const state = await readState(uid);
  state.history = cancelHistoryItems(state.history, historyId);
  await writeState(uid, state);
  return statusFor(uid, state, timeZone);
}

async function readProfileTimeZone(uid: string): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getFirebaseAdmin()
      .firestore()
      .collection("users")
      .doc(uid)
      .get();
    const value = snap.data()?.timeZone;
    return typeof value === "string" && isValidTimeZone(value) ? value : null;
  } catch {
    return null;
  }
}

async function persistTimeZone(uid: string, timeZone: string): Promise<void> {
  if (!isFirebaseConfigured() || !isValidTimeZone(timeZone)) return;
  try {
    await getFirebaseAdmin()
      .firestore()
      .collection("users")
      .doc(uid)
      .set({ timeZone, updatedAt: Date.now() }, { merge: true });
  } catch (error) {
    console.error("[agent] persist timeZone", error);
  }
}

async function resolveTimeZone(
  uid: string,
  requested: unknown,
): Promise<string> {
  if (typeof requested === "string" && isValidTimeZone(requested.trim())) {
    const tz = requested.trim();
    await persistTimeZone(uid, tz);
    return tz;
  }
  const fromProfile = await readProfileTimeZone(uid);
  if (fromProfile) return fromProfile;
  const fromCalendar = await fetchPrimaryCalendarTimeZone(uid);
  if (fromCalendar && isValidTimeZone(fromCalendar)) return fromCalendar;
  return DEFAULT_TIME_ZONE;
}

function byCreatedAtAsc(
  a: { createdAt: number },
  b: { createdAt: number },
): number {
  return a.createdAt - b.createdAt;
}

function formatSpokenStamp(
  ms: number,
  timeZone: string,
  now = new Date(),
): string {
  const d = new Date(ms);
  const clock = zonedClock(d, timeZone);
  const time = clock ? formatClockAmPm(clock.hour, clock.minute) : "";
  const day = zonedDayKey(timeZone, d);
  if (day === zonedDayKey(timeZone, now)) return `today at ${time}`;
  const yesterday = dayBoundsInZone(timeZone, -1, now).start;
  if (day === zonedDayKey(timeZone, yesterday)) return `yesterday at ${time}`;
  return formatWhenInZone(d, timeZone);
}

function formatContextStamp(ms: number, timeZone: string): string {
  return formatWhenInZone(new Date(ms), timeZone);
}

function wantsNoteRead(lower: string): boolean {
  if (!/\bnotes?\b/.test(lower)) return false;
  // "take a note" / "save a note" is write; "my notes" / "what note" / "did I save" is read
  if (/\b(take|save|write|jot|add|create|make)\b/.test(lower) && !/\b(my|saved|have|read|list|what|which|show|tell)\b/.test(lower)) {
    return false;
  }
  return (
    /\b(my|saved|have|read|list|what|which|show|tell|recall|remember)\b/.test(lower) ||
    /\b(what('s| is)|whats)\b.*\bnotes?\b/.test(lower) ||
    /\bnotes?\b.*\b(i saved|i took|again)\b/.test(lower)
  );
}

function wantsMemoryRecall(text: string): boolean {
  return (
    /\bwhat did\b/i.test(text) ||
    /\bwhat (?:have|did) i (?:say|promise|tell|mention|agree)\b/i.test(text) ||
    /\b(?:recall|remember)\b.*\b(?:said|promised|proposal|client|memo)\b/i.test(text)
  );
}

async function recallMemory(
  uid: string,
  text: string,
  plan: "free" | "pro",
  timeZone: string,
): Promise<string | null> {
  if (!wantsMemoryRecall(text)) return null;
  const matches = await searchMemories(uid, text, plan);
  const source = matches.find((memory) => memory.text.toLowerCase() !== text.toLowerCase());
  if (!source) return "I couldn't find that in your saved memories.";
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(source.createdAt));
  const label = source.source === "voice_memo" ? "voice memo" : "command";
  return `${source.summary} Source: ${label} from ${date}.`;
}

function visibleNotes(notes: StoredAction[]): StoredAction[] {
  return notes.filter((note) => !isPlaceholderNote(note.text));
}

function speakNotes(notes: StoredAction[], timeZone: string): string {
  const kept = visibleNotes(notes);
  if (kept.length === 0) {
    return "You don't have any notes yet.";
  }
  // Chronological (oldest → newest) so the reply has a clear timeline.
  const ordered = [...kept].sort(byCreatedAtAsc);
  const recent = ordered.slice(-5);
  if (recent.length === 1) {
    const note = recent[0];
    return `Your note from ${formatSpokenStamp(note.createdAt, timeZone)}: ${clip(note.text, 200)}`;
  }
  const parts = recent.map(
    (note) =>
      `${formatSpokenStamp(note.createdAt, timeZone)}: ${clip(note.text, 100)}`,
  );
  return `Your notes, oldest to newest. ${parts.join(". ")}.`;
}

function contextBlock(state: AgentState, timeZone: string): string {
  const notes = visibleNotes(state.notes)
    .sort(byCreatedAtAsc)
    .slice(-8)
    .map(
      (n) =>
        `- [${formatContextStamp(n.createdAt, timeZone)}] ${clip(n.text, 160)}`,
    );
  const reminders = [...state.reminders]
    .sort(byCreatedAtAsc)
    .slice(-5)
    .map(
      (r) =>
        `- [${formatContextStamp(r.createdAt, timeZone)}] ${clip(r.text, 120)}${r.when ? ` (due ${r.when})` : ""}`,
    );
  const memories = [...state.memories]
    .sort(byCreatedAtAsc)
    .slice(-5)
    .map((m) => `- [${formatContextStamp(m.createdAt, timeZone)}] ${clip(m.text, 120)}`);
  return [
    "Saved notes in chronological order (oldest to newest). Prefer this order when answering:",
    notes.length ? notes.join("\n") : "(none)",
    "Reminders (oldest to newest):",
    reminders.length ? reminders.join("\n") : "(none)",
    "Saved memories (oldest to newest):",
    memories.length ? memories.join("\n") : "(none)",
  ].join("\n");
}

function mockTurn(
  text: string,
  state: AgentState,
  timeZone: string,
): AgentTurnResponse {
  const spoken = clip(text);
  const lower = spoken.toLowerCase();
  if (!spoken) {
    return { reply: "I didn't catch that.", pendingTool: null, mode: "mock" };
  }
  if (wantsNoteRead(lower)) {
    return { reply: speakNotes(state.notes, timeZone), pendingTool: null, mode: "mock" };
  }
  if (/\bremember\b|\bdon't forget\b/.test(lower)) {
    return {
      reply: "Want me to remember that?",
      pendingTool: {
        tool: "remember",
        summary: spoken,
        payload: { text: spoken },
      },
      mode: "mock",
    };
  }
  if (/\bremind/.test(lower)) {
    return {
      reply: "Set that reminder?",
      pendingTool: {
        tool: "reminder",
        summary: spoken,
        payload: { text: spoken, when: "" },
      },
      mode: "mock",
    };
  }
  if (/\b(note|write down|jot)\b/.test(lower)) {
    return {
      reply: "Save that note?",
      pendingTool: {
        tool: "note",
        summary: spoken,
        payload: { text: spoken },
      },
      mode: "mock",
    };
  }
  if (/\b(calendar|agenda|schedule|meeting)\b/.test(lower)) {
    return {
      reply: "Check your calendar?",
      pendingTool: {
        tool: "calendar",
        summary: "Today's calendar",
        payload: { when: "today" },
      },
      mode: "mock",
    };
  }
  if (/\b(gmail|inbox|email|e-mail|unread mail)\b/.test(lower)) {
    return {
      reply: "Check your unread mail?",
      pendingTool: {
        tool: "gmail",
        summary: "Unread Gmail",
        payload: { when: "recent" },
      },
      mode: "mock",
    };
  }
  return {
    reply:
      "I can take a note, add a Google Task, check calendar, or read unread mail. Which one?",
    pendingTool: null,
    mode: "mock",
  };
}

function parseModel(content: string): AgentTurnResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  if (typeof row.reply !== "string" || !row.reply.trim()) return null;
  const reply = clip(row.reply);
  if (row.tool == null) {
    return { reply, pendingTool: null, mode: "openai" };
  }
  if (!row.tool || typeof row.tool !== "object") return null;
  const tool = row.tool as Record<string, unknown>;
  if (typeof tool.name !== "string" || !isAgentToolName(tool.name)) return null;
  const summary =
    typeof tool.summary === "string" && tool.summary.trim()
      ? clip(tool.summary)
      : reply;
  const pendingTool: AgentPendingTool = {
    tool: tool.name,
    summary,
    payload: asPayload(tool.payload),
  };
  return { reply, pendingTool, mode: "openai" };
}

async function readFirstName(uid: string): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getFirebaseAdmin()
      .firestore()
      .collection("users")
      .doc(uid)
      .get();
    const data = snap.data() ?? {};
    const name = typeof data.name === "string" ? data.name : "";
    const email = typeof data.email === "string" ? data.email : "";
    const first = firstNameFrom(name, email);
    if (!first) return null;
    return first.replace(/[\r\n]/g, " ").trim().slice(0, 40) || null;
  } catch (error) {
    console.error("[agent] profile name", error);
    return null;
  }
}

function taskTitleFrom(text: string): string {
  const quoted = text.match(/["“']([^"”']+)["”']/);
  if (quoted?.[1]?.trim()) return clip(quoted[1].trim(), 200);
  const stripped = text
    .replace(/\b(please|can you|could you|would you)\b/gi, "")
    .replace(/\b(add|put|create|save|remind me to|remind me)\b/gi, "")
    .replace(/\b(to|on|into)\s+(my\s+)?(google\s+)?tasks?\b/gi, "")
    .replace(/\b(my\s+)?(google\s+)?tasks?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return clip(stripped || text, 200);
}

/** Known spoken requests run the tool directly so example chips don't wait on the model. */
function explicitTool(text: string): AgentPendingTool | null {
  const lower = text.toLowerCase();
  if (
    /\b(tasks?|to-?dos?)\b/.test(lower) &&
    /\b(add|put|create|save|remind)\b/.test(lower)
  ) {
    const title = taskTitleFrom(text);
    return {
      tool: "reminder",
      summary: `Add ${title} to tasks`,
      payload: { text: title, when: "" },
    };
  }
  if (/\b(gmail|inbox|emails?|e-mails?|unread)\b/.test(lower)) {
    const count = Number(lower.match(/\b([1-5])\b/)?.[1] ?? "3");
    return {
      tool: "gmail",
      summary: "Summarize unread email",
      payload: { when: "recent", limit: String(count) },
    };
  }
  if (/\b(calendar|agenda|schedule|meeting|appointment)\b/.test(lower)) {
    const when = /\btomorrow\b/.test(lower) ? "tomorrow" : "today";
    const first = /\b(first|next|earliest)\b/.test(lower);
    return {
      tool: "calendar",
      summary: first ? `${when}'s first meeting` : `${when}'s calendar`,
      payload: { when, first: first ? "1" : "0" },
    };
  }
  return null;
}

function nameLine(name: string | null): string {
  if (!name) {
    return "Do not address the user by an email address. ";
  }
  return `The user's first name is ${name}. Use it when you greet them. Never address them by an email address. `;
}

function locationLine(location: DeviceLocation | null): string {
  if (!location) return "";
  return (
    `The user is at latitude ${location.latitude.toFixed(4)}, longitude ${location.longitude.toFixed(4)}. ` +
    "Use that for weather, nearby places, and directions. Speak a place, not the coordinates. "
  );
}

function searchQueryWithLocation(
  query: string,
  requestText: string,
  location: DeviceLocation | null,
): string {
  if (
    !location ||
    (!turnNeedsDeviceLocation(query) && !turnNeedsDeviceLocation(requestText))
  ) {
    return query;
  }
  return `${query} near ${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
}

async function modelTurn(
  uid: string,
  text: string,
  name: string | null,
  timeZone: string,
  location: DeviceLocation | null,
): Promise<AgentTurnResponse> {
  const state = await readState(uid);
  const lower = text.toLowerCase();
  if (wantsNoteRead(lower)) {
    const mode = process.env.OPENAI_API_KEY ? "openai" : "mock";
    const spoken = speakNotes(state.notes, timeZone);
    const reply = name
      ? `${name}, ${spoken.charAt(0).toLowerCase()}${spoken.slice(1)}`
      : spoken;
    return { reply, pendingTool: null, mode };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return mockTurn(text, state, timeZone);

  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are Nearby, a voice assistant. The user spoke one turn. Reply in one or two short sentences meant to be spoken aloud. No markdown, lists, or emoji. " +
              nameLine(name) +
              locationLine(location) +
              "You can already see their saved notes, local reminders, and memories below with timestamps — when they ask what they saved, answer in chronological order (oldest to newest) and mention when each was saved in plain speech. Do not claim you cannot access notes. If they want to create a note, set a reminder (pushed to Google Tasks when connected), remember a fact, check the calendar, or read unread Gmail, set tool and do not ask permission — the server runs it in this turn and replaces reply. " +
              WEB_SEARCH_GUIDANCE +
              " Otherwise tool is null and reply is the spoken answer. Return JSON only: {\"reply\":string,\"tool\":null|{name:\"calendar\"|\"gmail\"|\"note\"|\"reminder\"|\"remember\"|\"web_search\",summary:string,payload:object}}. Payload keys: note text; reminder text and when; remember text; calendar when (today or tomorrow) and first (1 for the first event only); gmail when and limit; web_search query.\n\n" +
              contextBlock(state, timeZone),
          },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) {
      console.error("[agent] LLM error", await res.text());
      return mockTurn(text, state, timeZone);
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    return (content && parseModel(content)) || mockTurn(text, state, timeZone);
  } catch (error) {
    console.error("[agent] LLM request failed", error);
    return mockTurn(text, state, timeZone);
  }
}

function spokenConfirmation(
  tool: AgentToolName,
  approved: boolean,
  payload: Record<string, string>,
  name: string | null,
): string {
  if (!approved) return "Okay. I won't.";
  if (tool === "remember") {
    return name ? `${name}, I'll remember that.` : "I'll remember that.";
  }
  if (tool === "note") return name ? `Saved, ${name}.` : "Saved.";
  if (tool === "reminder") {
    const base = payload.when ? `Reminder set for ${payload.when}.` : "Reminder set.";
    return name ? `${name}, ${base.charAt(0).toLowerCase()}${base.slice(1)}` : base;
  }
  return "Okay.";
}

function answered(
  reply: string,
  mode: AgentTurnResponse["mode"],
  extras: {
    receipt?: AgentActionReceipt | null;
    preview?: AgentConfirmPreview | null;
    pendingTool?: AgentPendingTool | null;
    usage?: AgentUsageStatus;
    historyId?: string | null;
  } = {},
): AgentTurnResponse {
  return {
    reply,
    pendingTool: extras.pendingTool ?? null,
    mode,
    receipt: extras.receipt ?? null,
    preview: extras.preview ?? null,
    usage: extras.usage,
    historyId: extras.historyId ?? null,
  };
}

async function applyDecision(
  uid: string,
  decision: NonNullable<AgentTurnRequest["decision"]>,
  name: string | null,
  requestText = "",
  options: {
    recordHistory?: boolean;
    consumeQuota?: boolean;
    timeZone: string;
    location?: DeviceLocation | null;
  },
): Promise<AgentTurnResponse> {
  const payload = asPayload(decision.payload);
  const summary = clip(decision.summary || payload.text || "");
  const mode = process.env.OPENAI_API_KEY ? "openai" : "mock";
  const recordHistory = options.recordHistory !== false;
  const consumeQuota = Boolean(options.consumeQuota);
  const timeZone = options.timeZone;

  async function finish(
    reply: string,
    extras: {
      receipt?: AgentActionReceipt | null;
      preview?: AgentConfirmPreview | null;
      pendingTool?: AgentPendingTool | null;
    } = {},
  ): Promise<AgentTurnResponse> {
    if (recordHistory) {
      const saved = await appendHistory(
        uid,
        {
          request: requestText || summary || decision.tool,
          reply,
          receipt: extras.receipt ?? null,
        },
        consumeQuota,
        timeZone,
      );
      return answered(reply, mode, {
        ...extras,
        usage: saved.usage,
        historyId: saved.historyId,
      });
    }
    return answered(reply, mode, {
      ...extras,
      usage: await statusFor(uid, await readState(uid), timeZone),
    });
  }

  if (!decision.approved) {
    const usage = await markHistoryCancelled(
      uid,
      decision.historyId,
      timeZone,
    );
    return answered("Okay. Cancelled. Nothing changed.", mode, { usage });
  }

  if (decision.tool === "reschedule") {
    assertWithinLimit(
      await readState(uid),
      timeZone,
      "reschedule",
      await readPlan(uid),
    );
    const result = await applyReschedule(
      uid,
      {
        eventId: payload.eventId || "",
        calendarId: payload.calendarId || "primary",
        newStartIso: payload.newStartIso || "",
        newEndIso: payload.newEndIso || "",
        title: payload.title || "Event",
        oldWhen: payload.oldWhen || "",
        newWhen: payload.newWhen || "",
      },
      name,
    );
    if (result.receipt) await bumpFeature(uid, timeZone, "reschedule");
    return finish(clip(result.spoken, 420), { receipt: result.receipt });
  }

  if (decision.tool === "draft_email") {
    assertWithinLimit(
      await readState(uid),
      timeZone,
      "draft_email",
      await readPlan(uid),
    );
    const result = await saveGmailDraft(
      uid,
      {
        to: payload.to || "",
        subject: payload.subject || "",
        body: payload.body || "",
        threadId: payload.threadId || undefined,
        inReplyToMessageId: payload.messageId || undefined,
      },
      name,
    );
    if (result.receipt) await bumpFeature(uid, timeZone, "draft_email");
    return finish(clip(result.spoken, 420), { receipt: result.receipt });
  }

  if (decision.tool === "calendar") {
    const when = payload.when === "tomorrow" ? "tomorrow" : "today";
    const result = await readCalendar(uid, {
      when,
      firstOnly: payload.first === "1",
      name,
      timeZone,
    });
    return finish(clip(result.spoken, 420), { receipt: result.receipt });
  }

  if (decision.tool === "gmail") {
    const limit = Number(payload.limit);
    const result = await readUnreadGmail(uid, {
      limit: Number.isFinite(limit) && limit > 0 ? limit : 3,
      name,
    });
    return finish(clip(result.spoken, 520), { receipt: result.receipt });
  }

  if (decision.tool === "web_search") {
    const direct = explicitTool(requestText);
    if (direct) {
      return applyDecision(
        uid,
        {
          tool: direct.tool,
          approved: decision.approved,
          summary: direct.summary,
          payload: direct.payload,
        },
        name,
        requestText,
        options,
      );
    }
    const searched = await answerWithWebSearch({
      question: requestText || summary || payload.query || "",
      query: searchQueryWithLocation(
        payload.query || requestText || summary,
        requestText,
        options.location ?? null,
      ),
      name,
    });
    return finish(searched.reply, { receipt: searched.receipt });
  }

  const state = await readState(uid);
  const text = clip(payload.text || summary, 280);
  if (text) {
    if (decision.tool === "remember") {
      state.memories = [
        { id: randomUUID(), text, createdAt: Date.now() },
        ...state.memories,
      ].slice(0, 50);
      await writeState(uid, state);
      await saveMemory(uid, text, "remember");
      return finish(spokenConfirmation(decision.tool, true, payload, name));
    }
    if (decision.tool === "note") {
      if (isPlaceholderNote(text)) {
        return finish(
          name
            ? `${name}, say the note you want saved.`
            : "Say the note you want saved.",
        );
      }
      state.notes = [
        { id: randomUUID(), text, createdAt: Date.now() },
        ...state.notes,
      ].slice(0, 50);
      await writeState(uid, state);
      return finish(spokenConfirmation(decision.tool, true, payload, name));
    }
    if (decision.tool === "reminder") {
      const task = await createGoogleTask(uid, text, payload.when, name);
      if (task.ok) {
        const reminder: StoredAction = {
          id: randomUUID(),
          text,
          createdAt: Date.now(),
        };
        if (payload.when) reminder.when = payload.when;
        state.reminders = [reminder, ...state.reminders].slice(0, 50);
        await writeState(uid, state);
        return finish(task.spoken, { receipt: task.receipt });
      }
      const reminder: StoredAction = {
        id: randomUUID(),
        text,
        createdAt: Date.now(),
      };
      if (payload.when) reminder.when = payload.when;
      state.reminders = [reminder, ...state.reminders].slice(0, 50);
      await writeState(uid, state);
      const local = spokenConfirmation("reminder", true, payload, name);
      return finish(`${local} ${task.spoken}`);
    }
  }
  return finish(spokenConfirmation(decision.tool, true, payload, name));
}

async function beginConfirmTurn(
  uid: string,
  text: string,
  name: string | null,
  timeZone: string,
): Promise<AgentTurnResponse | null> {
  const mode = process.env.OPENAI_API_KEY ? "openai" : "mock";
  const reschedule = parseRescheduleRequest(text, timeZone);
  if (reschedule) {
    if (!reschedule.ok) {
      const saved = await appendHistory(
        uid,
        { request: text, reply: reschedule.ask, receipt: null },
        true,
        timeZone,
      );
      return answered(reschedule.ask, mode, {
        usage: saved.usage,
        historyId: saved.historyId,
      });
    }
    const result = await previewReschedule(uid, reschedule, name, timeZone);
    if (!result.ok) {
      const saved = await appendHistory(
        uid,
        { request: text, reply: result.spoken, receipt: null },
        true,
        timeZone,
      );
      return answered(result.spoken, mode, {
        usage: saved.usage,
        historyId: saved.historyId,
      });
    }
    const pendingTool: AgentPendingTool = {
      tool: "reschedule",
      summary: `${result.preview.title}: ${result.preview.oldWhen} → ${result.preview.newWhen}`,
      payload: result.payload,
    };
    const saved = await appendHistory(
      uid,
      { request: text, reply: result.spoken, receipt: null },
      true,
      timeZone,
    );
    return answered(result.spoken, mode, {
      pendingTool,
      preview: result.preview,
      usage: saved.usage,
      historyId: saved.historyId,
    });
  }

  const draft = parseDraftRequest(text);
  if (draft) {
    const result = await previewDraftReply(uid, draft, name);
    if (!result.ok) {
      const saved = await appendHistory(
        uid,
        { request: text, reply: result.spoken, receipt: null },
        true,
        timeZone,
      );
      return answered(result.spoken, mode, {
        usage: saved.usage,
        historyId: saved.historyId,
      });
    }
    if (result.preview.kind === "draft_choices") {
      const saved = await appendHistory(
        uid,
        { request: text, reply: result.spoken, receipt: null },
        true,
        timeZone,
      );
      return answered(result.spoken, mode, {
        preview: result.preview,
        usage: saved.usage,
        historyId: saved.historyId,
      });
    }
    const pendingTool: AgentPendingTool = {
      tool: "draft_email",
      summary: `Draft to ${result.preview.to}`,
      payload: {
        to: result.preview.to,
        subject: result.preview.subject,
        body: result.preview.body,
        threadId: result.preview.threadId,
        messageId: result.preview.messageId,
      },
    };
    const saved = await appendHistory(
      uid,
      { request: text, reply: result.spoken, receipt: null },
      true,
      timeZone,
    );
    return answered(result.spoken, mode, {
      pendingTool,
      preview: result.preview,
      usage: saved.usage,
      historyId: saved.historyId,
    });
  }

  return null;
}

async function runAgentTurnCore(
  uid: string,
  body: unknown,
): Promise<AgentTurnResponse> {
  if (!body || typeof body !== "object") {
    throw new Error("Missing request body");
  }
  const request = body as AgentTurnRequest;
  const name = await readFirstName(uid);
  const timeZone = await resolveTimeZone(uid, request.timeZone);
  const mode = process.env.OPENAI_API_KEY ? "openai" : "mock";

  if (request.draftPick) {
    const pick = request.draftPick;
    if (
      typeof pick.messageId !== "string" ||
      typeof pick.threadId !== "string" ||
      typeof pick.intent !== "string" ||
      typeof pick.query !== "string"
    ) {
      throw new Error("Invalid draft pick");
    }
    const plan = await readPlan(uid);
    assertWithinLimit(await readState(uid), timeZone, "draft_email", plan);
    const result = await previewDraftFromPick(uid, pick, name);
    if (!result.ok) {
      const saved = await appendHistory(
        uid,
        { request: `Draft to ${pick.query}`, reply: result.spoken, receipt: null },
        false,
        timeZone,
      );
      return answered(result.spoken, mode, {
        usage: saved.usage,
        historyId: saved.historyId,
      });
    }
    const pendingTool: AgentPendingTool = {
      tool: "draft_email",
      summary: `Draft to ${result.preview.to}`,
      payload: {
        to: result.preview.to,
        subject: result.preview.subject,
        body: result.preview.body,
        threadId: result.preview.threadId,
        messageId: result.preview.messageId,
      },
    };
    const saved = await appendHistory(
      uid,
      {
        request: `Draft to ${pick.query}`,
        reply: result.spoken,
        receipt: null,
      },
      false,
      timeZone,
    );
    return answered(result.spoken, mode, {
      pendingTool,
      preview: result.preview,
      usage: saved.usage,
      historyId: saved.historyId,
    });
  }

  if (request.decision) {
    const decision = request.decision;
    if (
      !decision ||
      typeof decision.tool !== "string" ||
      !isAgentToolName(decision.tool) ||
      typeof decision.approved !== "boolean"
    ) {
      throw new Error("Invalid tool decision");
    }
    const plan = await readPlan(uid);
    if (decision.approved) {
      const feature: LimitFeature =
        decision.tool === "reschedule" || decision.tool === "draft_email"
          ? decision.tool
          : "requests";
      assertWithinLimit(await readState(uid), timeZone, feature, plan);
    }
    const countsAsRequest =
      decision.approved &&
      decision.tool !== "reschedule" &&
      decision.tool !== "draft_email";
    return applyDecision(
      uid,
      {
        tool: decision.tool,
        approved: decision.approved,
        summary: typeof decision.summary === "string" ? decision.summary : "",
        payload: asPayload(decision.payload),
        historyId:
          typeof decision.historyId === "string" ? decision.historyId : undefined,
      },
      name,
      typeof decision.summary === "string" ? decision.summary : decision.tool,
      { recordHistory: decision.approved, consumeQuota: countsAsRequest, timeZone },
    );
  }

  const text = typeof request.text === "string" ? clip(request.text, 500) : "";
  if (!text) throw new Error("Say something first");
  const location =
    turnNeedsDeviceLocation(text) && isDeviceLocation(request.location)
      ? request.location
      : null;

  const plan = await readPlan(uid);
  const state = await readState(uid);
  const gated = parseRescheduleRequest(text, timeZone)
    ? "reschedule"
    : parseDraftRequest(text)
      ? "draft_email"
      : null;
  if (gated) assertWithinLimit(state, timeZone, gated, plan);
  assertWithinLimit(state, timeZone, "requests", plan);

  const recalled = await recallMemory(uid, text, plan, timeZone);
  if (recalled) {
    const saved = await appendHistory(
      uid,
      { request: text, reply: recalled, receipt: null },
      true,
      timeZone,
    );
    return answered(recalled, mode, {
      usage: saved.usage,
      historyId: saved.historyId,
    });
  }

  const confirm = await beginConfirmTurn(uid, text, name, timeZone);
  if (confirm) return confirm;

  const direct = explicitTool(text);
  if (direct) {
    return applyDecision(
      uid,
      {
        tool: direct.tool,
        approved: true,
        summary: direct.summary,
        payload: direct.payload,
      },
      name,
      text,
      { recordHistory: true, consumeQuota: true, timeZone, location },
    );
  }
  const turn = await modelTurn(uid, text, name, timeZone, location);
  const pending =
    turn.pendingTool ??
    (await mockTurn(text, await readState(uid), timeZone)).pendingTool;
  if (!pending) {
    const saved = await appendHistory(
      uid,
      { request: text, reply: turn.reply, receipt: turn.receipt ?? null },
      true,
      timeZone,
    );
    return {
      ...turn,
      usage: saved.usage,
      historyId: saved.historyId,
      preview: null,
    };
  }
  if (pending.tool === "reschedule" || pending.tool === "draft_email") {
    const again = await beginConfirmTurn(uid, text, name, timeZone);
    if (again) return again;
  }
  return applyDecision(
    uid,
    {
      tool: pending.tool,
      approved: true,
      summary: pending.summary,
      payload: pending.payload,
    },
    name,
    text,
    { recordHistory: true, consumeQuota: true, timeZone, location },
  );
}

export async function runAgentTurn(
  uid: string,
  body: unknown,
): Promise<AgentTurnResponse> {
  return runAgentTurnCore(uid, body);
}

export async function listAgentMemories(
  uid: string,
  query = "",
) {
  return listMemories(uid, await readPlan(uid), query);
}

export async function listAgentNotes(uid: string): Promise<StoredAction[]> {
  const state = await readState(uid);
  const notes = visibleNotes(state.notes);
  if (notes.length !== state.notes.length) {
    state.notes = notes;
    await writeState(uid, state);
  }
  return [...notes].sort(byCreatedAtAsc);
}

export async function deleteAgentNote(uid: string, id: string): Promise<void> {
  const state = await readState(uid);
  state.notes = state.notes.filter((item) => item.id !== id);
  await writeState(uid, state);
}

export async function deleteAgentMemory(uid: string, id: string): Promise<void> {
  await deleteMemory(uid, id);
}

export async function listAgentHistory(uid: string): Promise<AgentHistoryItem[]> {
  const state = await readState(uid);
  return state.history;
}

export async function clearAgentHistory(uid: string): Promise<void> {
  const state = await readState(uid);
  state.history = [];
  await writeState(uid, state);
}

export async function getAgentUsage(
  uid: string,
  timeZone?: string,
): Promise<AgentUsageStatus> {
  const tz =
    timeZone && isValidTimeZone(timeZone)
      ? timeZone
      : (await readProfileTimeZone(uid)) ?? DEFAULT_TIME_ZONE;
  return statusFor(uid, await readState(uid), tz);
}
