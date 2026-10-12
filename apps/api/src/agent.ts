import { randomUUID } from "node:crypto";
import {
  isAgentToolName,
  type AgentMemoryItem,
  type AgentPendingTool,
  type AgentToolName,
  type AgentTurnRequest,
  type AgentTurnResponse,
} from "@nearby/shared";
import { speakTodaysCalendar } from "./connectors/google-calendar.js";
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
  return {
    id: row.id,
    text: row.text,
    when: typeof row.when === "string" ? row.when : undefined,
    createdAt: typeof row.createdAt === "number" ? row.createdAt : Date.now(),
  };
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
    notes: state.notes,
    reminders: state.reminders,
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

function mockTurn(text: string): AgentTurnResponse {
  const spoken = clip(text);
  const lower = spoken.toLowerCase();
  if (!spoken) {
    return { reply: "I didn't catch that.", pendingTool: null, mode: "mock" };
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
  return {
    reply: "I can take a note, set a reminder, or check your calendar. Which one?",
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

async function modelTurn(text: string): Promise<AgentTurnResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return mockTurn(text);

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
              "You are Nearby, a voice assistant. The user spoke one turn. Reply in one or two short sentences meant to be spoken aloud. No markdown, lists, or emoji. Do not claim you saved, reminded, remembered, or checked a calendar. If they want a calendar check, a note, a reminder, or for you to remember a fact, ask permission in reply and set tool. Otherwise tool is null. Return JSON only: {\"reply\":string,\"tool\":null|{name:\"calendar\"|\"note\"|\"reminder\"|\"remember\",summary:string,payload:object}}. Payload keys: note text; reminder text and when; remember text; calendar when.",
          },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) {
      console.error("[agent] LLM error", await res.text());
      return mockTurn(text);
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    return (content && parseModel(content)) || mockTurn(text);
  } catch (error) {
    console.error("[agent] LLM request failed", error);
    return mockTurn(text);
  }
}

function spokenConfirmation(
  tool: AgentToolName,
  approved: boolean,
  payload: Record<string, string>,
): string {
  if (!approved) return "Okay. I won't.";
  if (tool === "remember") return "I'll remember that.";
  if (tool === "note") return "Saved.";
  if (tool === "reminder") {
    return payload.when ? `Reminder set for ${payload.when}.` : "Reminder set.";
  }
  return "Okay.";
}

async function applyDecision(
  uid: string,
  decision: NonNullable<AgentTurnRequest["decision"]>,
): Promise<AgentTurnResponse> {
  const payload = asPayload(decision.payload);
  const summary = clip(decision.summary || payload.text || "");
  const mode = process.env.OPENAI_API_KEY ? "openai" : "mock";

  if (!decision.approved) {
    return { reply: "Okay. I won't.", pendingTool: null, mode };
  }

  if (decision.tool === "calendar") {
    const reply = clip(await speakTodaysCalendar(uid), 320);
    return { reply, pendingTool: null, mode };
  }

  const state = await readState(uid);
  const text = clip(payload.text || summary, 280);
  if (text) {
    if (decision.tool === "remember") {
      state.memories = [
        { id: randomUUID(), text, createdAt: Date.now() },
        ...state.memories,
      ].slice(0, 50);
    } else if (decision.tool === "note") {
      state.notes = [
        { id: randomUUID(), text, createdAt: Date.now() },
        ...state.notes,
      ].slice(0, 50);
    } else if (decision.tool === "reminder") {
      state.reminders = [
        {
          id: randomUUID(),
          text,
          when: payload.when || undefined,
          createdAt: Date.now(),
        },
        ...state.reminders,
      ].slice(0, 50);
    }
    await writeState(uid, state);
  }
  return {
    reply: spokenConfirmation(decision.tool, true, payload),
    pendingTool: null,
    mode,
  };
}

export async function runAgentTurn(
  uid: string,
  body: unknown,
): Promise<AgentTurnResponse> {
  if (!body || typeof body !== "object") {
    throw new Error("Missing request body");
  }
  const request = body as AgentTurnRequest;
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
    return applyDecision(uid, {
      tool: decision.tool,
      approved: decision.approved,
      summary: typeof decision.summary === "string" ? decision.summary : "",
      payload: asPayload(decision.payload),
    });
  }

  const text = typeof request.text === "string" ? clip(request.text, 500) : "";
  if (!text) throw new Error("Say something first");
  return modelTurn(text);
}

export async function listAgentMemories(uid: string): Promise<AgentMemoryItem[]> {
  const state = await readState(uid);
  return state.memories;
}

export async function deleteAgentMemory(uid: string, id: string): Promise<void> {
  const state = await readState(uid);
  state.memories = state.memories.filter((item) => item.id !== id);
  await writeState(uid, state);
}
