import {
  ENVIRONMENTAL_RETENTION_DAYS,
  MIN_COMMUNITY_CONTRIBUTORS,
  aggregationWindow,
  assignSpatialZone,
  canPublishCommunityAggregate,
  confidenceScore,
  movementClassification,
  sensorCategoryFor,
  soundClassification,
  validateObservationInput,
  type DataMode,
  type EnvironmentalAggregate,
  type EnvironmentalObservation,
  type GeoPoint,
  type HistoricalPattern,
  type MotionState,
  type ObservationType,
  type SensorCategory,
  type SensorConsent,
  type SensorSession,
  type SpatialSnapshot,
  type StartSensorSessionRequest,
  type SubmitObservationRequest,
} from "@nearby/shared";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

const MAX_OBSERVATIONS_PER_SESSION = 240;
const MAX_QUERY_OBSERVATIONS = 500;
const observations = new Map<string, EnvironmentalObservation>();
const sessions = new Map<string, SensorSession>();
const consents = new Map<string, SensorConsent>();

export class SpatialError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "spatial_error",
  ) {
    super(message);
  }
}

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultConsent(): SensorConsent {
  return {
    location: false,
    sound: false,
    motion: false,
    bluetooth: false,
    updatedAt: 0,
  };
}

function normalizeConsent(value: unknown): SensorConsent {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    location: row.location === true,
    sound: row.sound === true,
    motion: row.motion === true,
    bluetooth: row.bluetooth === true,
    updatedAt: Number(row.updatedAt ?? 0),
  };
}

function normalizeSession(sessionId: string, value: unknown): SensorSession {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    id: sessionId,
    userId: String(row.userId ?? ""),
    consent: normalizeConsent(row.consent),
    enabledSensors: Array.isArray(row.enabledSensors)
      ? row.enabledSensors.filter(isSensorCategory)
      : [],
    status: row.status === "active" ? "active" : "stopped",
    startedAt: Number(row.startedAt ?? 0),
    endedAt: row.endedAt == null ? null : Number(row.endedAt),
  };
}

function isSensorCategory(value: unknown): value is SensorCategory {
  return (
    value === "location" ||
    value === "sound" ||
    value === "motion" ||
    value === "bluetooth"
  );
}

function normalizeObservation(
  observationId: string,
  value: unknown,
): EnvironmentalObservation | null {
  const row = (value ?? {}) as Record<string, unknown>;
  const type = row.type;
  if (type !== "sound_relative" && type !== "motion_state") return null;
  return {
    id: observationId,
    userId: String(row.userId ?? ""),
    sessionId: String(row.sessionId ?? ""),
    zoneId: String(row.zoneId ?? ""),
    type,
    value:
      type === "sound_relative"
        ? Number(row.value ?? 0)
        : (String(row.value ?? "stationary") as MotionState),
    unit: type === "sound_relative" ? "relative" : "state",
    observedAt: Number(row.observedAt ?? 0),
    source:
      row.source === "mobile" || row.source === "wearable" || row.source === "demo"
        ? row.source
        : "web",
    quality: {
      accuracyMeters:
        typeof (row.quality as Record<string, unknown> | undefined)?.accuracyMeters ===
        "number"
          ? Number((row.quality as Record<string, unknown>).accuracyMeters)
          : undefined,
      qualityScore: Number(
        (row.quality as Record<string, unknown> | undefined)?.qualityScore ?? 0.5,
      ),
      calibrated: Boolean(
        (row.quality as Record<string, unknown> | undefined)?.calibrated,
      ),
    },
    expiresAt: Number(row.expiresAt ?? 0),
  };
}

export async function getSensorConsent(userId: string): Promise<SensorConsent> {
  if (!isFirebaseConfigured()) return consents.get(userId) ?? defaultConsent();
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("sensorConsents")
    .doc(userId)
    .get();
  return snap.exists ? normalizeConsent(snap.data()) : defaultConsent();
}

export async function updateSensorConsent(
  userId: string,
  patch: Partial<Record<SensorCategory, boolean>>,
): Promise<SensorConsent> {
  const current = await getSensorConsent(userId);
  const next: SensorConsent = {
    ...current,
    location: patch.location ?? current.location,
    sound: patch.sound ?? current.sound,
    motion: patch.motion ?? current.motion,
    bluetooth: patch.bluetooth ?? current.bluetooth,
    updatedAt: Date.now(),
  };
  if (!isFirebaseConfigured()) consents.set(userId, next);
  else {
    await getFirebaseAdmin()
      .firestore()
      .collection("sensorConsents")
      .doc(userId)
      .set(next as unknown as Record<string, unknown>);
  }
  return next;
}

export async function startSensorSession(
  userId: string,
  request: StartSensorSessionRequest,
): Promise<SensorSession> {
  const enabledSensors = [...new Set(request.enabledSensors)].filter(isSensorCategory);
  if (!enabledSensors.includes("location")) {
    throw new SpatialError("Foreground location is required for a sensor session.");
  }
  const consent = await updateSensorConsent(userId, request.consent);
  for (const category of enabledSensors) {
    if (!consent[category]) {
      throw new SpatialError(
        `Consent is required for ${category}.`,
        403,
        "sensor_consent_required",
      );
    }
  }
  const session: SensorSession = {
    id: id("session"),
    userId,
    consent,
    enabledSensors,
    status: "active",
    startedAt: Date.now(),
    endedAt: null,
  };
  if (!isFirebaseConfigured()) sessions.set(session.id, session);
  else {
    await getFirebaseAdmin()
      .firestore()
      .collection("sensorSessions")
      .doc(session.id)
      .set({
        ...session,
        observationCount: 0,
      } as unknown as Record<string, unknown>);
  }
  return session;
}

async function readSession(sessionId: string): Promise<SensorSession | null> {
  if (!isFirebaseConfigured()) return sessions.get(sessionId) ?? null;
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("sensorSessions")
    .doc(sessionId)
    .get();
  return snap.exists ? normalizeSession(snap.id, snap.data()) : null;
}

export async function stopSensorSession(
  userId: string,
  sessionId: string,
): Promise<SensorSession> {
  const session = await readSession(sessionId);
  if (!session) throw new SpatialError("Sensor session not found.", 404, "not_found");
  if (session.userId !== userId) {
    throw new SpatialError("You do not own this sensor session.", 403, "forbidden");
  }
  const stopped: SensorSession = {
    ...session,
    status: "stopped",
    endedAt: session.endedAt ?? Date.now(),
  };
  if (!isFirebaseConfigured()) sessions.set(sessionId, stopped);
  else {
    await getFirebaseAdmin()
      .firestore()
      .collection("sensorSessions")
      .doc(sessionId)
      .update({ status: "stopped", endedAt: stopped.endedAt });
  }
  return stopped;
}

async function sessionObservationCount(sessionId: string): Promise<number> {
  if (!isFirebaseConfigured()) {
    return [...observations.values()].filter((row) => row.sessionId === sessionId)
      .length;
  }
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("environmentalObservations")
    .where("sessionId", "==", sessionId)
    .limit(MAX_OBSERVATIONS_PER_SESSION)
    .get();
  return snap.docs.length;
}

export async function submitObservation(
  userId: string,
  request: SubmitObservationRequest,
  now = Date.now(),
): Promise<EnvironmentalObservation> {
  const validation = validateObservationInput(request, now);
  if (!validation.valid) throw new SpatialError(validation.error);
  const session = await readSession(request.sessionId);
  if (!session) throw new SpatialError("Sensor session not found.", 404, "not_found");
  if (session.userId !== userId) {
    throw new SpatialError("You do not own this sensor session.", 403, "forbidden");
  }
  if (session.status !== "active") {
    throw new SpatialError("Sensor session has stopped.", 409, "session_stopped");
  }
  const category = sensorCategoryFor(request.type);
  if (!session.enabledSensors.includes(category) || !session.consent[category]) {
    throw new SpatialError(
      `Consent is required for ${category}.`,
      403,
      "sensor_consent_required",
    );
  }
  if ((await sessionObservationCount(session.id)) >= MAX_OBSERVATIONS_PER_SESSION) {
    throw new SpatialError(
      "This collection session reached its observation limit.",
      429,
      "rate_limited",
    );
  }

  const zone = assignSpatialZone(request.location, undefined, now);
  const qualityScore = Math.min(
    1,
    Math.max(0, Number(request.quality?.qualityScore ?? 0.6)),
  );
  const observation: EnvironmentalObservation = {
    id: id("observation"),
    userId,
    sessionId: session.id,
    zoneId: zone.id,
    type: request.type,
    value: request.value,
    unit: request.type === "sound_relative" ? "relative" : "state",
    observedAt: request.observedAt,
    source: request.source,
    quality: {
      accuracyMeters:
        request.location.accuracyMeters ?? request.quality?.accuracyMeters,
      qualityScore,
      calibrated: request.quality?.calibrated === true,
    },
    expiresAt: now + ENVIRONMENTAL_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  };

  if (!isFirebaseConfigured()) {
    observations.set(observation.id, observation);
  } else {
    const db = getFirebaseAdmin().firestore();
    await Promise.all([
      db.collection("spatialZones").doc(zone.id).set(
        zone as unknown as Record<string, unknown>,
        { merge: true },
      ),
      db
        .collection("environmentalObservations")
        .doc(observation.id)
        .set(observation as unknown as Record<string, unknown>),
    ]);
  }
  return observation;
}

async function queryObservations(
  userId: string,
  zoneId: string,
  mode: Exclude<DataMode, "demo">,
): Promise<EnvironmentalObservation[]> {
  const cutoff = Date.now() - ENVIRONMENTAL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  if (!isFirebaseConfigured()) {
    return [...observations.values()].filter(
      (row) =>
        row.zoneId === zoneId &&
        row.observedAt >= cutoff &&
        (mode === "community" || row.userId === userId),
    );
  }
  let query = getFirebaseAdmin()
    .firestore()
    .collection("environmentalObservations")
    .where("zoneId", "==", zoneId)
    .where("observedAt", ">=", cutoff)
    .orderBy("observedAt", "desc")
    .limit(MAX_QUERY_OBSERVATIONS);
  if (mode === "personal") query = query.where("userId", "==", userId);
  const snap = await query.get();
  return snap.docs
    .map((doc) => normalizeObservation(doc.id, doc.data()))
    .filter((row): row is EnvironmentalObservation => Boolean(row));
}

function modeValue(rows: EnvironmentalObservation[]): MotionState {
  const counts = new Map<MotionState, number>();
  for (const row of rows) {
    const value = row.value as MotionState;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "stationary";
}

export function aggregateObservationRows(
  rows: EnvironmentalObservation[],
  type: ObservationType,
  now = Date.now(),
  mode: Exclude<DataMode, "demo"> = "personal",
): EnvironmentalAggregate | null {
  const typed = rows.filter((row) => row.type === type);
  if (!typed.length) return null;
  const contributors = new Set(typed.map((row) => row.userId)).size;
  if (mode === "community" && !canPublishCommunityAggregate(contributors)) return null;
  const latest = Math.max(...typed.map((row) => row.observedAt));
  const window = aggregationWindow(latest);
  const windowRows = typed.filter(
    (row) => row.observedAt >= window.start && row.observedAt < window.end,
  );
  const value =
    type === "sound_relative"
      ? windowRows.reduce((sum, row) => sum + Number(row.value), 0) /
        windowRows.length
      : modeValue(windowRows);
  const quality =
    windowRows.reduce((sum, row) => sum + row.quality.qualityScore, 0) /
    windowRows.length;
  return {
    zoneId: typed[0].zoneId,
    type,
    windowStart: window.start,
    windowEnd: window.end,
    value,
    observationCount: windowRows.length,
    distinctContributorCount: new Set(windowRows.map((row) => row.userId)).size,
    confidence: confidenceScore({
      quality,
      observationCount: windowRows.length,
      contributorCount: new Set(windowRows.map((row) => row.userId)).size,
      ageMs: now - latest,
    }),
    classification:
      type === "sound_relative"
        ? soundClassification(Number(value))
        : movementClassification(value as MotionState),
    lastUpdatedAt: latest,
    provenance: mode === "community" ? "estimated" : "measured",
  };
}

export function historicalPatternsFromRows(
  rows: EnvironmentalObservation[],
  mode: Exclude<DataMode, "demo"> = "personal",
): HistoricalPattern[] {
  const groups = new Map<string, EnvironmentalObservation[]>();
  for (const row of rows) {
    const date = new Date(row.observedAt);
    const dayType = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? "weekend" : "weekday";
    const key = `${row.type}:${dayType}:${date.getUTCHours()}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const result: HistoricalPattern[] = [];
  for (const [key, group] of groups) {
    const contributors = new Set(group.map((row) => row.userId)).size;
    if (group.length < 3) continue;
    if (mode === "community" && contributors < MIN_COMMUNITY_CONTRIBUTORS) continue;
    const [type, dayType, hour] = key.split(":") as [
      ObservationType,
      "weekday" | "weekend",
      string,
    ];
    const baseline =
      type === "sound_relative"
        ? group.reduce((sum, row) => sum + Number(row.value), 0) / group.length
        : modeValue(group);
    result.push({
      zoneId: group[0].zoneId,
      type,
      dayType,
      hour: Number(hour),
      baseline,
      sampleCount: group.length,
      confidence: confidenceScore({
        quality:
          group.reduce((sum, row) => sum + row.quality.qualityScore, 0) /
          group.length,
        observationCount: group.length,
        contributorCount: contributors,
        ageMs: Date.now() - Math.max(...group.map((row) => row.observedAt)),
      }),
      updatedAt: Math.max(...group.map((row) => row.observedAt)),
    });
  }
  return result;
}

function demoSnapshot(location: GeoPoint, now: number): SpatialSnapshot {
  const zone = assignSpatialZone(location, undefined, now);
  const window = aggregationWindow(now);
  return {
    zone,
    mode: "demo",
    generatedAt: now,
    aggregates: [
      {
        zoneId: zone.id,
        type: "sound_relative",
        windowStart: window.start,
        windowEnd: window.end,
        value: 0.42,
        observationCount: 18,
        distinctContributorCount: 6,
        confidence: 0.78,
        classification: "Moderate",
        lastUpdatedAt: now - 4 * 60 * 1000,
        provenance: "demonstration",
      },
      {
        zoneId: zone.id,
        type: "motion_state",
        windowStart: window.start,
        windowEnd: window.end,
        value: "walking",
        observationCount: 12,
        distinctContributorCount: 5,
        confidence: 0.72,
        classification: "Participating devices show walking activity",
        lastUpdatedAt: now - 6 * 60 * 1000,
        provenance: "demonstration",
      },
    ],
    patterns: [],
  };
}

export async function getSpatialSnapshot(
  userId: string,
  location: GeoPoint,
  mode: DataMode,
  now = Date.now(),
): Promise<SpatialSnapshot> {
  if (mode === "demo") return demoSnapshot(location, now);
  const zone = assignSpatialZone(location, undefined, now);
  const rows = await queryObservations(userId, zone.id, mode);
  const aggregates = (["sound_relative", "motion_state"] as const)
    .map((type) => aggregateObservationRows(rows, type, now, mode))
    .filter((row): row is EnvironmentalAggregate => Boolean(row));
  return {
    zone,
    mode,
    aggregates,
    patterns: historicalPatternsFromRows(rows, mode),
    generatedAt: now,
  };
}

export async function deleteContributions(userId: string): Promise<number> {
  if (!isFirebaseConfigured()) {
    let deleted = 0;
    for (const [observationId, row] of observations) {
      if (row.userId === userId) {
        observations.delete(observationId);
        deleted += 1;
      }
    }
    return deleted;
  }
  let deleted = 0;
  for (;;) {
    const collection = getFirebaseAdmin()
      .firestore()
      .collection("environmentalObservations");
    const snap = await collection
      .where("userId", "==", userId)
      .limit(MAX_QUERY_OBSERVATIONS)
      .get();
    await Promise.all(
      snap.docs.map((doc) => collection.doc(doc.id).delete()),
    );
    deleted += snap.docs.length;
    if (snap.docs.length < MAX_QUERY_OBSERVATIONS) return deleted;
  }
}

export function resetSpatialForTest(): void {
  observations.clear();
  sessions.clear();
  consents.clear();
}
