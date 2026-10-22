import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import {
  NETWORK_CONSENT_VERSION,
  activityWindow,
  canCollectSignal,
  createForegroundSensingController,
  negotiateCapabilities,
  normalizeMotionEstimate,
  platformSensingNotes,
  shouldSampleLocation,
  unsupportedProximityAdapter,
  type NodeObservationInput,
} from "@nearby/shared";
import { normalizeOverpassElement, resetPlacesForTest, seedPlacesForTest } from "./places.js";
import {
  failNextProcessingForTest,
  flushObservationQueueForTest,
  getAreaActivity,
  getAreaCoverage,
  getNearbyAreas,
  hangProcessingForTest,
  ingestNodeObservations,
  pauseObservationNode,
  readProcessedObservationForTest,
  registerObservationNetworkRoutes,
  registerObservationNode,
  resetObservationNetworkForTest,
  revokeObservationNode,
  setNetworkLoggerForTest,
  setNetworkTimingsForTest,
  setPlaceSyncForTest,
  collectExternalSources,
  networkMetrics,
} from "./observation-network.js";

const point = { latitude: 38.9072, longitude: -77.0369, accuracyMeters: 20 };

function installation(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function registration(index: number, nodeType: "MOBILE" | "WEB" = "MOBILE") {
  return {
    nodeType,
    installationId: installation(index),
    claimedCapabilities: [
      "location_foreground",
      "motion_estimate",
      "bluetooth_proximity",
      "wifi_presence",
      "background_location",
    ],
    consent: {
      version: NETWORK_CONSENT_VERSION,
      location: true,
      motion: true,
    },
  };
}

function locationObservation(
  id: string,
  at: number,
  location = point,
): NodeObservationInput {
  return {
    observationId: id,
    sensorType: "location",
    observedAt: new Date(at).toISOString(),
    location,
    attributes: { platform: "synthetic-test", confidence: 0.99 },
    metadata: { consentVersion: NETWORK_CONSENT_VERSION, schemaVersion: "1" },
  };
}

async function contribute(
  ownerId: string,
  nodeIndex: number,
  observationId: string,
  at: number,
  location = point,
) {
  const registered = await registerObservationNode(ownerId, registration(nodeIndex));
  const ingested = await ingestNodeObservations(ownerId, {
    nodeId: registered.node.id,
    observations: [locationObservation(observationId, at, location)],
  });
  return { registered, ingested };
}

test.beforeEach(() => {
  resetObservationNetworkForTest();
  resetPlacesForTest();
  setNetworkLoggerForTest(() => {});
  setPlaceSyncForTest(async () => 0);
});

test("node registration requires consent, negotiates capabilities, and is idempotent", async () => {
  await assert.rejects(
    () =>
      registerObservationNode("owner-a", {
        ...registration(1),
        consent: { version: "old", location: false, motion: false },
      }),
    /consent/i,
  );
  const first = await registerObservationNode("owner-a", registration(1));
  const second = await registerObservationNode("owner-a", registration(1));
  assert.equal(first.node.id, second.node.id);
  assert.equal(first.node.status, "ACTIVE");
  assert.deepEqual(first.node.capabilities, ["location_foreground", "motion_estimate"]);
  assert.equal(
    first.negotiation.rejected.some((row) => row.capability === "bluetooth_proximity"),
    true,
  );
  assert.equal(networkMetrics.nodesRegistered, 1);
  assert.equal("ownerId" in first.node, false);
});

test("another account cannot pause a node, and revoke stops collection", async () => {
  const { node } = await registerObservationNode("owner-a", registration(2));
  await assert.rejects(
    () => pauseObservationNode("owner-b", node.id),
    (error: unknown) =>
      error instanceof Error && "status" in error && error.status === 404,
  );
  await pauseObservationNode("owner-a", node.id);
  await assert.rejects(
    () =>
      ingestNodeObservations("owner-a", {
        nodeId: node.id,
        observations: [locationObservation("obs_paused1", Date.now())],
      }),
    /paused/i,
  );
  const active = await registerObservationNode("owner-a", registration(2));
  assert.equal(active.node.status, "ACTIVE");
  await revokeObservationNode("owner-a", node.id);
  await assert.rejects(
    () =>
      ingestNodeObservations("owner-a", {
        nodeId: node.id,
        observations: [locationObservation("obs_revoked1", Date.now())],
      }),
    /revoked/i,
  );
});

test("ingestion rejects bad timestamps, private identifiers, and implausible movement", async () => {
  const { node } = await registerObservationNode("owner-a", registration(3));
  const now = Date.now();
  const invalid = await ingestNodeObservations("owner-a", {
    nodeId: node.id,
    observations: [
      locationObservation("obs_oldtime", now - 48 * 60 * 60 * 1000),
    ],
  }, now);
  assert.equal(invalid.results[0]?.code, "invalid_timestamp");

  const identified = await ingestNodeObservations("owner-a", {
    nodeId: node.id,
    observations: [
      {
        ...locationObservation("obs_macaddr", now),
        attributes: { macAddress: "aa:bb:cc:dd:ee:ff" },
      },
    ],
  }, now);
  assert.equal(identified.results[0]?.code, "private_identifier");

  const first = await ingestNodeObservations("owner-a", {
    nodeId: node.id,
    observations: [locationObservation("obs_origin1", now)],
  }, now);
  assert.equal(first.results[0]?.status, "queued");
  const spoofed = await ingestNodeObservations(
    "owner-a",
    {
      nodeId: node.id,
      observations: [
        locationObservation("obs_spoofed", now + 120_000, {
          latitude: 48.8566,
          longitude: 2.3522,
          accuracyMeters: 15,
        }),
      ],
    },
    now + 120_000,
  );
  assert.equal(spoofed.results[0]?.code, "implausible_movement");
});

test("duplicate observations are idempotent and client confidence is ignored", async () => {
  const now = Date.now();
  const { node } = await registerObservationNode("owner-a", registration(4));
  const body = {
    nodeId: node.id,
    observations: [
      locationObservation("obs_sameid1", now, {
        latitude: 38.907212345,
        longitude: -77.036912345,
        accuracyMeters: 20,
      }),
    ],
  };
  const first = await ingestNodeObservations("owner-a", body, now);
  const second = await ingestNodeObservations("owner-a", body, now);
  assert.equal(first.results[0]?.status, "queued");
  assert.equal(second.results[0]?.status, "duplicate");
  await flushObservationQueueForTest();
  const stored = await readProcessedObservationForTest("obs_sameid1");
  assert.equal(stored?.status, "processed");
  assert.equal(stored?.placeId, null);
  assert.equal("confidence" in (stored?.attributes ?? {}), false);
  assert.equal(stored?.latitude, 38.9072);
  assert.equal(stored?.longitude, -77.0369);
});

test("ambiguous indoor fixes stay on the area and a single nearby place is not chosen", async () => {
  const now = Date.now();
  const north = normalizeOverpassElement({
    type: "node",
    id: 101,
    lat: point.latitude,
    lon: point.longitude,
    tags: { name: "North Cafe", amenity: "cafe" },
  });
  const south = normalizeOverpassElement({
    type: "node",
    id: 102,
    lat: point.latitude + 0.00012,
    lon: point.longitude,
    tags: { name: "South Cafe", amenity: "cafe" },
  });
  assert.ok(north && south);
  seedPlacesForTest(point, [north, south]);
  const { node } = await registerObservationNode("owner-a", registration(5));
  await ingestNodeObservations("owner-a", {
    nodeId: node.id,
    observations: [
      locationObservation("obs_ambiguous", now, {
        latitude: point.latitude + 0.00006,
        longitude: point.longitude,
        accuracyMeters: 40,
      }),
    ],
  }, now);
  await flushObservationQueueForTest();
  const stored = await readProcessedObservationForTest("obs_ambiguous");
  assert.equal(stored?.matchState, "ambiguous");
  assert.equal(stored?.placeId, null);
  assert.equal(stored?.precision, "block");
  assert.equal(stored?.candidatePlaceIds.length, 2);

  resetPlacesForTest();
  seedPlacesForTest(point, [north]);
  const alone = await registerObservationNode("owner-b", registration(6));
  await ingestNodeObservations("owner-b", {
    nodeId: alone.node.id,
    observations: [locationObservation("obs_singleplace", now + 60_000)],
  }, now + 60_000);
  await flushObservationQueueForTest();
  const single = await readProcessedObservationForTest("obs_singleplace");
  assert.equal(single?.placeId, null);
  assert.equal(single?.candidatePlaceIds.length, 1);
  assert.notEqual(single?.precision, "venue");
});

test("one account cannot publish an activity trend, even with repeated samples", async () => {
  const window = activityWindow(Date.now());
  const previousAt = window.start - 60_000;
  const currentAt = window.start + 60_000;
  const { node } = await registerObservationNode("owner-a", registration(7));
  for (const [index, at] of [previousAt, currentAt, currentAt + 70_000, currentAt + 140_000].entries()) {
    const result = await ingestNodeObservations(
      "owner-a",
      {
        nodeId: node.id,
        observations: [locationObservation(`obs_repeat${index}`, at)],
      },
      at,
    );
    assert.equal(result.results[0]?.status, "queued");
  }
  await flushObservationQueueForTest();
  const areas = await getNearbyAreas(point, currentAt + 150_000);
  const activity = areas.areas[0]?.activity;
  assert.ok(activity);
  assert.equal(activity?.value, "insufficient");
  assert.equal(activity?.label, "Insufficient observation coverage.");
  assert.equal(JSON.stringify(activity).includes("owner-a"), false);
  assert.equal(JSON.stringify(activity).includes(node.id), false);
});

test("three independent accounts in two windows produce a trend and then expire", async () => {
  const window = activityWindow(Date.now());
  const previousAt = window.start - 60_000;
  const currentAt = window.start + 60_000;
  for (const index of [1, 2, 3]) {
    await contribute(`owner-${index}`, index, `obs_prev_${index}`, previousAt);
  }
  for (const index of [1, 2, 3, 4, 5, 6]) {
    await contribute(`owner-${index}`, index, `obs_curr_${index}`, currentAt);
  }
  await flushObservationQueueForTest();
  const areas = await getNearbyAreas(point, currentAt);
  const activity = areas.areas.find((area) => area.activity)?.activity;
  assert.ok(activity);
  assert.equal(activity?.value, "increasing");
  assert.equal(activity?.evidenceStatus, "estimated");
  assert.equal(activity?.coverage, "sufficient");
  assert.match(activity?.label ?? "", /participating-device activity is increasing/i);
  assert.equal(JSON.stringify(activity).includes("obs_curr_1"), false);
  const expired = await getAreaActivity(
    activity!.geographicScope.areaId,
    Date.parse(activity!.expiresAt) + 1_000,
  );
  assert.equal(expired, null);
  const coverage = await getAreaCoverage(point, Date.parse(activity!.expiresAt) + 1_000);
  assert.equal(coverage.coverage, "insufficient");
  assert.equal(coverage.label, "Insufficient observation coverage.");
});

test("a smaller current cohort is a decrease, and two accounts stay unpublished", async () => {
  const window = activityWindow(Date.now());
  const previousAt = window.start - 60_000;
  const currentAt = window.start + 60_000;
  for (const index of [1, 2, 3, 4, 5, 6]) {
    await contribute(`owner-${index}`, index, `obs_down_prev_${index}`, previousAt);
  }
  for (const index of [1, 2, 3]) {
    await contribute(`owner-${index}`, index, `obs_down_curr_${index}`, currentAt);
  }
  await flushObservationQueueForTest();
  const activity = (await getNearbyAreas(point, currentAt)).areas[0]?.activity;
  assert.equal(activity?.value, "decreasing");

  resetObservationNetworkForTest();
  for (const index of [1, 2]) {
    await contribute(`owner-${index}`, index, `obs_sparse_${index}`, currentAt);
  }
  await flushObservationQueueForTest();
  const sparse = (await getNearbyAreas(point, currentAt)).areas[0]?.activity;
  assert.equal(sparse?.value, "insufficient");
});

test("processing retries transient failures and dead-letters timeouts", async () => {
  const now = Date.now();
  const { node } = await registerObservationNode("owner-a", registration(11));
  failNextProcessingForTest(1);
  await ingestNodeObservations("owner-a", {
    nodeId: node.id,
    observations: [locationObservation("obs_retryok", now)],
  }, now);
  await flushObservationQueueForTest();
  assert.equal((await readProcessedObservationForTest("obs_retryok"))?.status, "processed");
  assert.equal(networkMetrics.deadLetters, 0);

  setNetworkTimingsForTest({ timeoutMs: 20, retryMs: 5 });
  hangProcessingForTest(3);
  await ingestNodeObservations("owner-a", {
    nodeId: node.id,
    observations: [locationObservation("obs_timeout", now + 90_000)],
  }, now + 90_000);
  await flushObservationQueueForTest();
  assert.equal((await readProcessedObservationForTest("obs_timeout"))?.status, "dead");
  assert.equal(networkMetrics.deadLetters, 1);
  assert.ok(networkMetrics.timeouts >= 1);
});

test("external collection records source failures and does not invent missing feeds", async () => {
  setPlaceSyncForTest(async () => {
    throw new Error("Overpass unavailable");
  });
  const failed = await collectExternalSources();
  assert.equal(failed.find((run) => run.source === "openstreetmap")?.status, "failed");
  assert.equal(failed.find((run) => run.source === "public_transit")?.status, "unavailable");
  assert.equal(failed.some((run) => run.placeCount != null && run.status !== "ok"), false);

  setPlaceSyncForTest(async () => 7);
  const ok = await collectExternalSources();
  assert.equal(ok.find((run) => run.source === "openstreetmap")?.placeCount, 7);
  assert.equal(ok.find((run) => run.source === "public_events")?.status, "unavailable");
});

test("routes require auth and hide the operator report", async () => {
  const app = new Hono();
  registerObservationNetworkRoutes(app);
  const hidden = await app.request("/v1/spatial/nodes/me");
  assert.equal(hidden.status, 401);
  const previous = process.env.SPATIAL_ADMIN_UIDS;
  delete process.env.SPATIAL_ADMIN_UIDS;
  const denied = await app.request("/v1/internal/spatial/network", {
    headers: { Authorization: "Bearer dev" },
  });
  assert.equal(denied.status, 404);
  process.env.SPATIAL_ADMIN_UIDS = "dev-user";
  const allowed = await app.request("/v1/internal/spatial/network", {
    headers: { Authorization: "Bearer dev" },
  });
  assert.equal(allowed.status, 200);
  const report = (await allowed.json()) as { observations: { received: number } };
  assert.equal(typeof report.observations.received, "number");
  if (previous === undefined) delete process.env.SPATIAL_ADMIN_UIDS;
  else process.env.SPATIAL_ADMIN_UIDS = previous;
});

test("foreground controller respects permission denial and uploads one minimized sample", async () => {
  const denied = createForegroundSensingController({
    nodeType: "WEB",
    installationId: installation(20),
    consent: { location: true, motion: false },
    claimedCapabilities: ["location_foreground"],
    transport: {
      async register() {
        throw new Error("should not register");
      },
      async submit() {
        throw new Error("should not submit");
      },
    },
    location: {
      sensorType: "location",
      async isSupported() {
        return true;
      },
      async requestPermission() {
        return false;
      },
      async start() {},
      async stop() {},
      async readSample() {
        return point;
      },
    },
    schedule: () => () => {},
  });
  const blocked = await denied.start();
  assert.equal(blocked.running, false);
  assert.match(blocked.reason ?? "", /denied/i);

  const submitted: NodeObservationInput[][] = [];
  const controller = createForegroundSensingController({
    nodeType: "MOBILE",
    installationId: installation(21),
    consent: { location: true, motion: true },
    claimedCapabilities: ["location_foreground", "motion_estimate", "bluetooth_proximity"],
    transport: {
      async register(body) {
        const result = await registerObservationNode("owner-device", body);
        return { node: result.node };
      },
      async submit(body) {
        submitted.push(body.observations);
        const result = await ingestNodeObservations("owner-device", body);
        return { nodeStatus: result.nodeStatus, results: result.results };
      },
    },
    location: {
      sensorType: "location",
      async isSupported() {
        return true;
      },
      async requestPermission() {
        return true;
      },
      async start() {},
      async stop() {},
      async readSample() {
        return point;
      },
    },
    motion: {
      sensorType: "motion",
      async isSupported() {
        return true;
      },
      async requestPermission() {
        return true;
      },
      async start() {},
      async stop() {},
      async readEstimate() {
        return { accelerationVariance: 0.02, displacementMeters: 1, intervalMs: 1000 };
      },
    },
    schedule: () => () => {},
  });
  const started = await controller.start();
  assert.equal(started.running, true);
  await controller.tick(Date.now());
  await controller.flush();
  await controller.stop();
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]?.[0]?.sensorType, "motion");
  assert.equal(submitted[0]?.[0]?.attributes?.motionState, "stationary");
  await flushObservationQueueForTest();
});

test("shared sensing rules cover motion, sampling, and platform limits", async () => {
  assert.equal(
    normalizeMotionEstimate({
      accelerationVariance: 0.8,
      displacementMeters: 20,
      intervalMs: 60_000,
    }).state,
    "walking",
  );
  assert.deepEqual(
    canCollectSignal({
      consentGranted: true,
      permissionGranted: false,
      nodeStatus: "ACTIVE",
      capabilityEnabled: true,
    }),
    { ok: false, reason: "Device permission was denied." },
  );
  const decision = shouldSampleLocation({
    previous: { ...point, observedAt: 0 },
    next: point,
    now: 70_000,
  });
  assert.equal(decision.sample, false);
  const web = negotiateCapabilities(
    "WEB",
    ["location_foreground", "background_location"],
    { location: true, motion: false },
  );
  assert.deepEqual(web.accepted, ["location_foreground"]);
  assert.equal(platformSensingNotes("WEB").backgroundLocation, false);
  assert.equal(platformSensingNotes("MOBILE").bluetoothProximity, false);
  const bluetooth = unsupportedProximityAdapter("bluetooth");
  assert.equal(await bluetooth.isSupported(), false);
  await assert.rejects(() => bluetooth.start(), /Bluetooth/);
});
