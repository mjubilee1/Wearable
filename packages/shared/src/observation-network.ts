import {
  MIN_COMMUNITY_CONTRIBUTORS,
  aggregationWindow,
  assignSpatialZone,
  distanceMeters,
  isGeoPoint,
  type GeoPoint,
  type MotionState,
} from "./spatial.js";

export const NETWORK_SCHEMA_VERSION = 1;
export const NETWORK_CONSENT_VERSION = "2026-10-21";
export const NETWORK_RULESET_VERSION = "activity-v1";
export const NETWORK_ADAPTER_VERSION = "foreground-1";
export const ACTIVITY_WINDOW_MINUTES = 15;
export const ACTIVITY_INSIGHT_TTL_MS = 30 * 60 * 1000;
export const OBSERVATION_RETENTION_MS = 24 * 60 * 60 * 1000;
export const MAX_OBSERVATION_BATCH = 20;
export const MAX_OBSERVATION_PAYLOAD_BYTES = 16_384;
export const MIN_LOCATION_SAMPLE_MS = 60_000;
export const SIGNIFICANT_MOVEMENT_METERS = 75;
export const LOCATION_HEARTBEAT_MS = 5 * 60 * 1000;
export const MAX_PLAUSIBLE_SPEED_MPS = 90;
export const SERVER_MIN_SAMPLE_MS = 45_000;

export const NODE_TYPES = [
  "MOBILE",
  "WEB",
  "WEARABLE",
  "PARTNER_SDK",
  "IOT",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];
export type NodeStatus = "ACTIVE" | "PAUSED" | "REVOKED";
export type GeographicPrecision =
  | "region"
  | "neighborhood"
  | "block"
  | "building"
  | "venue";
export type NetworkSensorType = "location" | "motion";
export type ActivityTrend =
  | "increasing"
  | "decreasing"
  | "stable"
  | "insufficient";
export type AreaMatchState = "area" | "ambiguous";

export type CapabilityNegotiation = {
  accepted: string[];
  rejected: Array<{ capability: string; reason: string }>;
};

export type ObservationNodePublic = {
  id: string;
  nodeType: NodeType;
  capabilities: string[];
  consentVersion: string;
  status: NodeStatus;
  registeredAt: string;
  lastSeenAt: string | null;
};

export type NodeObservationInput = {
  observationId: string;
  sensorType: string;
  observedAt: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracyMeters: number;
  };
  attributes?: Record<string, unknown>;
  metadata?: {
    schemaVersion?: string;
    adapterVersion?: string;
    consentVersion?: string;
  };
};

export type PublicAreaActivity = {
  id: string;
  insightType: "participating_device_activity";
  geographicScope: {
    kind: "area";
    areaId: string;
    precision: GeographicPrecision;
  };
  value: ActivityTrend;
  label: string;
  evidenceStatus: "estimated" | "insufficient_evidence";
  observedAt: string;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  expiresAt: string;
  observationAgeSeconds: number;
  coverage: "sufficient" | "insufficient";
  sourceCategory: "consenting_devices";
  rulesetVersion: string;
  methodology: string;
  verificationStatus: "estimated" | "insufficient_evidence";
  limitations: string[];
};

export type NearbyArea = {
  id: string;
  precision: GeographicPrecision;
  center: GeoPoint;
  activity: PublicAreaActivity | null;
};

export interface SpatialSensorAdapter {
  sensorType: string;
  isSupported(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type LocationSample = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
};

export type MotionSample = {
  accelerationVariance: number | null;
  displacementMeters: number | null;
  intervalMs: number | null;
};

export type PlatformSensingNotes = {
  locationForeground: boolean;
  motionEstimate: boolean;
  bluetoothProximity: false;
  wifiPresence: false;
  backgroundLocation: false;
  notes: string[];
};

const OBSERVATION_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_IDENTIFIER_RE = /mac|bssid|ssid|advert|hardware|imei|serial/i;
const ALLOWED_ATTRIBUTES = new Set([
  "motionState",
  "accelerationVariance",
  "displacementMeters",
  "sampleIntervalMs",
  "platform",
]);

export function platformSensingNotes(nodeType: NodeType): PlatformSensingNotes {
  const shared = [
    "Bluetooth and Wi-Fi proximity stay off. Nearby Hello does not scan nearby devices or store MAC addresses, BSSIDs, or SSIDs.",
    "Background location is not enabled. Collection runs only while the app is open and consent is active.",
  ];
  if (nodeType === "WEB") {
    return {
      locationForeground: true,
      motionEstimate: true,
      bluetoothProximity: false,
      wifiPresence: false,
      backgroundLocation: false,
      notes: [
        "Browsers can read foreground geolocation after a permission prompt. They cannot reliably sense in the background, and they cannot enumerate nearby Bluetooth or Wi-Fi devices.",
        "iOS Safari requires a user gesture before DeviceMotionEvent permission.",
        ...shared,
      ],
    };
  }
  if (nodeType === "MOBILE") {
    return {
      locationForeground: true,
      motionEstimate: true,
      bluetoothProximity: false,
      wifiPresence: false,
      backgroundLocation: false,
      notes: [
        "This build uses foreground location only. Always-on location, Bluetooth scanning, and Wi-Fi scans are not requested.",
        ...shared,
      ],
    };
  }
  return {
    locationForeground: true,
    motionEstimate: true,
    bluetoothProximity: false,
    wifiPresence: false,
    backgroundLocation: false,
    notes: [
      "Wearable, partner, and IoT nodes can register only the same foreground capabilities until a separate integration is approved.",
      ...shared,
    ],
  };
}

export function negotiateCapabilities(
  nodeType: NodeType,
  claimed: string[],
  consent: { location: boolean; motion: boolean },
): CapabilityNegotiation {
  const supported = platformSensingNotes(nodeType);
  const accepted: string[] = [];
  const rejected: CapabilityNegotiation["rejected"] = [];
  for (const capability of [...new Set(claimed.map((item) => item.trim()))]) {
    if (!capability) continue;
    if (capability === "location_foreground") {
      if (!supported.locationForeground) {
        rejected.push({ capability, reason: "This node type cannot provide foreground location." });
      } else if (!consent.location) {
        rejected.push({ capability, reason: "Location consent is off." });
      } else {
        accepted.push(capability);
      }
      continue;
    }
    if (capability === "motion_estimate") {
      if (!supported.motionEstimate) {
        rejected.push({ capability, reason: "Motion estimates are not available for this node type." });
      } else if (!consent.motion) {
        rejected.push({ capability, reason: "Motion consent is off." });
      } else {
        accepted.push(capability);
      }
      continue;
    }
    if (capability === "bluetooth_proximity") {
      rejected.push({
        capability,
        reason: "Nearby-device Bluetooth scanning is not enabled.",
      });
      continue;
    }
    if (capability === "wifi_presence") {
      rejected.push({
        capability,
        reason: "Wi-Fi network scanning is not enabled.",
      });
      continue;
    }
    if (capability === "background_location") {
      rejected.push({
        capability,
        reason: "Background location is not enabled.",
      });
      continue;
    }
    rejected.push({ capability, reason: "Unsupported capability." });
  }
  return { accepted, rejected };
}

export function isNodeType(value: unknown): value is NodeType {
  return NODE_TYPES.includes(value as NodeType);
}

export function isInstallationId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function precisionForAccuracy(accuracyMeters: number): GeographicPrecision {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters > 2_000) return "region";
  if (accuracyMeters > 500) return "neighborhood";
  if (accuracyMeters > 80) return "block";
  return "building";
}

export function coordinateDecimals(precision: GeographicPrecision): number {
  if (precision === "region") return 2;
  if (precision === "neighborhood" || precision === "block") return 3;
  return 4;
}

export function reduceCoordinate(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export type PlaceMatchCandidate = {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
};

export type AreaMatch = {
  zoneId: string;
  precision: GeographicPrecision;
  state: AreaMatchState;
  placeId: null;
  candidatePlaceIds: string[];
  reasons: string[];
  reduced: GeoPoint;
  center: GeoPoint;
};

/** GPS alone never publishes a venue. Competing places stay on the area. */
export function matchObservationToArea(
  location: { latitude: number; longitude: number; accuracyMeters: number },
  candidates: PlaceMatchCandidate[],
): AreaMatch {
  const accuracy = location.accuracyMeters;
  let precision = precisionForAccuracy(accuracy);
  const zone = assignSpatialZone({
    latitude: location.latitude,
    longitude: location.longitude,
  });
  const reach = Math.max(accuracy, 25);
  const inside = candidates
    .map((place) => ({
      place,
      distanceMeters: distanceMeters(location, place),
    }))
    .filter((row) => row.distanceMeters <= reach)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
  const reasons = [
    `Published precision is ${precision}. A GPS fix is not treated as proof of a specific venue.`,
  ];
  let state: AreaMatchState = "area";
  if (inside.length > 1) {
    state = "ambiguous";
    if (precision === "building") precision = "block";
    reasons.push(
      `${inside.length} places fall inside the accuracy radius, so the observation stays on the geographic area.`,
    );
  } else if (inside.length === 1) {
    reasons.push(
      "One place is inside the accuracy radius. It is retained as context and is not published as the venue.",
    );
  } else {
    reasons.push("No known place intersects the accuracy radius.");
  }
  const decimals = coordinateDecimals(precision);
  return {
    zoneId: zone.id,
    precision,
    state,
    placeId: null,
    candidatePlaceIds: inside.slice(0, 5).map((row) => row.place.id),
    reasons,
    reduced: {
      latitude: reduceCoordinate(location.latitude, decimals),
      longitude: reduceCoordinate(location.longitude, decimals),
    },
    center: zone.center,
  };
}

export function normalizeMotionEstimate(input: MotionSample): {
  state: MotionState;
  estimate: true;
} {
  const variance = input.accelerationVariance;
  const displacement = input.displacementMeters;
  if (
    (variance == null || variance < 0.15) &&
    (displacement == null || displacement < 8)
  ) {
    return { state: "stationary", estimate: true };
  }
  if (
    (displacement != null && displacement < 80) ||
    (variance != null && variance < 1.5)
  ) {
    return { state: "walking", estimate: true };
  }
  return { state: "moving", estimate: true };
}

export function shouldSampleLocation(input: {
  previous: { latitude: number; longitude: number; observedAt: number } | null;
  next: { latitude: number; longitude: number };
  now: number;
  minIntervalMs?: number;
  movementMeters?: number;
  heartbeatMs?: number;
}): { sample: boolean; reason: string } {
  if (!input.previous) return { sample: true, reason: "first_fix" };
  const elapsed = input.now - input.previous.observedAt;
  const minInterval = input.minIntervalMs ?? MIN_LOCATION_SAMPLE_MS;
  if (elapsed < minInterval) return { sample: false, reason: "interval" };
  const moved = distanceMeters(input.previous, input.next);
  if (moved >= (input.movementMeters ?? SIGNIFICANT_MOVEMENT_METERS)) {
    return { sample: true, reason: "movement" };
  }
  if (elapsed >= (input.heartbeatMs ?? LOCATION_HEARTBEAT_MS)) {
    return { sample: true, reason: "heartbeat" };
  }
  return { sample: false, reason: "stationary" };
}

export function canCollectSignal(input: {
  consentGranted: boolean;
  permissionGranted: boolean;
  nodeStatus: NodeStatus;
  capabilityEnabled: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.consentGranted) return { ok: false, reason: "Consent is off." };
  if (input.nodeStatus === "PAUSED") return { ok: false, reason: "Sensing is paused." };
  if (input.nodeStatus === "REVOKED") return { ok: false, reason: "Consent was revoked." };
  if (!input.capabilityEnabled) {
    return { ok: false, reason: "This node is not allowed to collect that signal." };
  }
  if (!input.permissionGranted) {
    return { ok: false, reason: "Device permission was denied." };
  }
  return { ok: true };
}

export function inferAreaActivity(input: {
  currentNodes: number;
  previousNodes: number | null;
  minCohort?: number;
}): {
  value: ActivityTrend;
  label: string;
  coverage: "sufficient" | "insufficient";
  evidenceStatus: "estimated" | "insufficient_evidence";
} {
  const minCohort = input.minCohort ?? MIN_COMMUNITY_CONTRIBUTORS;
  if (
    input.currentNodes < minCohort ||
    input.previousNodes == null ||
    input.previousNodes < minCohort
  ) {
    return {
      value: "insufficient",
      label: "Insufficient observation coverage.",
      coverage: "insufficient",
      evidenceStatus: "insufficient_evidence",
    };
  }
  const delta = input.currentNodes - input.previousNodes;
  const ratio = input.currentNodes / input.previousNodes;
  if (ratio >= 1.25 && delta >= 2) {
    return {
      value: "increasing",
      label: "Participating-device activity is increasing in this area.",
      coverage: "sufficient",
      evidenceStatus: "estimated",
    };
  }
  if (ratio <= 0.75 && delta <= -2) {
    return {
      value: "decreasing",
      label: "Participating-device activity is decreasing in this area.",
      coverage: "sufficient",
      evidenceStatus: "estimated",
    };
  }
  return {
    value: "stable",
    label: "Participating-device activity is relatively stable in this area.",
    coverage: "sufficient",
    evidenceStatus: "estimated",
  };
}

export function fuseNodeEvidence(
  readings: Array<{ nodeId: string; motionState?: MotionState | null }>,
): {
  independentNodeCount: number;
  repeatedReadings: number;
  motionAgreement: "consistent" | "conflicting" | "not_compared";
} {
  const nodes = new Set(readings.map((reading) => reading.nodeId));
  const states = new Map<string, MotionState>();
  for (const reading of readings) {
    if (reading.motionState) states.set(reading.nodeId, reading.motionState);
  }
  const distinctStates = new Set(states.values());
  return {
    independentNodeCount: nodes.size,
    repeatedReadings: Math.max(0, readings.length - nodes.size),
    motionAgreement:
      states.size < 2
        ? "not_compared"
        : distinctStates.size === 1
          ? "consistent"
          : "conflicting",
  };
}

export function classifyProcessingError(
  error: unknown,
): "transient" | "permanent" | "timeout" {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "timeout"
  ) {
    return "timeout";
  }
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status?: number }).status === "number" &&
    (error as { status: number }).status < 500
  ) {
    return "permanent";
  }
  return "transient";
}

export function isInsightCurrent(
  expiresAt: string,
  now = Date.now(),
): boolean {
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) && expires > now;
}

export type NodeObservationValidation =
  | {
      valid: true;
      observedAtMs: number;
      sensorType: NetworkSensorType;
      location: { latitude: number; longitude: number; accuracyMeters: number };
      attributes: Record<string, string | number | boolean>;
      motionState: MotionState | null;
    }
  | { valid: false; error: string; code: string };

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function validateNodeObservation(
  input: NodeObservationInput,
  options: {
    now?: number;
    capabilities: string[];
    previous?: { latitude: number; longitude: number; observedAt: number } | null;
  },
): NodeObservationValidation {
  const now = options.now ?? Date.now();
  if (!OBSERVATION_ID_RE.test(input?.observationId ?? "")) {
    return {
      valid: false,
      code: "invalid_observation_id",
      error: "Observation id must be 8–80 letters, numbers, underscores, or hyphens.",
    };
  }
  if (input.sensorType !== "location" && input.sensorType !== "motion") {
    return {
      valid: false,
      code: "unsupported_sensor",
      error: "Only foreground location and motion estimates are accepted.",
    };
  }
  const requiredCapability =
    input.sensorType === "location" ? "location_foreground" : "motion_estimate";
  if (!options.capabilities.includes(requiredCapability)) {
    return {
      valid: false,
      code: "capability_rejected",
      error: `This node is not allowed to submit ${input.sensorType} observations.`,
    };
  }
  const observedAtMs = Date.parse(input.observedAt);
  if (
    !Number.isFinite(observedAtMs) ||
    observedAtMs < now - 24 * 60 * 60 * 1000 ||
    observedAtMs > now + 5 * 60 * 1000
  ) {
    return {
      valid: false,
      code: "invalid_timestamp",
      error: "Observation timestamp is outside the accepted window.",
    };
  }
  const location = input.location;
  if (
    !location ||
    !isGeoPoint({
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyMeters: location.accuracyMeters,
    })
  ) {
    return {
      valid: false,
      code: "invalid_location",
      error: "A valid location and accuracy are required.",
    };
  }
  if (location.latitude === 0 && location.longitude === 0) {
    return {
      valid: false,
      code: "implausible_location",
      error: "The reported location is implausible.",
    };
  }
  if (location.accuracyMeters < 1 || location.accuracyMeters > 5_000) {
    return {
      valid: false,
      code: "implausible_accuracy",
      error: "Location accuracy is outside the accepted range.",
    };
  }
  if (options.previous && observedAtMs + 1_000 < options.previous.observedAt) {
    return {
      valid: false,
      code: "invalid_timestamp",
      error: "Observation timestamp is older than the previous sample from this node.",
    };
  }
  if (
    options.previous &&
    observedAtMs > options.previous.observedAt &&
    distanceMeters(options.previous, location) /
      ((observedAtMs - options.previous.observedAt) / 1000) >
      MAX_PLAUSIBLE_SPEED_MPS
  ) {
    return {
      valid: false,
      code: "implausible_movement",
      error: "The movement between observations is implausible.",
    };
  }
  if (
    options.previous &&
    observedAtMs - options.previous.observedAt < SERVER_MIN_SAMPLE_MS
  ) {
    return {
      valid: false,
      code: "sample_too_frequent",
      error: "Location samples are arriving faster than the collection interval.",
    };
  }
  if (
    input.metadata?.consentVersion &&
    input.metadata.consentVersion !== NETWORK_CONSENT_VERSION
  ) {
    return {
      valid: false,
      code: "consent_version",
      error: "Sensing consent is out of date. Participate again to continue.",
    };
  }
  const rawAttributes = input.attributes ?? {};
  if (Object.keys(rawAttributes).length > 12) {
    return {
      valid: false,
      code: "payload_too_large",
      error: "Observation attributes exceed the allowed size.",
    };
  }
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(rawAttributes)) {
    if (PRIVATE_IDENTIFIER_RE.test(key) || key === "confidence" || key === "confidenceScore") {
      if (PRIVATE_IDENTIFIER_RE.test(key)) {
        return {
          valid: false,
          code: "private_identifier",
          error: "Private device identifiers are not accepted.",
        };
      }
      continue;
    }
    if (!ALLOWED_ATTRIBUTES.has(key)) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      if (typeof value === "string" && value.length > 40) {
        return {
          valid: false,
          code: "payload_too_large",
          error: "An observation attribute is too large.",
        };
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        return { valid: false, code: "invalid_attribute", error: "An observation attribute is invalid." };
      }
      attributes[key] = value;
    }
  }
  let motionState: MotionState | null = null;
  if (input.sensorType === "motion") {
    const variance = finite(attributes.accelerationVariance);
    const displacement = finite(attributes.displacementMeters);
    const intervalMs = finite(attributes.sampleIntervalMs);
    if (variance != null || displacement != null) {
      motionState = normalizeMotionEstimate({
        accelerationVariance: variance,
        displacementMeters: displacement,
        intervalMs,
      }).state;
    } else if (
      attributes.motionState === "stationary" ||
      attributes.motionState === "walking" ||
      attributes.motionState === "moving"
    ) {
      motionState = attributes.motionState;
    } else {
      return {
        valid: false,
        code: "invalid_motion",
        error: "A motion observation needs an estimated motion state.",
      };
    }
    attributes.motionState = motionState;
  }
  return {
    valid: true,
    observedAtMs,
    sensorType: input.sensorType,
    location: {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyMeters: location.accuracyMeters,
    },
    attributes,
    motionState,
  };
}

export function activityWindow(timestamp: number): { start: number; end: number } {
  return aggregationWindow(timestamp, ACTIVITY_WINDOW_MINUTES);
}

export type ObservationTransport = {
  register(body: {
    nodeType: NodeType;
    installationId: string;
    claimedCapabilities: string[];
    consent: { version: string; location: boolean; motion: boolean };
  }): Promise<{ node: ObservationNodePublic }>;
  submit(body: {
    nodeId: string;
    observations: NodeObservationInput[];
  }): Promise<{ nodeStatus: NodeStatus; results: Array<{ status: string; code?: string }> }>;
};

export type ForegroundLocationAdapter = SpatialSensorAdapter & {
  readSample(): Promise<LocationSample | null>;
};

export type ForegroundMotionAdapter = SpatialSensorAdapter & {
  readEstimate(): Promise<MotionSample | null>;
};

export type SensingController = {
  start(): Promise<{ running: boolean; reason: string | null; nodeId: string | null }>;
  stop(): Promise<void>;
  tick(now?: number): Promise<void>;
  flush(): Promise<void>;
  status(): { running: boolean; nodeId: string | null; queued: number };
};

export function createObservationId(now = Date.now()): string {
  const entropy =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2, 12);
  return `obs_${now.toString(36)}_${entropy}`.slice(0, 80);
}

export function createForegroundSensingController(input: {
  nodeType: NodeType;
  installationId: string;
  consent: { location: boolean; motion: boolean };
  claimedCapabilities: string[];
  transport: ObservationTransport;
  location: ForegroundLocationAdapter;
  motion?: ForegroundMotionAdapter;
  schedule?: (fn: () => void, ms: number) => () => void;
  sampleEveryMs?: number;
}): SensingController {
  let running = false;
  let node: ObservationNodePublic | null = null;
  let permissionGranted = false;
  let previous: { latitude: number; longitude: number; observedAt: number } | null =
    null;
  const queued: NodeObservationInput[] = [];
  const stops: Array<() => void> = [];

  async function flush() {
    if (!node || queued.length === 0) return;
    const batch = queued.splice(0, MAX_OBSERVATION_BATCH);
    const response = await input.transport.submit({
      nodeId: node.id,
      observations: batch,
    });
    if (response.nodeStatus !== "ACTIVE") {
      running = false;
      node = { ...node, status: response.nodeStatus };
    }
  }

  async function tick(now = Date.now()) {
    if (!running || !node) return;
    const gate = canCollectSignal({
      consentGranted: input.consent.location,
      permissionGranted,
      nodeStatus: node.status,
      capabilityEnabled: node.capabilities.includes("location_foreground"),
    });
    if (!gate.ok) return;
    const sample = await input.location.readSample();
    if (!sample) return;
    const decision = shouldSampleLocation({ previous, next: sample, now });
    if (!decision.sample) return;
    const attributes: Record<string, string | number | boolean> = {
      platform: input.nodeType,
    };
    if (
      input.consent.motion &&
      node.capabilities.includes("motion_estimate") &&
      input.motion
    ) {
      const motionGate = canCollectSignal({
        consentGranted: true,
        permissionGranted: true,
        nodeStatus: node.status,
        capabilityEnabled: true,
      });
      if (motionGate.ok) {
        const estimate = await input.motion.readEstimate();
        if (estimate) {
          const normalized = normalizeMotionEstimate(estimate);
          if (estimate.accelerationVariance != null) {
            attributes.accelerationVariance = estimate.accelerationVariance;
          }
          if (estimate.displacementMeters != null) {
            attributes.displacementMeters = estimate.displacementMeters;
          }
          attributes.motionState = normalized.state;
        }
      }
    }
    if (previous) {
      attributes.displacementMeters = distanceMeters(previous, sample);
      attributes.sampleIntervalMs = now - previous.observedAt;
    }
    queued.push({
      observationId: createObservationId(now),
      sensorType: attributes.motionState ? "motion" : "location",
      observedAt: new Date(now).toISOString(),
      location: sample,
      attributes,
      metadata: {
        schemaVersion: String(NETWORK_SCHEMA_VERSION),
        adapterVersion: NETWORK_ADAPTER_VERSION,
        consentVersion: NETWORK_CONSENT_VERSION,
      },
    });
    previous = { ...sample, observedAt: now };
    if (queued.length >= 5) await flush();
  }

  return {
    status: () => ({ running, nodeId: node?.id ?? null, queued: queued.length }),
    flush,
    tick,
    async start() {
      const collection = canCollectSignal({
        consentGranted: input.consent.location,
        permissionGranted: true,
        nodeStatus: "ACTIVE",
        capabilityEnabled: true,
      });
      if (!collection.ok) {
        return { running: false, reason: collection.reason, nodeId: null };
      }
      if (!(await input.location.isSupported())) {
        return { running: false, reason: "Location sensing is unavailable on this device.", nodeId: null };
      }
      permissionGranted = await input.location.requestPermission();
      if (!permissionGranted) {
        return { running: false, reason: "Device permission was denied.", nodeId: null };
      }
      const registered = await input.transport.register({
        nodeType: input.nodeType,
        installationId: input.installationId,
        claimedCapabilities: input.claimedCapabilities,
        consent: {
          version: NETWORK_CONSENT_VERSION,
          location: input.consent.location,
          motion: input.consent.motion,
        },
      });
      node = registered.node;
      if (node.status !== "ACTIVE" || !node.capabilities.includes("location_foreground")) {
        return {
          running: false,
          reason: "The server did not enable foreground location for this node.",
          nodeId: node.id,
        };
      }
      await input.location.start();
      if (input.motion && input.consent.motion) {
        if (await input.motion.isSupported()) {
          const allowed = await input.motion.requestPermission();
          if (allowed) await input.motion.start();
        }
      }
      running = true;
      const schedule = input.schedule ?? ((fn, ms) => {
        const id = setInterval(fn, ms);
        return () => clearInterval(id);
      });
      stops.push(schedule(() => void tick(), input.sampleEveryMs ?? MIN_LOCATION_SAMPLE_MS));
      stops.push(schedule(() => void flush(), input.sampleEveryMs ?? MIN_LOCATION_SAMPLE_MS));
      return { running: true, reason: null, nodeId: node.id };
    },
    async stop() {
      running = false;
      for (const stop of stops.splice(0)) stop();
      await flush();
      await input.location.stop();
      if (input.motion) await input.motion.stop();
    },
  };
}

export function unsupportedProximityAdapter(
  kind: "bluetooth" | "wifi",
): SpatialSensorAdapter {
  const reason =
    kind === "bluetooth"
      ? "Nearby Hello does not scan nearby Bluetooth devices."
      : "Nearby Hello does not scan nearby Wi-Fi networks.";
  return {
    sensorType: kind === "bluetooth" ? "bluetooth_proximity" : "wifi_presence",
    async isSupported() {
      return false;
    },
    async requestPermission() {
      return false;
    },
    async start() {
      throw new Error(reason);
    },
    async stop() {},
  };
}
