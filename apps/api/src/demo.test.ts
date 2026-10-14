import assert from "node:assert/strict";
import test from "node:test";
import { nextDemoCount, runDemoTurn } from "./demo.js";

test("demo rate limiting allows three tries per day and blocks the fourth", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");
  let counter = null;
  for (let remaining = 2; remaining >= 0; remaining -= 1) {
    const result = nextDemoCount(counter, now);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, remaining);
    counter = result.counter;
  }
  const blocked = nextDemoCount(counter, now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);

  const tomorrow = nextDemoCount(counter, new Date("2026-10-15T00:00:00.000Z"));
  assert.equal(tomorrow.allowed, true);
  assert.equal(tomorrow.remaining, 2);
});

test("demo tools always return fake receipts without external links", () => {
  const response = runDemoTurn("Check my unread inbox");
  assert.match(response.reply, /demo|unread/i);
  assert.equal(response.receipt?.href, null);
  assert.match(response.receipt?.action ?? "", /demo/i);
});
