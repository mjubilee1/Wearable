import { createHash, randomUUID } from "node:crypto";
import {
  FREE_MEMORY_RETENTION_DAYS,
  type AgentMemoryItem,
} from "@nearby/shared";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

export type MemorySource = AgentMemoryItem["source"];

export type StoredMemory = {
  id: string;
  user_id: string;
  text: string;
  summary: string;
  people: string[];
  dates: string[];
  created_at: number;
  embedding: number[];
  source: MemorySource;
};

const localMemories = new Map<string, StoredMemory[]>();
const DAY_MS = 24 * 60 * 60 * 1000;
const FALLBACK_DIMENSIONS = 64;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']{2,}/g) ?? [];
}

function fallbackEmbedding(text: string): number[] {
  const vector = Array<number>(FALLBACK_DIMENSIONS).fill(0);
  for (const word of words(text)) {
    const digest = createHash("sha256").update(word).digest();
    const index = digest.readUInt16BE(0) % vector.length;
    vector[index] += digest[2] % 2 === 0 ? 1 : -1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

async function embed(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallbackEmbedding(text);
  try {
    const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
        input: text,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vector = body.data?.[0]?.embedding;
    if (response.ok && Array.isArray(vector) && vector.length) return vector;
  } catch (error) {
    console.error("[memory] embedding failed", error);
  }
  return fallbackEmbedding(text);
}

function extractPeople(text: string): string[] {
  const ignored = new Set([
    "Nearby", "What", "When", "Where", "Please", "Remind", "Draft",
    "Move", "Check", "Save", "Create", "Tell", "Last", "Next", "Today",
    "Tomorrow", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
    "Saturday", "Sunday",
  ]);
  return [...new Set(text.match(/\b[A-Z][a-z]{2,}\b/g) ?? [])]
    .filter((name) => !ignored.has(name))
    .slice(0, 12);
}

function extractDates(text: string): string[] {
  const matches = text.match(
    /\b(?:today|tomorrow|yesterday|last|next)\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/gi,
  );
  return [...new Set((matches ?? []).map((value) => value.toLowerCase()))].slice(0, 12);
}

function fromStored(memory: StoredMemory): AgentMemoryItem {
  return {
    id: memory.id,
    userId: memory.user_id,
    text: memory.text,
    summary: memory.summary,
    people: memory.people,
    dates: memory.dates,
    createdAt: memory.created_at,
    source: memory.source,
  };
}

function normalizeStored(value: unknown): StoredMemory | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.user_id !== "string" ||
    typeof row.text !== "string" ||
    typeof row.created_at !== "number"
  ) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    text: row.text,
    summary: typeof row.summary === "string" ? row.summary : clip(row.text, 180),
    people: Array.isArray(row.people)
      ? row.people.filter((item): item is string => typeof item === "string")
      : [],
    dates: Array.isArray(row.dates)
      ? row.dates.filter((item): item is string => typeof item === "string")
      : [],
    created_at: row.created_at,
    embedding: Array.isArray(row.embedding)
      ? row.embedding.filter((item): item is number => typeof item === "number")
      : [],
    source:
      row.source === "voice_memo" || row.source === "remember"
        ? row.source
        : "command",
  };
}

export function memoryCutoff(
  plan: "free" | "pro",
  now = Date.now(),
): number | null {
  return plan === "pro" ? null : now - FREE_MEMORY_RETENTION_DAYS * DAY_MS;
}

export function applyMemoryPlanGate<T extends { createdAt: number }>(
  memories: T[],
  plan: "free" | "pro",
  now = Date.now(),
): T[] {
  const cutoff = memoryCutoff(plan, now);
  return cutoff === null ? memories : memories.filter((item) => item.createdAt >= cutoff);
}

async function readStored(uid: string): Promise<StoredMemory[]> {
  if (!isFirebaseConfigured()) return localMemories.get(uid) ?? [];
  const snapshot = await getFirebaseAdmin()
    .firestore()
    .collection(`memories/${uid}/items`)
    .get();
  return snapshot.docs
    .map((doc) => normalizeStored({ id: doc.id, ...(doc.data() ?? {}) }))
    .filter((item): item is StoredMemory => item !== null);
}

export async function saveMemory(
  uid: string,
  text: string,
  source: MemorySource,
): Promise<AgentMemoryItem | null> {
  const clean = clip(text, 20_000);
  if (!clean) return null;
  const stored: StoredMemory = {
    id: randomUUID(),
    user_id: uid,
    text: clean,
    summary: clip(clean, 180),
    people: extractPeople(clean),
    dates: extractDates(clean),
    created_at: Date.now(),
    embedding: await embed(clean),
    source,
  };
  if (!isFirebaseConfigured()) {
    localMemories.set(uid, [stored, ...(localMemories.get(uid) ?? [])]);
  } else {
    await getFirebaseAdmin()
      .firestore()
      .collection(`memories/${uid}/items`)
      .doc(stored.id)
      .set(stored);
  }
  return fromStored(stored);
}

export async function listMemories(
  uid: string,
  plan: "free" | "pro",
  query = "",
): Promise<AgentMemoryItem[]> {
  const visible = applyMemoryPlanGate(
    (await readStored(uid)).map(fromStored),
    plan,
  );
  if (!query.trim()) return visible.sort((a, b) => b.createdAt - a.createdAt);
  return searchMemories(uid, query, plan, visible);
}

function cosine(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    a += left[index] ** 2;
    b += right[index] ** 2;
  }
  return a && b ? dot / Math.sqrt(a * b) : 0;
}

export function rankMemoryRows(
  rows: Array<StoredMemory>,
  query: string,
  queryEmbedding: number[],
): StoredMemory[] {
  const queryWords = new Set(words(query));
  return rows
    .map((row) => {
      const searchable = new Set(words(
        `${row.text} ${row.summary} ${row.people.join(" ")} ${row.dates.join(" ")}`,
      ));
      const hits = [...queryWords].filter((word) => searchable.has(word)).length;
      const keyword = queryWords.size ? hits / queryWords.size : 0;
      const vector = cosine(row.embedding, queryEmbedding);
      return { row, score: keyword * 0.65 + Math.max(0, vector) * 0.35 };
    })
    .filter(({ score }) => score > 0.08)
    .sort((a, b) => b.score - a.score || b.row.created_at - a.row.created_at)
    .map(({ row }) => row);
}

export async function searchMemories(
  uid: string,
  query: string,
  plan: "free" | "pro",
  preloaded?: AgentMemoryItem[],
): Promise<AgentMemoryItem[]> {
  const allowedIds = preloaded
    ? new Set(preloaded.map((item) => item.id))
    : null;
  const rows = (await readStored(uid)).filter((row) => !allowedIds || allowedIds.has(row.id));
  const visibleRows = applyMemoryPlanGate(
    rows.map((row) => ({ ...row, createdAt: row.created_at })),
    plan,
  );
  return rankMemoryRows(visibleRows, query, await embed(query))
    .slice(0, 8)
    .map(fromStored);
}

export async function deleteMemory(uid: string, id: string): Promise<void> {
  if (!isFirebaseConfigured()) {
    localMemories.set(
      uid,
      (localMemories.get(uid) ?? []).filter((item) => item.id !== id),
    );
    return;
  }
  await getFirebaseAdmin()
    .firestore()
    .collection(`memories/${uid}/items`)
    .doc(id)
    .delete();
}

export async function deleteAllMemories(uid: string): Promise<void> {
  const rows = await readStored(uid);
  if (!isFirebaseConfigured()) {
    localMemories.delete(uid);
    return;
  }
  await Promise.all(
    rows.map((row) =>
      getFirebaseAdmin()
        .firestore()
        .collection(`memories/${uid}/items`)
        .doc(row.id)
        .delete(),
    ),
  );
}
