import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_COMMUNITY_CONTRIBUTORS,
  aggregationWindow,
  assignSpatialZone,
  confidenceScore,
  soundClassification,
  validateObservationInput,
  type EnvironmentalObservation,
} from "@nearby/shared";
import {
  SpatialError,
  aggregateObservationRows,
  deleteContributions,
  getSpatialSnapshot,
  historicalPatternsFromRows,
  resetSpatialForTest,
  startSensorSession,
  stopSensorSession,
  submitObservation,
} from "./spatial.js";

const dc = { latitude: 38.9072, longitude: -77.0369, accuracyMeters: 12 };

function row(
  id: string,
  userId: string,
  value: number,
  observedAt: number,
): EnvironmentalObservation {
  return {
    id,
    userId,
    sessionId: "session",
    zoneId: assignSpatialZone(dc).id,
    type: "sound_relative",
    value,
    unit: "relative",
    observedAt,
    source: "mobile",
    quality: { accuracyMeters: 12, qualityScore: 0.8, calibrated: false },
    expiresAt: observedAt + 1_000_000,
  };
}

test.beforeEach(() => resetSpatialForTest());

test("nearby coordinates map to the same deterministic zone", () => {
  const first = assignSpatialZone(dc, 200, 1);
  const second = assignSpatialZone(
    { latitude: 38.90725, longitude: -77.03685 },
    200,
    2,
  );
  assert.equal(first.id, second.id);
  assert.equal(first.resolutionMeters, 200);
  assert.ok(first.bounds.south <= dc.latitude);
  assert.ok(first.bounds.north >= dc.latitude);
});

test("aggregation windows are stable", () => {
  const timestamp = Date.UTC(2026, 9, 21, 13, 7);
  const window = aggregationWindow(timestamp, 15);
  assert.equal(window.start, Date.UTC(2026, 9, 21, 13, 0));
  assert.equal(window.end, Date.UTC(2026, 9, 21, 13, 15));
});

test("invalid and implausible observations are rejected", () => {
  const now = Date.now();
  assert.deepEqual(
    validateObservationInput({
      location: dc,
      type: "sound_relative",
      value: 1.5,
      observedAt: now,
    }),
    {
      valid: false,
      error: "Relative sound intensity must be between 0 and 1.",
    },
  );
  assert.equal(
    validateObservationInput({
      location: dc,
      type: "motion_state",
      value: "walking",
      observedAt: now - 25 * 60 * 60 * 1000,
    }).valid,
    false,
  );
});

test("confidence responds to quality, samples, diversity, and recency", () => {
  const weak = confidenceScore({
    quality: 0.2,
    observationCount: 1,
    contributorCount: 1,
    ageMs: 8 * 60 * 60 * 1000,
  });
  const strong = confidenceScore({
    quality: 0.9,
    observationCount: 20,
    contributorCount: 5,
    ageMs: 1_000,
  });
  assert.ok(strong > weak);
  assert.ok(strong <= 1);
});

test("personal aggregation returns measured facts", () => {
  const now = Date.now();
  const aggregate = aggregateObservationRows(
    [row("1", "a", 0.2, now - 2_000), row("2", "a", 0.6, now - 1_000)],
    "sound_relative",
    now,
    "personal",
  );
  assert.ok(aggregate);
  assert.equal(aggregate.value, 0.4);
  assert.equal(aggregate.classification, "Moderate");
  assert.equal(aggregate.provenance, "measured");
});

test("community aggregation fails closed below contributor threshold", () => {
  const now = Date.now();
  const rows = Array.from({ length: MIN_COMMUNITY_CONTRIBUTORS - 1 }, (_, index) =>
    row(String(index), `user-${index}`, 0.5, now - index),
  );
  assert.equal(
    aggregateObservationRows(rows, "sound_relative", now, "community"),
    null,
  );
});

test("historical baselines require at least three samples", () => {
  const hour = Date.UTC(2026, 9, 19, 12);
  assert.equal(historicalPatternsFromRows([row("1", "a", 0.3, hour)]).length, 0);
  const patterns = historicalPatternsFromRows([
    row("1", "a", 0.3, hour),
    row("2", "a", 0.5, hour + 1_000),
    row("3", "a", 0.7, hour + 2_000),
  ]);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].baseline, 0.5);
  assert.equal(patterns[0].sampleCount, 3);
});

test("sound classification compares recent values with a baseline", () => {
  assert.equal(soundClassification(0.8, 0.5), "Unusually loud");
  assert.equal(soundClassification(0.2, 0.5), "Quieter than usual");
});

test("session ownership, consent, stop, and deletion are enforced", async () => {
  const session = await startSensorSession("owner", {
    consent: { location: true, sound: true },
    enabledSensors: ["location", "sound"],
  });
  const observation = await submitObservation("owner", {
    sessionId: session.id,
    location: dc,
    type: "sound_relative",
    value: 0.4,
    observedAt: Date.now(),
    source: "mobile",
  });
  assert.equal(observation.userId, "owner");
  await assert.rejects(
    () => stopSensorSession("other", session.id),
    (error: unknown) => error instanceof SpatialError && error.code === "forbidden",
  );
  await stopSensorSession("owner", session.id);
  await assert.rejects(
    () =>
      submitObservation("owner", {
        sessionId: session.id,
        location: dc,
        type: "sound_relative",
        value: 0.2,
        observedAt: Date.now(),
        source: "mobile",
      }),
    (error: unknown) =>
      error instanceof SpatialError && error.code === "session_stopped",
  );
  assert.equal(await deleteContributions("owner"), 1);
});

test("demo snapshot is explicitly synthetic and personal missing data stays empty", async () => {
  const demo = await getSpatialSnapshot("user", dc, "demo");
  assert.equal(demo.mode, "demo");
  assert.ok(demo.aggregates.every((item) => item.provenance === "demonstration"));

  const personal = await getSpatialSnapshot("user", dc, "personal");
  assert.equal(personal.mode, "personal");
  assert.deepEqual(personal.aggregates, []);
  assert.deepEqual(personal.patterns, []);
});
