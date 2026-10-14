import assert from "node:assert/strict";
import test from "node:test";
import {
  VoiceMemoAccessError,
  assertVoiceMemoAllowed,
  parseVoiceMemoModelOutput,
} from "./voice-memos.js";

test("parses a valid voice memo recap and rejects malformed model JSON", () => {
  const parsed = parseVoiceMemoModelOutput(
    JSON.stringify({
      recap: "• Loved the kitchen\n• Concerned about the roof\n• Follow up Friday",
      actions: [
        {
          type: "reminder",
          details: { title: "Follow up with the Johnsons", when: "Friday" },
        },
      ],
    }),
  );
  assert.deepEqual(parsed, {
    recap: "• Loved the kitchen\n• Concerned about the roof\n• Follow up Friday",
    actions: [
      {
        type: "reminder",
        details: { title: "Follow up with the Johnsons", when: "Friday" },
      },
    ],
  });
  assert.equal(parseVoiceMemoModelOutput('{"recap":"one","actions":[]}'), null);
  assert.equal(
    parseVoiceMemoModelOutput(
      '{"recap":"a\\nb\\nc","actions":[{"type":"send_email","details":{"to":"x"}}]}',
    ),
    null,
  );
});

test("voice memo recording is gated to Pro", () => {
  assert.throws(
    () => assertVoiceMemoAllowed("free", 0, 30),
    (error: unknown) =>
      error instanceof VoiceMemoAccessError && error.code === "pro_required",
  );
  assert.doesNotThrow(() => assertVoiceMemoAllowed("pro", 0, 30));
});

test("voice memo monthly cap allows exactly 300 minutes and rejects overflow", () => {
  assert.doesNotThrow(() => assertVoiceMemoAllowed("pro", 299 * 60, 60));
  assert.throws(
    () => assertVoiceMemoAllowed("pro", 300 * 60, 1),
    (error: unknown) =>
      error instanceof VoiceMemoAccessError &&
      error.code === "voice_memo_limit",
  );
  assert.throws(
    () => assertVoiceMemoAllowed("pro", 299 * 60 + 45, 30),
    (error: unknown) =>
      error instanceof VoiceMemoAccessError &&
      error.code === "voice_memo_limit",
  );
});
