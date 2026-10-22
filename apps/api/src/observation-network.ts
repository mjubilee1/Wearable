import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  ACTIVITY_INSIGHT_TTL_MS,
  ACTIVITY_WINDOW_MINUTES,
  MAX_OBSERVATION_BATCH,
  MAX_OBSERVATION_PAYLOAD_BYTES,
  MIN_COMMUNITY_CONTRIBUTORS,
  NETWORK_CONSENT_VERSION,
  NETWORK_RULESET_VERSION,
  NETWORK_SCHEMA_VERSION,
  OBSERVATION_RETENTION_MS,
  activityWindow,
  classifyProcessingError,
  fuseNodeEvidence,
  inferAreaActivity,
  isInsightCurrent,
  isInstallationId,
  isNodeType,
  matchObservationToArea,
  negotiateCapabilities,
  reduceCoordinate,
  validateNodeObservation,
  type ActivityTrend,
  type GeoPoint,
  type MotionState,
  type NearbyArea,
  type NodeObservationInput,
  type NodeStatus,
  type ObservationNodePublic,
  type PublicAreaActivity,
} from "@nearby/shared";
import { verifyAuth } from "./auth.js";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";
import { cachedPlacesNear, placeIngestionMetrics } from "./places.js";

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const PROCESS_ATTEMPTS = 3;
const METHODOLOGY =
  "Distinct consenting accounts in the current and previous 15-minute windows. A trend is published only when both windows include at least 3 accounts. Repeated readings from one node count once, and extra devices from the same account do not increase the cohort. Client-supplied confidence is ignored.";

type StoredNode = ObservationNodePublic & {
  ownerId: string;
  installationId: string;
  consent: { location: boolean; motion: boolean };
  lastFix: { latitude: number; longitude: number; observedAt: number } | null;
};

type StoredObservation = {
  id: string;
  nodeId: string;
  ownerId: string;
  sensorType: "location" | "motion";
  observedAt: string;
  observedAtMs: number;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  zoneId: string | null;
  precision: string | null;
  matchState: string | null;
  placeId: null;
  candidatePlaceIds: string[];
  motionState: MotionState | null;
  attributes: Record<string, string | number | boolean>;
  status: "queued" | "processed" | "dead";
  attempts: number;
  createdAt: string;
  processedAt: string | null;
  expiresAt: string;
};

type WindowRollup = {
  id: string;
  zoneId: string;
  windowStart: number;
  windowEnd: number;
  nodeIds: string[];
  ownerIds: string[];
  observationIds: string[];
  ambiguousObservations: number;
  motionStates: Record<string, MotionState>;
  center: GeoPoint;
  precision: PublicAreaActivity["geographicScope"]["precision"];
};

type StoredInsight = PublicAreaActivity & {
  independentNodeCount: number;
  repeatedReadings: number;
  motionAgreement: "consistent" | "conflicting" | "not_compared";
  center: GeoPoint;
};

type DeadLetter = {
  observationId: string;
  nodeId: string;
  errorClass: string;
  message: string;
  at: string;
};

type SourceRun = {
  source: "openstreetmap" | "public_events" | "public_transit" | "business_api" | "iot";
  status: "ok" | "failed" | "unavailable";
  detail: string;
  placeCount?: number;
  ranAt: string;
};

export class NetworkError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "network_error",
  ) {
    super(message);
  }
}

const nodes = new Map<string, StoredNode>();
const observations = new Map<string, StoredObservation>();
const windows = new Map<string, WindowRollup>();
const insights = new Map<string, StoredInsight>();
const insightHistory = new Map<string, StoredInsight>();
const consentEvents: Array<Record<string, unknown>> = [];
const deadLetters: DeadLetter[] = [];
const sourceRuns: SourceRun[] = [];
const rateCounters = new Map<string, { count: number; resetAt: number }>();
const pending = new Set<Promise<void>>();

export const networkMetrics = {
  nodesRegistered: 0,
  observationsReceived: 0,
  observationsAccepted: 0,
  observationsRejected: 0,
  duplicates: 0,
  matched: 0,
  ambiguous: 0,
  deadLetters: 0,
  timeouts: 0,
  latencyMsTotal: 0,
  latencySamples: 0,
  estimatedProcessingCostUsd: 0,
};

let retryDelayMs = 150;
let processingTimeoutMs = 8_000;
let remainingFailures = 0;
let injectedError: Error | null = null;
let placeSync: () => Promise<number> = async () => {
  const { syncConfiguredPilotPlaces } = await import("./places.js");
  return syncConfiguredPilotPlaces();
};
let logNetwork: (entry: Record<string, unknown>) => void = (entry) => {
  console.log(JSON.stringify({ service: "observation-network", ...entry }));
};
let collectionTimer: ReturnType<typeof setInterval> | null = null;

function log(event: string, fields: Record<string, unknown> = {}) {
  logNetwork({ event, at: new Date().toISOString(), ...fields });
}

function windowId(zoneId: string, windowStart: number): string {
  return `${zoneId}_${windowStart}`;
}

function insightId(zoneId: string, windowStart: number): string {
  return `insight_${zoneId}_${windowStart}`;
}

function nodeIdFor(ownerId: string, nodeType: string, installationId: string): string {
  return `node_${createHash("sha256")
    .update(`${ownerId}:${nodeType}:${installationId}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function publicNode(node: StoredNode): ObservationNodePublic {
  return {
    id: node.id,
    nodeType: node.nodeType,
    capabilities: node.capabilities,
    consentVersion: node.consentVersion,
    status: node.status,
    registeredAt: node.registeredAt,
    lastSeenAt: node.lastSeenAt,
  };
}

function toPublicInsight(insight: StoredInsight, now: number): PublicAreaActivity {
  return {
    id: insight.id,
    insightType: insight.insightType,
    geographicScope: insight.geographicScope,
    value: insight.value,
    label: insight.label,
    evidenceStatus: insight.evidenceStatus,
    observedAt: insight.observedAt,
    windowStart: insight.windowStart,
    windowEnd: insight.windowEnd,
    generatedAt: insight.generatedAt,
    expiresAt: insight.expiresAt,
    observationAgeSeconds: Math.max(
      0,
      Math.round((now - Date.parse(insight.windowEnd)) / 1000),
    ),
    coverage: insight.coverage,
    sourceCategory: insight.sourceCategory,
    rulesetVersion: insight.rulesetVersion,
    methodology: insight.methodology,
    verificationStatus: insight.verificationStatus,
    limitations: insight.limitations,
  };
}

async function persistNode(node: StoredNode): Promise<void> {
  nodes.set(node.id, node);
  if (!isFirebaseConfigured()) return;
  const stored = { ...node };
  await getFirebaseAdmin()
    .firestore()
    .collection("observationNodes")
    .doc(node.id)
    .set(stored as unknown as Record<string, unknown>);
}

async function readNode(nodeId: string): Promise<StoredNode | null> {
  if (!isFirebaseConfigured()) return nodes.get(nodeId) ?? null;
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("observationNodes")
    .doc(nodeId)
    .get();
  if (!snap.exists) return null;
  const node = snap.data() as StoredNode;
  nodes.set(node.id, node);
  return node;
}

async function persistObservation(row: StoredObservation): Promise<void> {
  observations.set(row.id, row);
  if (!isFirebaseConfigured()) return;
  await getFirebaseAdmin()
    .firestore()
    .collection("nodeObservations")
    .doc(row.id)
    .set(row as unknown as Record<string, unknown>);
}

async function readObservation(id: string): Promise<StoredObservation | null> {
  if (!isFirebaseConfigured()) return observations.get(id) ?? null;
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("nodeObservations")
    .doc(id)
    .get();
  if (!snap.exists) return null;
  const row = snap.data() as StoredObservation;
  observations.set(row.id, row);
  return row;
}

async function persistWindow(row: WindowRollup): Promise<void> {
  windows.set(row.id, row);
  if (!isFirebaseConfigured()) return;
  await getFirebaseAdmin()
    .firestore()
    .collection("areaActivityWindows")
    .doc(row.id)
    .set(row as unknown as Record<string, unknown>);
}

async function readWindow(id: string): Promise<WindowRollup | null> {
  if (!isFirebaseConfigured()) return windows.get(id) ?? null;
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("areaActivityWindows")
    .doc(id)
    .get();
  if (!snap.exists) return null;
  const row = snap.data() as WindowRollup;
  windows.set(row.id, row);
  return row;
}

async function persistInsight(row: StoredInsight): Promise<void> {
  insightHistory.set(row.id, row);
  insights.set(row.geographicScope.areaId, row);
  if (!isFirebaseConfigured()) return;
  const db = getFirebaseAdmin().firestore();
  await Promise.all([
    db
      .collection("areaActivityInsights")
      .doc(row.id)
      .set(row as unknown as Record<string, unknown>),
    db
      .collection("areaActivityCurrent")
      .doc(row.geographicScope.areaId)
      .set(row as unknown as Record<string, unknown>),
  ]);
}

async function readInsight(areaId: string): Promise<StoredInsight | null> {
  if (!isFirebaseConfigured()) return insights.get(areaId) ?? null;
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("areaActivityCurrent")
    .doc(areaId)
    .get();
  if (!snap.exists) return null;
  const row = snap.data() as StoredInsight;
  insights.set(areaId, row);
  return row;
}

async function rememberConsent(event: Record<string, unknown>): Promise<void> {
  consentEvents.push(event);
  if (!isFirebaseConfigured()) return;
  await getFirebaseAdmin()
    .firestore()
    .collection("observationConsentEvents")
    .doc(String(event.id))
    .set(event);
}

async function enforceRateLimit(ownerId: string, amount: number): Promise<void> {
  const now = Date.now();
  if (isFirebaseConfigured()) {
    const bucket = Math.floor(now / RATE_WINDOW_MS);
    const db = getFirebaseAdmin().firestore();
    const ref = db
      .collection("rateLimits")
      .doc(
        createHash("sha256")
          .update(`${ownerId}:node-observations:${bucket}`)
          .digest("hex"),
      );
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const count = Number(snapshot.data()?.count ?? 0);
      if (count + amount > RATE_LIMIT) {
        throw new NetworkError(
          "Too many observations. Try again in a minute.",
          429,
          "rate_limited",
        );
      }
      transaction.set(ref, {
        uid: ownerId,
        action: "node-observations",
        count: count + amount,
        expiresAt: (bucket + 1) * RATE_WINDOW_MS,
      });
    });
    return;
  }
  const current = rateCounters.get(ownerId);
  if (!current || current.resetAt <= now) {
    if (amount > RATE_LIMIT) {
      throw new NetworkError(
        "Too many observations. Try again in a minute.",
        429,
        "rate_limited",
      );
    }
    rateCounters.set(ownerId, { count: amount, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  if (current.count + amount > RATE_LIMIT) {
    throw new NetworkError(
      "Too many observations. Try again in a minute.",
      429,
      "rate_limited",
    );
  }
  current.count += amount;
}

function zoneIdsAround(center: GeoPoint): string[] {
  const ids = new Set<string>();
  const latStep = 200 / 111_320;
  const lonStep =
    200 /
    (111_320 * Math.max(0.2, Math.cos((center.latitude * Math.PI) / 180)));
  for (const y of [-1, 0, 1]) {
    for (const x of [-1, 0, 1]) {
      ids.add(
        matchObservationToArea(
          {
            latitude: Math.max(-90, Math.min(90, center.latitude + y * latStep)),
            longitude: Math.max(-180, Math.min(180, center.longitude + x * lonStep)),
            accuracyMeters: 50,
          },
          [],
        ).zoneId,
      );
    }
  }
  return [...ids];
}

export async function registerObservationNode(
  ownerId: string,
  body: unknown,
  now = Date.now(),
): Promise<{
  node: ObservationNodePublic;
  negotiation: ReturnType<typeof negotiateCapabilities>;
}> {
  const row = (body ?? {}) as Record<string, unknown>;
  if (!isNodeType(row.nodeType)) {
    throw new NetworkError("A supported node type is required.");
  }
  if (!isInstallationId(row.installationId)) {
    throw new NetworkError("A client installation id is required.");
  }
  const consent = (row.consent ?? {}) as Record<string, unknown>;
  if (consent.version !== NETWORK_CONSENT_VERSION || consent.location !== true) {
    throw new NetworkError(
      "Foreground location consent is required before sensing can start.",
      403,
      "sensor_consent_required",
    );
  }
  const claimed = Array.isArray(row.claimedCapabilities)
    ? row.claimedCapabilities.filter((item): item is string => typeof item === "string")
    : [];
  const negotiation = negotiateCapabilities(row.nodeType, claimed, {
    location: true,
    motion: consent.motion === true,
  });
  if (!negotiation.accepted.includes("location_foreground")) {
    throw new NetworkError(
      "This node cannot provide foreground location.",
      403,
      "capability_rejected",
    );
  }
  const id = nodeIdFor(ownerId, row.nodeType, row.installationId);
  const existing = await readNode(id);
  const next: StoredNode = {
    id,
    ownerId,
    installationId: row.installationId,
    nodeType: row.nodeType,
    capabilities: negotiation.accepted,
    consentVersion: NETWORK_CONSENT_VERSION,
    consent: { location: true, motion: consent.motion === true },
    status: "ACTIVE",
    registeredAt: existing?.registeredAt ?? new Date(now).toISOString(),
    lastSeenAt: existing?.lastSeenAt ?? null,
    lastFix: existing?.lastFix ?? null,
  };
  if (!existing) networkMetrics.nodesRegistered += 1;
  await persistNode(next);
  await rememberConsent({
    id: `consent_${randomUUID()}`,
    nodeId: id,
    ownerId,
    version: NETWORK_CONSENT_VERSION,
    categories: next.consent,
    action: existing?.status === "REVOKED" ? "regranted" : existing ? "refreshed" : "granted",
    at: new Date(now).toISOString(),
  });
  log("node_registered", { nodeId: id, nodeType: row.nodeType, reactivated: Boolean(existing) });
  return { node: publicNode(next), negotiation };
}

export async function listOwnNodes(ownerId: string): Promise<ObservationNodePublic[]> {
  if (!isFirebaseConfigured()) {
    return [...nodes.values()]
      .filter((node) => node.ownerId === ownerId)
      .map(publicNode);
  }
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("observationNodes")
    .where("ownerId", "==", ownerId)
    .limit(20)
    .get();
  return snap.docs.map((doc) => publicNode(doc.data() as StoredNode));
}

async function ownedNode(ownerId: string, nodeId: string): Promise<StoredNode> {
  const node = await readNode(nodeId);
  if (!node || node.ownerId !== ownerId) {
    throw new NetworkError("Observation node not found.", 404, "not_found");
  }
  return node;
}

export async function pauseObservationNode(
  ownerId: string,
  nodeId: string,
  now = Date.now(),
): Promise<ObservationNodePublic> {
  const node = await ownedNode(ownerId, nodeId);
  if (node.status === "REVOKED") {
    throw new NetworkError("Revoked consent cannot be paused.", 409, "consent_revoked");
  }
  const next = { ...node, status: "PAUSED" as const, lastSeenAt: new Date(now).toISOString() };
  await persistNode(next);
  log("node_paused", { nodeId });
  return publicNode(next);
}

export async function revokeObservationNode(
  ownerId: string,
  nodeId: string,
  now = Date.now(),
): Promise<ObservationNodePublic> {
  const node = await ownedNode(ownerId, nodeId);
  const next: StoredNode = {
    ...node,
    status: "REVOKED",
    consent: { location: false, motion: false },
    capabilities: [],
    lastSeenAt: new Date(now).toISOString(),
  };
  await persistNode(next);
  await rememberConsent({
    id: `consent_${randomUUID()}`,
    nodeId,
    ownerId,
    version: node.consentVersion,
    categories: next.consent,
    action: "revoked",
    at: new Date(now).toISOString(),
  });
  log("node_revoked", { nodeId });
  return publicNode(next);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error("Observation processing timed out.");
      (error as Error & { code: string }).code = "timeout";
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function recomputeInsight(zoneId: string, windowStart: number, now: number): Promise<void> {
  const current = await readWindow(windowId(zoneId, windowStart));
  if (!current) return;
  const previous = await readWindow(
    windowId(zoneId, windowStart - ACTIVITY_WINDOW_MINUTES * 60 * 1000),
  );
  const fused = fuseNodeEvidence(
    current.nodeIds.map((nodeId) => ({
      nodeId,
      motionState: current.motionStates[nodeId] ?? null,
    })),
  );
  const activity = inferAreaActivity({
    currentNodes: current.ownerIds.length,
    previousNodes: previous ? previous.ownerIds.length : null,
    minCohort: MIN_COMMUNITY_CONTRIBUTORS,
  });
  const limitations = [
    "Counts participating devices only. This is not an occupancy or crowd estimate.",
  ];
  if (current.ambiguousObservations > 0) {
    limitations.push(
      "Some observations matched more than one place and stayed at area precision.",
    );
  }
  if (fused.motionAgreement === "conflicting") {
    limitations.push("Motion estimates from participating devices do not all agree.");
  }
  if (activity.value === "insufficient") {
    limitations.push(
      "Fewer than 3 consenting accounts contributed in both the current and previous 15-minute windows.",
    );
  }
  const generatedAt = new Date(now).toISOString();
  const insight: StoredInsight = {
    id: insightId(zoneId, windowStart),
    insightType: "participating_device_activity",
    geographicScope: {
      kind: "area",
      areaId: zoneId,
      precision: current.precision,
    },
    value: activity.value,
    label: activity.label,
    evidenceStatus: activity.evidenceStatus,
    observedAt: new Date(current.windowEnd).toISOString(),
    windowStart: new Date(current.windowStart).toISOString(),
    windowEnd: new Date(current.windowEnd).toISOString(),
    generatedAt,
    expiresAt: new Date(current.windowEnd + ACTIVITY_INSIGHT_TTL_MS).toISOString(),
    observationAgeSeconds: 0,
    coverage: activity.coverage,
    sourceCategory: "consenting_devices",
    rulesetVersion: NETWORK_RULESET_VERSION,
    methodology: METHODOLOGY,
    verificationStatus: activity.evidenceStatus,
    limitations,
    independentNodeCount: current.ownerIds.length,
    repeatedReadings: Math.max(0, current.observationIds.length - current.nodeIds.length),
    motionAgreement: fused.motionAgreement,
    center: current.center,
  };
  await persistInsight(insight);
}

let processingHangs = 0;

async function processObservation(observationId: string): Promise<void> {
  if (processingHangs > 0) {
    processingHangs -= 1;
    await new Promise(() => {});
  }
  if (remainingFailures > 0) {
    remainingFailures -= 1;
    throw injectedError ?? new Error("injected processing failure");
  }
  const row = await readObservation(observationId);
  if (!row || row.status === "processed") return;
  const started = Date.now();
  const candidates = await cachedPlacesNear(
    { latitude: row.latitude, longitude: row.longitude },
    Math.max(row.accuracyMeters, 50),
  );
  const match = matchObservationToArea(
    {
      latitude: row.latitude,
      longitude: row.longitude,
      accuracyMeters: row.accuracyMeters,
    },
    candidates.map((place) => ({
      id: place.id,
      name: place.name,
      category: place.category,
      latitude: place.latitude,
      longitude: place.longitude,
    })),
  );
  const processed: StoredObservation = {
    ...row,
    latitude: match.reduced.latitude,
    longitude: match.reduced.longitude,
    zoneId: match.zoneId,
    precision: match.precision,
    matchState: match.state,
    placeId: null,
    candidatePlaceIds: match.candidatePlaceIds,
    status: "processed",
    processedAt: new Date(started).toISOString(),
  };
  await persistObservation(processed);
  networkMetrics.matched += 1;
  if (match.state === "ambiguous") networkMetrics.ambiguous += 1;
  const window = activityWindow(row.observedAtMs);
  const id = windowId(match.zoneId, window.start);
  const existing = (await readWindow(id)) ?? {
    id,
    zoneId: match.zoneId,
    windowStart: window.start,
    windowEnd: window.end,
    nodeIds: [],
    ownerIds: [],
    observationIds: [],
    ambiguousObservations: 0,
    motionStates: {},
    center: match.center,
    precision: match.precision,
  };
  if (!existing.observationIds.includes(row.id)) {
    existing.observationIds.push(row.id);
    if (!existing.nodeIds.includes(row.nodeId)) existing.nodeIds.push(row.nodeId);
    if (!existing.ownerIds.includes(row.ownerId)) existing.ownerIds.push(row.ownerId);
    if (match.state === "ambiguous") existing.ambiguousObservations += 1;
    if (row.motionState) existing.motionStates[row.nodeId] = row.motionState;
    existing.precision = match.precision;
    existing.center = match.center;
  }
  await persistWindow(existing);
  await recomputeInsight(match.zoneId, window.start, started);
  networkMetrics.latencyMsTotal += Date.now() - started;
  networkMetrics.latencySamples += 1;
  log("observation_processed", {
    observationId,
    nodeId: row.nodeId,
    areaId: match.zoneId,
    precision: match.precision,
    matchState: match.state,
    latencyMs: Date.now() - started,
  });
}

async function processWithRetry(observationId: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PROCESS_ATTEMPTS; attempt += 1) {
    try {
      await withTimeout(processObservation(observationId), processingTimeoutMs);
      return;
    } catch (error) {
      lastError = error;
      const kind = classifyProcessingError(error);
      if (kind === "timeout") networkMetrics.timeouts += 1;
      log("observation_processing_error", {
        observationId,
        attempt,
        errorClass: kind,
        message: error instanceof Error ? error.message : "processing failed",
      });
      if (kind === "permanent" || attempt === PROCESS_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }
  const row = await readObservation(observationId);
  if (row && row.status !== "processed") {
    row.status = "dead";
    row.attempts = PROCESS_ATTEMPTS;
    await persistObservation(row);
  }
  const letter: DeadLetter = {
    observationId,
    nodeId: row?.nodeId ?? "unknown",
    errorClass: classifyProcessingError(lastError),
    message: lastError instanceof Error ? lastError.message : "processing failed",
    at: new Date().toISOString(),
  };
  deadLetters.push(letter);
  if (deadLetters.length > 50) deadLetters.shift();
  networkMetrics.deadLetters += 1;
  if (isFirebaseConfigured()) {
    await getFirebaseAdmin()
      .firestore()
      .collection("networkDeadLetters")
      .doc(`${observationId}_${Date.now()}`)
      .set(letter as unknown as Record<string, unknown>);
  }
  log("observation_dead_letter", { observationId, errorClass: letter.errorClass });
}

function enqueue(observationId: string): void {
  const task = processWithRetry(observationId);
  pending.add(task);
  void task.finally(() => pending.delete(task));
}

export async function flushObservationQueueForTest(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}

export async function ingestNodeObservations(
  ownerId: string,
  body: unknown,
  now = Date.now(),
): Promise<{
  nodeStatus: NodeStatus;
  results: Array<{
    observationId: string;
    status: "queued" | "duplicate" | "rejected";
    code?: string;
    message?: string;
  }>;
}> {
  const payload = JSON.stringify(body ?? {});
  if (payload.length > MAX_OBSERVATION_PAYLOAD_BYTES) {
    throw new NetworkError("Observation payload is too large.", 413, "payload_too_large");
  }
  const row = (body ?? {}) as { nodeId?: string; observations?: unknown };
  if (!row.nodeId || !Array.isArray(row.observations)) {
    throw new NetworkError("nodeId and observations are required.");
  }
  if (row.observations.length === 0 || row.observations.length > MAX_OBSERVATION_BATCH) {
    throw new NetworkError(`Submit between 1 and ${MAX_OBSERVATION_BATCH} observations.`);
  }
  const node = await ownedNode(ownerId, row.nodeId);
  if (node.status !== "ACTIVE" || !node.consent.location) {
    throw new NetworkError(
      node.status === "REVOKED"
        ? "Sensing consent has been revoked."
        : "Sensing is paused for this node.",
      403,
      node.status === "REVOKED" ? "consent_revoked" : "node_paused",
    );
  }
  await enforceRateLimit(ownerId, row.observations.length);
  const results: Array<{
    observationId: string;
    status: "queued" | "duplicate" | "rejected";
    code?: string;
    message?: string;
  }> = [];
  for (const item of row.observations) {
    networkMetrics.observationsReceived += 1;
    const observation = (item ?? {}) as NodeObservationInput;
    const observationId =
      typeof observation.observationId === "string" ? observation.observationId : "invalid";
    const existing = await readObservation(observationId);
    if (existing) {
      networkMetrics.duplicates += 1;
      results.push({
        observationId,
        status: "duplicate",
        code: existing.status === "dead" ? "dead_letter" : "duplicate",
      });
      continue;
    }
    const validation = validateNodeObservation(observation, {
      now,
      capabilities: node.capabilities,
      previous: node.lastFix,
    });
    if (!validation.valid) {
      networkMetrics.observationsRejected += 1;
      results.push({
        observationId,
        status: "rejected",
        code: validation.code,
        message: validation.error,
      });
      log("observation_rejected", { nodeId: node.id, code: validation.code });
      continue;
    }
    const stored: StoredObservation = {
      id: observation.observationId,
      nodeId: node.id,
      ownerId,
      sensorType: validation.sensorType,
      observedAt: new Date(validation.observedAtMs).toISOString(),
      observedAtMs: validation.observedAtMs,
      latitude: reduceCoordinate(validation.location.latitude, 4),
      longitude: reduceCoordinate(validation.location.longitude, 4),
      accuracyMeters: validation.location.accuracyMeters,
      zoneId: null,
      precision: null,
      matchState: null,
      placeId: null,
      candidatePlaceIds: [],
      motionState: validation.motionState,
      attributes: validation.attributes,
      status: "queued",
      attempts: 0,
      createdAt: new Date(now).toISOString(),
      processedAt: null,
      expiresAt: new Date(now + OBSERVATION_RETENTION_MS).toISOString(),
    };
    await persistObservation(stored);
    node.lastFix = {
      latitude: stored.latitude,
      longitude: stored.longitude,
      observedAt: validation.observedAtMs,
    };
    node.lastSeenAt = new Date(now).toISOString();
    await persistNode(node);
    networkMetrics.observationsAccepted += 1;
    results.push({ observationId: stored.id, status: "queued" });
    enqueue(stored.id);
  }
  return { nodeStatus: node.status, results };
}

export async function getNearbyAreas(
  center: GeoPoint,
  now = Date.now(),
): Promise<{ areas: NearbyArea[]; generatedAt: string }> {
  const query = matchObservationToArea(
    { ...center, accuracyMeters: center.accuracyMeters ?? 50 },
    [],
  );
  const ids = new Set([query.zoneId, ...zoneIdsAround(center)]);
  const areas: NearbyArea[] = [];
  for (const areaId of ids) {
    const insight = await readInsight(areaId);
    const current =
      insight && isInsightCurrent(insight.expiresAt, now)
        ? toPublicInsight(insight, now)
        : null;
    if (!current && areaId !== query.zoneId) continue;
    areas.push({
      id: areaId,
      precision: current?.geographicScope.precision ?? query.precision,
      center: areaId === query.zoneId ? query.center : (insight?.center ?? query.center),
      activity: current,
    });
  }
  return { areas, generatedAt: new Date(now).toISOString() };
}

export async function getAreaActivity(
  areaId: string,
  now = Date.now(),
): Promise<PublicAreaActivity | null> {
  if (!/^grid-\d+-\d+-\d+$/.test(areaId)) {
    throw new NetworkError("Unknown geographic area.", 404, "not_found");
  }
  const insight = await readInsight(areaId);
  if (!insight || !isInsightCurrent(insight.expiresAt, now)) return null;
  return toPublicInsight(insight, now);
}

export async function getAreaCoverage(center: GeoPoint, now = Date.now()) {
  const match = matchObservationToArea(
    { ...center, accuracyMeters: center.accuracyMeters ?? 100 },
    [],
  );
  const insight = await readInsight(match.zoneId);
  const current =
    insight && isInsightCurrent(insight.expiresAt, now)
      ? toPublicInsight(insight, now)
      : null;
  return {
    areaId: match.zoneId,
    precision: current?.geographicScope.precision ?? match.precision,
    coverage: current?.coverage ?? "insufficient",
    label: current?.label ?? "Insufficient observation coverage.",
    sourceCategory: "consenting_devices" as const,
    generatedAt: new Date(now).toISOString(),
  };
}

export async function collectExternalSources(now = Date.now()): Promise<SourceRun[]> {
  const ranAt = new Date(now).toISOString();
  const runs: SourceRun[] = [];
  try {
    const placeCount = await placeSync();
    runs.push({
      source: "openstreetmap",
      status: "ok",
      detail: "Refreshed OpenStreetMap places for the configured pilot area.",
      placeCount,
      ranAt,
    });
  } catch (error) {
    runs.push({
      source: "openstreetmap",
      status: "failed",
      detail: error instanceof Error ? error.message : "OpenStreetMap refresh failed.",
      ranAt,
    });
  }
  runs.push(
    {
      source: "public_events",
      status: "unavailable",
      detail: "No permitted public event feed is configured.",
      ranAt,
    },
    {
      source: "public_transit",
      status: "unavailable",
      detail: "No permitted transit feed is configured.",
      ranAt,
    },
    {
      source: "business_api",
      status: "unavailable",
      detail: "No authorized business feed is configured.",
      ranAt,
    },
    {
      source: "iot",
      status: "unavailable",
      detail: "No authorized IoT integration is configured.",
      ranAt,
    },
  );
  sourceRuns.splice(0, sourceRuns.length, ...runs);
  log("external_collection", {
    results: runs.map((run) => ({ source: run.source, status: run.status })),
  });
  return runs;
}

export function startAutonomousCollection(): void {
  if (collectionTimer || process.env.SPATIAL_AUTONOMOUS_SYNC !== "true") return;
  const interval = Math.max(
    15 * 60 * 1000,
    Number(process.env.SPATIAL_SYNC_INTERVAL_MS ?? 6 * 60 * 60 * 1000),
  );
  collectionTimer = setInterval(() => {
    void collectExternalSources().catch((error) => {
      log("collection_failed", {
        message: error instanceof Error ? error.message : "collection failed",
      });
    });
  }, interval);
  collectionTimer.unref?.();
}

export function stopAutonomousCollection(): void {
  if (!collectionTimer) return;
  clearInterval(collectionTimer);
  collectionTimer = null;
}

function countNodes(status?: NodeStatus): number {
  return [...nodes.values()].filter((node) => !status || node.status === status).length;
}

export async function getNetworkReport(now = Date.now()) {
  const coverage = [...insightHistory.values()].map((insight) => ({
    areaId: insight.geographicScope.areaId,
    precision: insight.geographicScope.precision,
    participatingContributors: insight.independentNodeCount,
    center: insight.center,
    coverage: insight.coverage,
    value: insight.value as ActivityTrend,
    fresh: isInsightCurrent(insight.expiresAt, now),
    expiresAt: insight.expiresAt,
  }));
  return {
    generatedAt: new Date(now).toISOString(),
    schemaVersion: NETWORK_SCHEMA_VERSION,
    rulesetVersion: NETWORK_RULESET_VERSION,
    nodes: {
      registered: Math.max(networkMetrics.nodesRegistered, nodes.size),
      activeConsenting: countNodes("ACTIVE"),
      paused: countNodes("PAUSED"),
      revoked: countNodes("REVOKED"),
    },
    observations: {
      received: networkMetrics.observationsReceived,
      accepted: networkMetrics.observationsAccepted,
      rejected: networkMetrics.observationsRejected,
      duplicates: networkMetrics.duplicates,
    },
    matching: {
      matched: networkMetrics.matched,
      ambiguous: networkMetrics.ambiguous,
      matchRate:
        networkMetrics.observationsAccepted === 0
          ? 0
          : Number(
              (networkMetrics.matched / networkMetrics.observationsAccepted).toFixed(3),
            ),
    },
    insights: {
      current: coverage.filter((row) => row.fresh).length,
      expired: coverage.filter((row) => !row.fresh).length,
    },
    processing: {
      latencyMsAverage:
        networkMetrics.latencySamples === 0
          ? 0
          : Math.round(networkMetrics.latencyMsTotal / networkMetrics.latencySamples),
      deadLetters: networkMetrics.deadLetters,
      timeouts: networkMetrics.timeouts,
    },
    coverage,
    providers: {
      overpassRequests: placeIngestionMetrics.providerRequests,
      overpassFailures: placeIngestionMetrics.providerFailures,
      sources: sourceRuns,
    },
    estimatedProcessingCostUsd: networkMetrics.estimatedProcessingCostUsd,
    costNote:
      "Deterministic aggregation does not call a paid model. Place refresh uses the public Overpass API.",
    recentFailures: deadLetters.slice(-10),
  };
}

export function isNetworkOperator(
  auth: { uid: string; email?: string },
  headerSecret: string | undefined,
): boolean {
  const secret = process.env.SPATIAL_SYNC_SECRET;
  if (secret && headerSecret === secret) return true;
  const uids = (process.env.SPATIAL_ADMIN_UIDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const emails = (process.env.SPATIAL_ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (uids.includes(auth.uid)) return true;
  return Boolean(auth.email && emails.includes(auth.email.toLowerCase()));
}

export function registerObservationNetworkRoutes(app: Hono): void {
  app.post("/v1/spatial/nodes/register", async (c) => {
    const auth = await verifyAuth(c.req.header("Authorization"));
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    try {
      return c.json(await registerObservationNode(auth.uid, await c.req.json().catch(() => null)), 201);
    } catch (error) {
      return networkFailure(c, error);
    }
  });

  app.get("/v1/spatial/nodes/me", async (c) => {
    const auth = await verifyAuth(c.req.header("Authorization"));
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    return c.json({ nodes: await listOwnNodes(auth.uid) });
  });

  app.post("/v1/spatial/nodes/observations", async (c) => {
    const auth = await verifyAuth(c.req.header("Authorization"));
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    try {
      const result = await ingestNodeObservations(auth.uid, await c.req.json().catch(() => null));
      const queued = result.results.some((item) => item.status === "queued");
      return c.json(result, queued ? 202 : 200);
    } catch (error) {
      return networkFailure(c, error);
    }
  });

  app.post("/v1/spatial/nodes/pause", async (c) => {
    const auth = await verifyAuth(c.req.header("Authorization"));
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null)) as { nodeId?: string } | null;
    try {
      return c.json({ node: await pauseObservationNode(auth.uid, String(body?.nodeId ?? "")) });
    } catch (error) {
      return networkFailure(c, error);
    }
  });

  app.post("/v1/spatial/nodes/revoke", async (c) => {
    const auth = await verifyAuth(c.req.header("Authorization"));
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null)) as { nodeId?: string } | null;
    try {
      return c.json({ node: await revokeObservationNode(auth.uid, String(body?.nodeId ?? "")) });
    } catch (error) {
      return networkFailure(c, error);
    }
  });

  app.get("/v1/spatial/areas/nearby", async (c) => {
    const auth = await verifyAuth(c.req.header("Authorization"));
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    try {
      return c.json(await getNearbyAreas(readCenter(c)));
    } catch (error) {
      return networkFailure(c, error);
    }
  });

  app.get("/v1/spatial/areas/:id/activity", async (c) => {
    const auth = await verifyAuth(c.req.header("Authorization"));
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    try {
      const activity = await getAreaActivity(c.req.param("id"));
      if (!activity) {
        return c.json({
          activity: null,
          label: "Insufficient observation coverage.",
          coverage: "insufficient",
        });
      }
      return c.json({ activity });
    } catch (error) {
      return networkFailure(c, error);
    }
  });

  app.get("/v1/spatial/coverage", async (c) => {
    const auth = await verifyAuth(c.req.header("Authorization"));
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    try {
      return c.json(await getAreaCoverage(readCenter(c)));
    } catch (error) {
      return networkFailure(c, error);
    }
  });

  app.get("/v1/internal/spatial/network", async (c) => {
    const auth = await verifyAuth(c.req.header("Authorization"));
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    if (!isNetworkOperator(auth, c.req.header("x-spatial-sync-secret"))) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(await getNetworkReport());
  });

  app.post("/v1/internal/spatial/network/collect", async (c) => {
    const auth = await verifyAuth(c.req.header("Authorization"));
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    if (!isNetworkOperator(auth, c.req.header("x-spatial-sync-secret"))) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json({ runs: await collectExternalSources() });
  });
}

function readCenter(c: { req: { query: (name: string) => string | undefined } }): GeoPoint {
  const latitude = Number(c.req.query("latitude"));
  const longitude = Number(c.req.query("longitude"));
  const accuracy = c.req.query("accuracyMeters");
  const center = {
    latitude,
    longitude,
    ...(accuracy ? { accuracyMeters: Number(accuracy) } : {}),
  };
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new NetworkError("Valid latitude and longitude query parameters are required.");
  }
  return center;
}

function networkFailure(
  c: { json: (body: unknown, status?: number) => Response },
  error: unknown,
): Response {
  const status = error instanceof NetworkError ? error.status : 500;
  return c.json(
    {
      code: error instanceof NetworkError ? error.code : "network_error",
      error: error instanceof Error ? error.message : "Observation network request failed",
    },
    status,
  );
}

export function resetObservationNetworkForTest(): void {
  nodes.clear();
  observations.clear();
  windows.clear();
  insights.clear();
  insightHistory.clear();
  consentEvents.length = 0;
  deadLetters.length = 0;
  sourceRuns.length = 0;
  rateCounters.clear();
  pending.clear();
  remainingFailures = 0;
  processingHangs = 0;
  injectedError = null;
  retryDelayMs = 5;
  processingTimeoutMs = 1_000;
  networkMetrics.nodesRegistered = 0;
  networkMetrics.observationsReceived = 0;
  networkMetrics.observationsAccepted = 0;
  networkMetrics.observationsRejected = 0;
  networkMetrics.duplicates = 0;
  networkMetrics.matched = 0;
  networkMetrics.ambiguous = 0;
  networkMetrics.deadLetters = 0;
  networkMetrics.timeouts = 0;
  networkMetrics.latencyMsTotal = 0;
  networkMetrics.latencySamples = 0;
  networkMetrics.estimatedProcessingCostUsd = 0;
  stopAutonomousCollection();
}

export function failNextProcessingForTest(times: number, error = new Error("injected")): void {
  remainingFailures = times;
  injectedError = error;
}

export function hangProcessingForTest(times: number): void {
  processingHangs = times;
}

export function setNetworkTimingsForTest(input: {
  timeoutMs?: number;
  retryMs?: number;
}): void {
  if (input.timeoutMs != null) processingTimeoutMs = input.timeoutMs;
  if (input.retryMs != null) retryDelayMs = input.retryMs;
}

export function setPlaceSyncForTest(sync: () => Promise<number>): void {
  placeSync = sync;
}

export function setNetworkLoggerForTest(logger: (entry: Record<string, unknown>) => void): void {
  logNetwork = logger;
}

export async function readProcessedObservationForTest(id: string): Promise<StoredObservation | null> {
  return readObservation(id);
}
