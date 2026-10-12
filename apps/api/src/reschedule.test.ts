import assert from "node:assert/strict";
import test from "node:test";
import { cancelHistoryItems } from "./agent.js";
import {
  parseRescheduleRequest,
  resolveRescheduleChoice,
  zonedClock,
  type TimedCalendarEvent,
} from "./connectors/google-calendar.js";
import { zonedTimeToUtc } from "./timezone.js";

const tz = "America/New_York";

test("3 PM ET is not the UTC hour", () => {
  const start = new Date("2026-10-12T19:00:00Z");
  assert.equal(start.getUTCHours(), 19);
  const local = zonedClock(start, tz);
  assert.deepEqual(local, { hour: 15, minute: 0 });
});

test("move my 3 PM to tomorrow at 10 previews Monday 10:00 AM", () => {
  const now = zonedTimeToUtc(tz, 2026, 10, 11, 23, 40);
  const startAt = zonedTimeToUtc(tz, 2026, 10, 12, 15, 0);
  assert.equal(startAt.toISOString(), "2026-10-12T19:00:00.000Z");

  const parsed = parseRescheduleRequest("move my 3 PM to tomorrow at 10", tz, now);
  assert.equal(parsed?.ok, true);
  if (!parsed?.ok) return;

  const event: TimedCalendarEvent = {
    id: "robinson",
    title: "Look into: Robinson Group",
    htmlLink: null,
    startAt,
    endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
  };
  const choice = resolveRescheduleChoice([event], parsed, tz, now);
  assert.equal(choice.ok, true);
  if (!choice.ok) return;
  assert.equal(choice.event.id, "robinson");
  assert.match(choice.oldWhen, /Mon, Oct 12 at 3:00 PM/);
  assert.match(choice.newWhen, /Mon, Oct 12 at 10:00 AM/);
});

test("cancel marks the preview and does not add a turn", () => {
  const history = [
    {
      id: "preview-1",
      request: "move my 3 PM to tomorrow at 10",
      reply: "Move 'Look into: Robinson Group' from Mon, Oct 12 at 3:00 PM to Mon, Oct 12 at 10:00 AM?",
      receipt: null,
      createdAt: 1,
    },
  ];
  const next = cancelHistoryItems(history, "preview-1");
  assert.equal(next.length, history.length);
  assert.equal(next[0]?.id, "preview-1");
  assert.equal(next[0]?.status, "cancelled");
  assert.equal(next[0]?.request, history[0]?.request);
});
