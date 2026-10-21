export const SPATIAL_SCHEMA_VERSION = 1;
export const DEFAULT_ZONE_RESOLUTION_METERS = 200;
export const ENVIRONMENTAL_RETENTION_DAYS = 30;
export const MIN_COMMUNITY_CONTRIBUTORS = 3;
export const DEFAULT_AGGREGATION_WINDOW_MINUTES = 15;
export const DEFAULT_PLACE_RADIUS_METERS = 1_000;
export const MAX_PLACE_RADIUS_METERS = 5_000;
export const MAX_PLACE_RESULTS = 50;

export type SensorCategory = "location" | "sound" | "motion" | "bluetooth";
export type ObservationType =
  | "sound_dbfs"
  | "motion_intensity"
  | "sound_relative"
  | "motion_state";
export type MotionState = "stationary" | "walking" | "moving";
export type DataMode = "demo" | "personal" | "community";
export type InsightProvenance =
  | "measured"
  | "estimated"
  | "historical"
  | "demonstration"
  | "unavailable";
export type CollectionStatus = "active" | "stopped";

export type GeoPoint = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
};

export type SpatialLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  timestamp: string;
};

export type LocationPermissionState =
  | "unknown"
  | "granted"
  | "denied"
  | "restricted"
  | "unavailable";

export function locationPermissionMessage(
  state: LocationPermissionState,
): string | null {
  if (state === "denied") {
    return "Location is off. Read this spot to grant it, or search manually.";
  }
  if (state === "restricted") {
    return "Location is restricted in system settings. Manual search still works.";
  }
  if (state === "unavailable") {
    return "Device location is unavailable. Manual search still works.";
  }
  return null;
}

export function isLocationAccuracyUsable(
  accuracyMeters: number | null,
  maximumAccuracyMeters = 500,
): boolean {
  return (
    accuracyMeters === null ||
    (Number.isFinite(accuracyMeters) &&
      accuracyMeters >= 0 &&
      accuracyMeters <= maximumAccuracyMeters)
  );
}

export interface LocationIntelligenceService {
  permissionState(): Promise<LocationPermissionState>;
  requestPermission(): Promise<boolean>;
  getCurrentLocation(options?: {
    requestPermission?: boolean;
  }): Promise<SpatialLocation>;
  watchLocation(
    callback: (location: SpatialLocation) => void,
  ): Promise<() => void>;
  stopTracking(): void;
}

export type SpatialPlaceSource = {
  provider: "openstreetmap";
  providerPlaceId: string;
  attribution: string;
  license: string;
  sourceUpdatedAt: string | null;
};

export type SpatialPlace = {
  id: string;
  zoneId: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  address?: string;
  provider: "openstreetmap";
  providerPlaceId: string;
  externalIds: Record<string, string>;
  attributes: Record<string, string | number | boolean>;
  sources: SpatialPlaceSource[];
  lastSyncedAt: string;
};

export type NearbySpatialPlace = SpatialPlace & {
  distanceMeters: number;
};

export type NearbyPlacesResponse = {
  places: NearbySpatialPlace[];
  page: number;
  pageSize: number;
  total: number;
  radiusMeters: number;
  center: GeoPoint;
  attribution: string;
  fetchedAt: string;
  cacheStatus: "fresh" | "stale";
};

export type PlaceSearchResult = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  type: string;
  attribution: string;
};

export type SpatialZone = {
  id: string;
  center: GeoPoint;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  zoneType: "grid";
  resolutionMeters: number;
  createdAt: number;
};

export type SensorConsent = {
  location: boolean;
  sound: boolean;
  motion: boolean;
  bluetooth: boolean;
  updatedAt: number;
};

export type SensorSession = {
  id: string;
  userId: string;
  consent: SensorConsent;
  enabledSensors: SensorCategory[];
  status: CollectionStatus;
  startedAt: number;
  endedAt: number | null;
};

export type ObservationQuality = {
  accuracyMeters?: number;
  qualityScore: number;
  calibrated: boolean;
};

export type EnvironmentalObservation = {
  id: string;
  userId: string;
  sessionId: string;
  zoneId: string;
  type: ObservationType;
  value: number | MotionState;
  unit: "dbfs" | "intensity" | "relative" | "state";
  observedAt: number;
  source: "web" | "mobile" | "wearable" | "demo";
  quality: ObservationQuality;
  expiresAt: number;
};

export type EnvironmentalAggregate = {
  zoneId: string;
  type: ObservationType;
  windowStart: number;
  windowEnd: number;
  value: number | MotionState;
  observationCount: number;
  distinctContributorCount: number;
  confidence: number;
  classification: string;
  lastUpdatedAt: number;
  provenance: InsightProvenance;
};

export type HistoricalPattern = {
  zoneId: string;
  type: ObservationType;
  dayType: "weekday" | "weekend";
  dayOfWeek: number;
  hour: number;
  baseline: number | MotionState;
  sampleCount: number;
  confidence: number;
  updatedAt: number;
};

export type StartSensorSessionRequest = {
  consent: Partial<Record<SensorCategory, boolean>>;
  enabledSensors: SensorCategory[];
};

export type SubmitObservationRequest = {
  sessionId: string;
  location: GeoPoint;
  type: ObservationType;
  value: number | MotionState;
  observedAt: number;
  source: "web" | "mobile" | "wearable";
  quality?: Partial<ObservationQuality>;
};

export type SpatialSnapshot = {
  zone: SpatialZone;
  mode: DataMode;
  aggregates: EnvironmentalAggregate[];
  patterns: HistoricalPattern[];
  generatedAt: number;
};

export type SensorReading<T> = {
  value: T;
  measuredAt: number;
  qualityScore: number;
};

export interface LocationProvider {
  supported: boolean;
  readCurrent(): Promise<SensorReading<GeoPoint> | null>;
}

export interface AmbientSoundProvider {
  supported: boolean;
  readRelativeIntensity(): Promise<SensorReading<number> | null>;
}

export interface MotionSensorProvider {
  supported: boolean;
  readMotionIntensity(): Promise<SensorReading<number> | null>;
}

export interface BluetoothProximityProvider {
  supported: boolean;
  readNearbyDeviceCount(): Promise<SensorReading<number> | null>;
}

export type ObservationValidation =
  | { valid: true }
  | { valid: false; error: string };

export function isGeoPoint(value: unknown): value is GeoPoint {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.latitude === "number" &&
    Number.isFinite(row.latitude) &&
    row.latitude >= -90 &&
    row.latitude <= 90 &&
    typeof row.longitude === "number" &&
    Number.isFinite(row.longitude) &&
    row.longitude >= -180 &&
    row.longitude <= 180 &&
    (row.accuracyMeters === undefined ||
      (typeof row.accuracyMeters === "number" &&
        Number.isFinite(row.accuracyMeters) &&
        row.accuracyMeters >= 0))
  );
}

export function distanceMeters(first: GeoPoint, second: GeoPoint): number {
  if (!isGeoPoint(first) || !isGeoPoint(second)) {
    throw new Error("Two valid geographic points are required.");
  }
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const firstLatitude = radians(first.latitude);
  const secondLatitude = radians(second.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(
    earthRadiusMeters *
      2 *
      Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)),
  );
}

export function sensorCategoryFor(type: ObservationType): SensorCategory {
  return type === "sound_relative" || type === "sound_dbfs"
    ? "sound"
    : "motion";
}

export function validateObservationInput(
  input: Pick<SubmitObservationRequest, "location" | "type" | "value" | "observedAt">,
  now = Date.now(),
): ObservationValidation {
  if (!isGeoPoint(input.location)) {
    return { valid: false, error: "A valid foreground location is required." };
  }
  if (
    !Number.isFinite(input.observedAt) ||
    input.observedAt < now - 24 * 60 * 60 * 1000 ||
    input.observedAt > now + 5 * 60 * 1000
  ) {
    return { valid: false, error: "Observation timestamp is outside the accepted window." };
  }
  if (input.type === "sound_relative") {
    if (
      typeof input.value !== "number" ||
      !Number.isFinite(input.value) ||
      input.value < 0 ||
      input.value > 1
    ) {
      return { valid: false, error: "Relative sound intensity must be between 0 and 1." };
    }
    return { valid: true };
  }
  if (input.type === "sound_dbfs") {
    if (
      typeof input.value !== "number" ||
      !Number.isFinite(input.value) ||
      input.value < -100 ||
      input.value > 0
    ) {
      return { valid: false, error: "Digital loudness must be between -100 and 0 dBFS." };
    }
    return { valid: true };
  }
  if (input.type === "motion_intensity") {
    if (
      typeof input.value !== "number" ||
      !Number.isFinite(input.value) ||
      input.value < 0 ||
      input.value > 5
    ) {
      return { valid: false, error: "Motion intensity must be between 0 and 5." };
    }
    return { valid: true };
  }
  if (
    input.type === "motion_state" &&
    (input.value === "stationary" ||
      input.value === "walking" ||
      input.value === "moving")
  ) {
    return { valid: true };
  }
  return { valid: false, error: "Unsupported observation type or value." };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function assignSpatialZone(
  point: GeoPoint,
  resolutionMeters = DEFAULT_ZONE_RESOLUTION_METERS,
  createdAt = Date.now(),
): SpatialZone {
  if (!isGeoPoint(point)) throw new Error("Invalid geographic point.");
  if (!Number.isFinite(resolutionMeters) || resolutionMeters < 50 || resolutionMeters > 5_000) {
    throw new Error("Zone resolution must be between 50 and 5000 meters.");
  }

  const latStep = resolutionMeters / 111_320;
  const latIndex = Math.floor((point.latitude + 90) / latStep);
  const centerLat = clamp(-90 + (latIndex + 0.5) * latStep, -90, 90);
  const longitudeScale = Math.max(0.1, Math.cos((centerLat * Math.PI) / 180));
  const lonStep = resolutionMeters / (111_320 * longitudeScale);
  const lonIndex = Math.floor((point.longitude + 180) / lonStep);
  const centerLon = clamp(-180 + (lonIndex + 0.5) * lonStep, -180, 180);

  return {
    id: `grid-${Math.round(resolutionMeters)}-${latIndex}-${lonIndex}`,
    center: { latitude: centerLat, longitude: centerLon },
    bounds: {
      south: clamp(-90 + latIndex * latStep, -90, 90),
      north: clamp(-90 + (latIndex + 1) * latStep, -90, 90),
      west: clamp(-180 + lonIndex * lonStep, -180, 180),
      east: clamp(-180 + (lonIndex + 1) * lonStep, -180, 180),
    },
    zoneType: "grid",
    resolutionMeters: Math.round(resolutionMeters),
    createdAt,
  };
}

export function aggregationWindow(
  timestamp: number,
  minutes = DEFAULT_AGGREGATION_WINDOW_MINUTES,
): { start: number; end: number } {
  const size = Math.max(1, Math.round(minutes)) * 60 * 1000;
  const start = Math.floor(timestamp / size) * size;
  return { start, end: start + size };
}

export function confidenceScore(input: {
  quality: number;
  observationCount: number;
  contributorCount: number;
  ageMs: number;
}): number {
  const quality = clamp(input.quality, 0, 1);
  const sample = clamp(input.observationCount / 12, 0, 1);
  const diversity = clamp(input.contributorCount / MIN_COMMUNITY_CONTRIBUTORS, 0, 1);
  const recency = Math.exp(-Math.max(0, input.ageMs) / (2 * 60 * 60 * 1000));
  return Number((quality * 0.35 + sample * 0.25 + diversity * 0.25 + recency * 0.15).toFixed(3));
}

export function canPublishCommunityAggregate(contributorCount: number): boolean {
  return contributorCount >= MIN_COMMUNITY_CONTRIBUTORS;
}

export function soundClassification(value: number, baseline?: number): string {
  if (value <= 0) {
    if (baseline !== undefined && value >= baseline + 6) return "Louder than usual";
    if (baseline !== undefined && value <= baseline - 6) return "Quieter than usual";
    if (value < -55) return "Quiet";
    if (value < -35) return "Moderate";
    return "Loud";
  }
  if (baseline !== undefined && value >= baseline + 0.2) return "Unusually loud";
  if (baseline !== undefined && value <= baseline - 0.2) return "Quieter than usual";
  if (value < 0.3) return "Quiet";
  if (value < 0.65) return "Moderate";
  return "Loud";
}

export function movementClassification(value: MotionState): string {
  if (value === "stationary") return "Participating device is stationary";
  if (value === "walking") return "Participating device is walking";
  return "Participating device is moving";
}

export function motionIntensityClassification(value: number): string {
  if (value < 0.04) return "Still";
  if (value < 0.2) return "Light movement";
  return "Active movement";
}
