import { createHash } from "node:crypto";
import {
  DEMO_TRY_LIMIT,
  type AgentActionReceipt,
  type AgentTurnResponse,
} from "@nearby/shared";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

type DemoCounter = { day: string; count: number };
const localCounters = new Map<string, DemoCounter>();

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function counterId(identifier: string, day: string): string {
  return `${day}-${createHash("sha256").update(identifier).digest("hex").slice(0, 32)}`;
}

export function nextDemoCount(
  current: DemoCounter | null,
  now = new Date(),
): { allowed: boolean; counter: DemoCounter; remaining: number } {
  const day = utcDay(now);
  const count = current?.day === day ? current.count : 0;
  if (count >= DEMO_TRY_LIMIT) {
    return {
      allowed: false,
      counter: { day, count },
      remaining: 0,
    };
  }
  const next = { day, count: count + 1 };
  return {
    allowed: true,
    counter: next,
    remaining: DEMO_TRY_LIMIT - next.count,
  };
}

export async function consumeDemoTry(
  identifier: string,
  now = new Date(),
): Promise<{ allowed: boolean; remaining: number }> {
  const day = utcDay(now);
  const id = counterId(identifier, day);
  if (!isFirebaseConfigured()) {
    const result = nextDemoCount(localCounters.get(id) ?? null, now);
    localCounters.set(id, result.counter);
    return { allowed: result.allowed, remaining: result.remaining };
  }
  const db = getFirebaseAdmin().firestore();
  const ref = db.collection("demoRateLimits").doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data() ?? {};
    const current: DemoCounter | null =
      typeof data.day === "string" && typeof data.count === "number"
        ? { day: data.day, count: data.count }
        : null;
    const result = nextDemoCount(current, now);
    transaction.set(ref, {
      ...result.counter,
      updatedAt: now.getTime(),
    });
    return { allowed: result.allowed, remaining: result.remaining };
  });
}

function done(action: string): AgentActionReceipt {
  return { action, href: null, linkLabel: null };
}

export function runDemoTurn(text: string): AgentTurnResponse {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 500);
  const lower = clean.toLowerCase();
  let reply: string;
  let receipt: AgentActionReceipt;

  if (/\b(inbox|email|gmail|unread)\b/.test(lower)) {
    reply =
      "You have two unread messages: Sarah approved the proposal, and Jordan moved Friday's interview.";
    receipt = done("Summarized 2 demo inbox messages");
  } else if (/\b(calendar|agenda|schedule|meeting|call)\b/.test(lower)) {
    if (/\b(move|reschedule)\b/.test(lower)) {
      reply = "Done. I moved the demo client call to tomorrow at 10 AM.";
      receipt = done("Moved demo client call to tomorrow at 10:00 AM");
    } else {
      reply = "Your demo calendar has a client call at 2 PM and a team review at 4 PM.";
      receipt = done("Checked the demo calendar");
    }
  } else if (/\b(remind|task|to-do|todo)\b/.test(lower)) {
    reply = "Done. I added that to your demo task list.";
    receipt = done(`Added demo task: ${clean.slice(0, 100)}`);
  } else if (/\b(draft|reply|follow up|follow-up)\b/.test(lower)) {
    reply = "Done. I drafted a short follow-up in the demo inbox.";
    receipt = done("Drafted a demo follow-up email");
  } else {
    reply = "Done. I saved that in your demo notes.";
    receipt = done(`Saved demo note: ${clean.slice(0, 100)}`);
  }

  return {
    reply,
    pendingTool: null,
    receipt,
    preview: null,
    mode: "mock",
  };
}
