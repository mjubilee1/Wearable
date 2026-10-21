import assert from "node:assert/strict";
import test from "node:test";
import { parsePerceptionResult } from "./vision.js";

test("valid perception JSON is accepted", () => {
  const result = parsePerceptionResult(
    JSON.stringify({
      detectedObjects: [
        { type: "electrical_outlet", count: 1, confidence: 0.8 },
      ],
      attributes: [
        {
          key: "outlets_visible_count",
          value: 1,
          confidence: 0.8,
          evidence: "One outlet fixture is visible on the wall.",
        },
      ],
      limitations: [
        "Visibility does not prove the outlet works or is available for public use.",
      ],
    }),
    "obs_1",
    "fixture-v1",
  );
  assert.ok(result);
  assert.equal(result.attributes[0].key, "outlets_visible_count");
});

test("unsupported wifi or occupancy attributes are rejected", () => {
  assert.equal(
    parsePerceptionResult(
      JSON.stringify({
        detectedObjects: [],
        attributes: [
          {
            key: "wifi_quality",
            value: "good",
            confidence: 0.9,
            evidence: "Not a supported attribute.",
          },
        ],
        limitations: ["none"],
      }),
      "obs_2",
      "fixture-v1",
    ),
    null,
  );
});
