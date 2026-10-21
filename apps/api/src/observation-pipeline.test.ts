import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSpatialQueryIntent,
  type SpatialPlace,
} from "@nearby/shared";
import {
  assessConfidence,
  assessPlaceMatch,
  getPlaceInsights,
  resetObservationPipelineForTest,
  submitImageObservation,
  waitForSubmissionState,
} from "./observation-pipeline.js";
import { resetPlacesForTest, seedPlacesForTest } from "./places.js";
import {
  FixtureVisionProvider,
  parsePerceptionResult,
} from "./vision.js";

const center = {
  latitude: 38.9072,
  longitude: -77.0369,
  accuracyMeters: 12,
  timestamp: new Date().toISOString(),
};

function place(
  id: string,
  name: string,
  latitude: number,
  longitude: number,
): SpatialPlace {
  return {
    id,
    zoneId: "zone",
    name,
    category: "cafe",
    latitude,
    longitude,
    provider: "openstreetmap",
    providerPlaceId: id.replace("osm_", "").replace("_", "/"),
    externalIds: { openstreetmap: id },
    attributes: {},
    sources: [
      {
        provider: "openstreetmap",
        providerPlaceId: id,
        attribution: "© OpenStreetMap contributors",
        license: "ODbL",
        sourceUpdatedAt: null,
      },
    ],
    lastSyncedAt: new Date().toISOString(),
  };
}

function fixtureImage(marker: string): string {
  // Pad past the minimum validated image size while preserving the marker.
  return Buffer.from(`${marker}${".".repeat(64)}`, "utf8").toString("base64");
}

test.beforeEach(() => {
  resetObservationPipelineForTest();
  resetPlacesForTest();
  process.env.VISION_FIXTURE_MODE = "true";
  delete process.env.OPENAI_API_KEY;
});

test("malformed vision responses are rejected", () => {
  assert.equal(
    parsePerceptionResult("{not json", "obs", "model"),
    null,
  );
  assert.equal(
    parsePerceptionResult(
      JSON.stringify({
        detectedObjects: [{ type: "ghost", count: 1, confidence: 0.9 }],
        attributes: [],
        limitations: ["x"],
      }),
      "obs",
      "model",
    ),
    null,
  );
});

test("fixture vision extracts only marked attributes", async () => {
  const analysis = await new FixtureVisionProvider().analyze({
    observationId: "obs_1",
    mediaType: "image/jpeg",
    dataBase64: fixtureImage("FIXTURE_OUTLETS_2"),
  });
  assert.equal(analysis.usage.estimatedUsd, 0);
  assert.equal(
    analysis.result.attributes.find((row) => row.key === "outlets_visible_count")
      ?.value,
    2,
  );
});

test("nearest place alone stays ambiguous without a clear gap", () => {
  const assessment = assessPlaceMatch({
    location: center,
    candidates: [
      {
        ...place("osm_node_1", "Cafe A", 38.90725, -77.0369),
        distanceMeters: 8,
      },
      {
        ...place("osm_node_2", "Cafe B", 38.90728, -77.0369),
        distanceMeters: 12,
      },
    ],
  });
  assert.equal(assessment.state, "ambiguous");
  assert.equal(assessment.placeId, null);
});

test("user-selected place can publish when nearby", () => {
  const assessment = assessPlaceMatch({
    location: center,
    candidatePlaceId: "osm_node_1",
    candidates: [
      {
        ...place("osm_node_1", "Cafe A", 38.90721, -77.0369),
        distanceMeters: 5,
      },
      {
        ...place("osm_node_2", "Cafe B", 38.908, -77.0369),
        distanceMeters: 90,
      },
    ],
  });
  assert.equal(assessment.state, "matched");
  assert.equal(assessment.placeId, "osm_node_1");
});

test("confidence records conflict and agreement inputs", () => {
  const weak = assessConfidence({
    perceptionConfidence: 0.9,
    placeMatchConfidence: 0.9,
    sourceReliability: 0.7,
    observedAt: new Date().toISOString(),
    agreementCount: 0,
    conflictCount: 2,
  });
  const strong = assessConfidence({
    perceptionConfidence: 0.9,
    placeMatchConfidence: 0.9,
    sourceReliability: 0.7,
    observedAt: new Date().toISOString(),
    agreementCount: 2,
    conflictCount: 0,
  });
  assert.ok(strong.score > weak.score);
  assert.equal(weak.conflictCount, 2);
});

test("end-to-end image observation publishes grounded insights", async () => {
  const cafe = place("osm_node_10", "Pilot Cafe", 38.90722, -77.0369);
  seedPlacesForTest(center, [
    cafe,
    place("osm_node_11", "Far Cafe", 38.91, -77.0369),
  ]);

  const submission = await submitImageObservation(
    "user-a",
    {
      image: {
        mediaType: "image/jpeg",
        dataBase64: fixtureImage("prefix FIXTURE_OUTLETS_2 suffix"),
      },
      location: center,
      candidatePlaceId: cafe.id,
    },
    new FixtureVisionProvider(),
  );

  const finished = await waitForSubmissionState(
    submission.id,
    ["published", "review_required", "failed"],
    3_000,
  );
  assert.equal(finished.state, "published");
  assert.equal(finished.imageRetained, false);
  assert.ok(finished.observationIds.length >= 1);

  const insights = await getPlaceInsights(cafe.id);
  assert.ok(
    insights.insights.some((insight) => insight.attribute === "outlets_visible_count"),
  );
  assert.match(insights.insights[0].text, /outlet/i);
  assert.doesNotMatch(insights.insights[0].text, /wifi|works for sure|currently available seats$/i);
});

test("empty fixture images do not invent attributes", async () => {
  const cafe = place("osm_node_20", "Quiet Cafe", 38.90722, -77.0369);
  seedPlacesForTest(center, [cafe]);
  const submission = await submitImageObservation(
    "user-b",
    {
      image: {
        mediaType: "image/jpeg",
        dataBase64: fixtureImage("FIXTURE_EMPTY"),
      },
      location: center,
      candidatePlaceId: cafe.id,
    },
    new FixtureVisionProvider(),
  );
  const finished = await waitForSubmissionState(
    submission.id,
    ["published", "review_required", "failed"],
    3_000,
  );
  assert.equal(finished.state, "review_required");
  assert.deepEqual((await getPlaceInsights(cafe.id)).insights, []);
});

test("duplicate image submissions are idempotent", async () => {
  const cafe = place("osm_node_30", "Dup Cafe", 38.90722, -77.0369);
  seedPlacesForTest(center, [cafe]);
  const payload = {
    image: {
      mediaType: "image/jpeg" as const,
      dataBase64: fixtureImage("FIXTURE_OUTLETS_2"),
    },
    location: center,
    candidatePlaceId: cafe.id,
  };
  const first = await submitImageObservation(
    "user-c",
    payload,
    new FixtureVisionProvider(),
  );
  await waitForSubmissionState(first.id, ["published", "review_required", "failed"]);
  const second = await submitImageObservation(
    "user-c",
    payload,
    new FixtureVisionProvider(),
  );
  assert.equal(second.duplicateOf, first.id);
});

test("query intent parsing stays deterministic", () => {
  assert.equal(
    parseSpatialQueryIntent("Where can I charge my laptop nearby?"),
    "charging",
  );
  assert.equal(
    parseSpatialQueryIntent("Which cafes have seating available?"),
    "seating",
  );
});
