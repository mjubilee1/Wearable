import { randomUUID } from "node:crypto";
import {
  firstNameFrom,
  isAgentToolName,
  isPlaceholderNote,
  type AgentActionReceipt,
  type AgentMemoryItem,
  type AgentPendingTool,
  type AgentToolName,
  type AgentTurnRequest,
  type AgentTurnResponse,
} from "@nearby/shared";
import {
  createGoogleTask,
  readCalendar,
  readUnreadGmail,
} from "./connectors/google-calendar.js";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

type StoredAction = {
  id: string;
  text: string;
  when?: string;
  createdAt: number;
};

type AgentState = {
  memories: AgentMemoryItem[];
  notes: StoredAction[];
  reminders: StoredAction[];
};

const localState = new Map<string, AgentState>();

function emptyState(): AgentState {
  return { memories: [], notes: [], reminders: [] };
}

function asMemory(value: unknown): AgentMemoryItem | null {
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
      ? data.memories.map(asMemory).filter((row): row is AgentMemoryItem => row !== null)
      : [],
    notes: Array.isArray(data.notes)
      ? data.notes.map(asAction).filter((row): row is StoredAction => row !== null)
      : [],
    reminders: Array.isArray(data.reminders)
      ? data.reminders.map(asAction).filter((row): row is StoredAction => row !== null)
      : [],
  };
}

async function writeState(uid: string, state: AgentState): Promise<void> {
  if (!isFirebaseConfigured()) {
    localState.set(uid, state);
    return;
  }
  await getFirebaseAdmin().firestore().collection("agentState").doc(uid).set({
    memories: state.memories,
    notes: state.notes.map(serializeAction),
    reminders: state.reminders.map(serializeAction),
  });
}

function clip(text: string, max = 240): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trim()}…`;
}

function asPayload(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    if (Object.keys(out).length >= 6) break;
    out[key.slice(0, 40)] = clip(raw, 280);
  }
  return out;
}

function byCreatedAtAsc(
  a: { createdAt: number },
  b: { createdAt: number },
): number {
  return a.createdAt - b.createdAt;
}

function formatSpokenStamp(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return `today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `yesterday at ${time}`;
  }
  const day = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${day} at ${time}`;
}

function formatContextStamp(ms: number): string {
  return new Date(ms).toISOString();
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

function visibleNotes(notes: StoredAction[]): StoredAction[] {
  return notes.filter((note) => !isPlaceholderNote(note.text));
}

function speakNotes(notes: StoredAction[]): string {
  const kept = visibleNotes(notes);
  if (kept.length === 0) {
    return "You don't have any notes yet.";
  }
  // Chronological (oldest → newest) so the reply has a clear timeline.
  const ordered = [...kept].sort(byCreatedAtAsc);
  const recent = ordered.slice(-5);
  if (recent.length === 1) {
    const note = recent[0];
    return `Your note from ${formatSpokenStamp(note.createdAt)}: ${clip(note.text, 200)}`;
  }
  const parts = recent.map(
    (note) =>
      `${formatSpokenStamp(note.createdAt)}: ${clip(note.text, 100)}`,
  );
  return `Your notes, oldest to newest. ${parts.join(". ")}.`;
}

function contextBlock(state: AgentState): string {
  const notes = visibleNotes(state.notes)
    .sort(byCreatedAtAsc)
    .slice(-8)
    .map(
      (n) =>
        `- [${formatContextStamp(n.createdAt)}] ${clip(n.text, 160)}`,
    );
  const reminders = [...state.reminders]
    .sort(byCreatedAtAsc)
    .slice(-5)
    .map(
      (r) =>
        `- [${formatContextStamp(r.createdAt)}] ${clip(r.text, 120)}${r.when ? ` (due ${r.when})` : ""}`,
    );
  const memories = [...state.memories]
    .sort(byCreatedAtAsc)
    .slice(-5)
    .map((m) => `- [${formatContextStamp(m.createdAt)}] ${clip(m.text, 120)}`);
  return [
    "Saved notes in chronological order (oldest to newest). Prefer this order when answering:",
    notes.length ? notes.join("\n") : "(none)",
    "Reminders (oldest to newest):",
    reminders.length ? reminders.join("\n") : "(none)",
    "Saved memories (oldest to newest):",
    memories.length ? memories.join("\n") : "(none)",
  ].join("\n");
}

function mockTurn(text: string, state: AgentState): AgentTurnResponse {
  const spoken = clip(text);
  const lower = spoken.toLowerCase();
  if (!spoken) {
    return { reply: "I didn't catch that.", pendingTool: null, mode: "mock" };
  }
  if (wantsNoteRead(lower)) {
    return { reply: speakNotes(state.notes), pendingTool: null, mode: "mock" };
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

async function modelTurn(
  uid: string,
  text: string,
  name: string | null,
): Promise<AgentTurnResponse> {
  const state = await readState(uid);
  const lower = text.toLowerCase();
  if (wantsNoteRead(lower)) {
    const mode = process.env.OPENAI_API_KEY ? "openai" : "mock";
    const spoken = speakNotes(state.notes);
    const reply = name
      ? `${name}, ${spoken.charAt(0).toLowerCase()}${spoken.slice(1)}`
      : spoken;
    return { reply, pendingTool: null, mode };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return mockTurn(text, state);

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
              "You can already see their saved notes, local reminders, and memories below with timestamps — when they ask what they saved, answer in chronological order (oldest to newest) and mention when each was saved in plain speech. Do not claim you cannot access notes. If they want to create a note, set a reminder (pushed to Google Tasks when connected), remember a fact, check the calendar, or read unread Gmail, set tool and do not ask permission — the server runs it in this turn and replaces reply. Otherwise tool is null and reply is the spoken answer. Return JSON only: {\"reply\":string,\"tool\":null|{name:\"calendar\"|\"gmail\"|\"note\"|\"reminder\"|\"remember\",summary:string,payload:object}}. Payload keys: note text; reminder text and when; remember text; calendar when (today or tomorrow) and first (1 for the first event only); gmail when and limit.\n\n" +
              contextBlock(state),
          },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) {
      console.error("[agent] LLM error", await res.text());
      return mockTurn(text, state);
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    return (content && parseModel(content)) || mockTurn(text, state);
  } catch (error) {
    console.error("[agent] LLM request failed", error);
    return mockTurn(text, state);
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
  receipt: AgentActionReceipt | null = null,
): AgentTurnResponse {
  return { reply, pendingTool: null, mode, receipt };
}

async function applyDecision(
  uid: string,
  decision: NonNullable<AgentTurnRequest["decision"]>,
  name: string | null,
): Promise<AgentTurnResponse> {
  const payload = asPayload(decision.payload);
  const summary = clip(decision.summary || payload.text || "");
  const mode = process.env.OPENAI_API_KEY ? "openai" : "mock";

  if (!decision.approved) {
    return answered("Okay. I won't.", mode);
  }

  if (decision.tool === "calendar") {
    const when = payload.when === "tomorrow" ? "tomorrow" : "today";
    const result = await readCalendar(uid, {
      when,
      firstOnly: payload.first === "1",
      name,
    });
    return answered(clip(result.spoken, 420), mode, result.receipt);
  }

  if (decision.tool === "gmail") {
    const limit = Number(payload.limit);
    const result = await readUnreadGmail(uid, {
      limit: Number.isFinite(limit) && limit > 0 ? limit : 3,
      name,
    });
    return answered(clip(result.spoken, 520), mode, result.receipt);
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
      return answered(spokenConfirmation(decision.tool, true, payload, name), mode);
    }
    if (decision.tool === "note") {
      if (isPlaceholderNote(text)) {
        return answered(
          name
            ? `${name}, say the note you want saved.`
            : "Say the note you want saved.",
          mode,
        );
      }
      state.notes = [
        { id: randomUUID(), text, createdAt: Date.now() },
        ...state.notes,
      ].slice(0, 50);
      await writeState(uid, state);
      return answered(spokenConfirmation(decision.tool, true, payload, name), mode);
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
        return answered(task.spoken, mode, task.receipt);
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
      return answered(`${local} ${task.spoken}`, mode);
    }
  }
  return answered(spokenConfirmation(decision.tool, true, payload, name), mode);
}

export async function runAgentTurn(
  uid: string,
  body: unknown,
): Promise<AgentTurnResponse> {
  if (!body || typeof body !== "object") {
    throw new Error("Missing request body");
  }
  const request = body as AgentTurnRequest;
  const name = await readFirstName(uid);
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
    return applyDecision(
      uid,
      {
        tool: decision.tool,
        approved: decision.approved,
        summary: typeof decision.summary === "string" ? decision.summary : "",
        payload: asPayload(decision.payload),
      },
      name,
    );
  }

  const text = typeof request.text === "string" ? clip(request.text, 500) : "";
  if (!text) throw new Error("Say something first");
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
    );
  }
  const turn = await modelTurn(uid, text, name);
  const pending =
    turn.pendingTool ??
    (await mockTurn(text, await readState(uid))).pendingTool;
  if (!pending) return turn;
  return applyDecision(
    uid,
    {
      tool: pending.tool,
      approved: true,
      summary: pending.summary,
      payload: pending.payload,
    },
    name,
  );
}

export async function listAgentMemories(uid: string): Promise<AgentMemoryItem[]> {
  const state = await readState(uid);
  return state.memories;
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
  const state = await readState(uid);
  state.memories = state.memories.filter((item) => item.id !== id);
  await writeState(uid, state);
}
