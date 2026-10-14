import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMemoryPlanGate,
  rankMemoryRows,
  type StoredMemory,
} from "./memories.js";

function row(
  id: string,
  text: string,
  createdAt: number,
  embedding: number[],
): StoredMemory {
  return {
    id,
    user_id: "user-1",
    text,
    summary: text,
    people: text.includes("Sarah") ? ["Sarah"] : [],
    dates: [],
    created_at: createdAt,
    embedding,
    source: "voice_memo",
  };
}

test("memory search combines keyword and vector relevance", () => {
  const rows = [
    row("proposal", "Sarah approved the client proposal", 2, [1, 0]),
    row("lunch", "Lunch order with Jordan", 3, [0, 1]),
  ];
  const ranked = rankMemoryRows(rows, "What did Sarah say about the proposal?", [1, 0]);
  assert.equal(ranked[0]?.id, "proposal");
  assert.equal(ranked.some((item) => item.id === "lunch"), false);
});

test("free memory is limited to seven days while Pro keeps all history", () => {
  const now = Date.parse("2026-10-14T12:00:00.000Z");
  const recent = { id: "recent", createdAt: now - 6 * 24 * 60 * 60 * 1000 };
  const old = { id: "old", createdAt: now - 8 * 24 * 60 * 60 * 1000 };
  assert.deepEqual(
    applyMemoryPlanGate([recent, old], "free", now).map((item) => item.id),
    ["recent"],
  );
  assert.deepEqual(
    applyMemoryPlanGate([recent, old], "pro", now).map((item) => item.id),
    ["recent", "old"],
  );
});
