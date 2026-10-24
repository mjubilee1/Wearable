import dcWorkSpotsJson from "./data/dc-work-spots.json";
import { distanceMeters, type GeoPoint } from "./spatial.js";

export const DC_WORK_SPOT_SEEDS = dcWorkSpotsJson as WorkSpotSeed[];

export type WorkSpotStatus = "quiet" | "normal" | "busy";

export type WorkSpotNeighborhoodId =
  | "adams-morgan"
  | "dupont"
  | "u-street"
  | "downtown";

export type WorkSpotNeighborhood = {
  id: WorkSpotNeighborhoodId;
  label: string;
  center: GeoPoint;
};

export const DC_WORK_NEIGHBORHOODS: WorkSpotNeighborhood[] = [
  {
    id: "adams-morgan",
    label: "Adams Morgan",
    center: { latitude: 38.9216, longitude: -77.0425 },
  },
  {
    id: "dupont",
    label: "Dupont",
    center: { latitude: 38.909, longitude: -77.043 },
  },
  {
    id: "u-street",
    label: "U St",
    center: { latitude: 38.917, longitude: -77.027 },
  },
  {
    id: "downtown",
    label: "Downtown",
    center: { latitude: 38.901, longitude: -77.033 },
  },
];

export type WorkSpotTypicalHour = {
  hour: number;
  level: WorkSpotStatus;
};

export type WorkSpotSeed = {
  id: string;
  name: string;
  neighborhood: WorkSpotNeighborhoodId;
  neighborhoodLabel: string;
  type: "cafe" | "library" | "coworking";
  latitude: number;
  longitude: number;
  address: string;
  tags: string[];
  typicalLine: string;
  bestTime: string;
  exampleStatus: WorkSpotStatus;
  typicalDay: WorkSpotTypicalHour[];
  googlePlaceId?: string;
};

export type WorkSpot = {
  id: string;
  name: string;
  neighborhood: WorkSpotNeighborhoodId;
  neighborhoodLabel: string;
  type: WorkSpotSeed["type"];
  latitude: number;
  longitude: number;
  address: string;
  distanceMeters: number;
  tags: string[];
  typicalLine: string;
  bestTime: string;
  status: WorkSpotStatus | null;
  statusSource: "live" | "example" | "community" | null;
  typicalDay: WorkSpotTypicalHour[];
  lastReadMinutesAgo: number | null;
  contributorCount: number;
  googlePlaceId?: string;
  hasLiveReading: boolean;
};

export type WorkSpotsResponse = {
  spots: WorkSpot[];
  center: GeoPoint;
  neighborhood: WorkSpotNeighborhoodId;
  neighborhoodLabel: string;
  loadFailed: boolean;
  source: "live" | "seed" | "mixed";
  attribution: string;
};

const WORK_CATEGORY_KEYWORDS = [
  "cafe",
  "coffee",
  "library",
  "cowork",
  "coworking",
  "internet_cafe",
  "bookshop",
  "books",
];

const WORK_CATEGORY_BLOCKLIST = [
  "fast_food",
  "fuel",
  "place_of_worship",
  "dentist",
  "bank",
  "pharmacy",
  "storage",
  "car_parts",
  "variety_store",
  "mobile_phone",
  "jewelry",
  "department_store",
  "fuel",
  "social_facility",
  "fuel",
];

export function isWorkFriendlyPlaceCategory(category: string): boolean {
  const value = category.toLowerCase();
  if (WORK_CATEGORY_BLOCKLIST.some((blocked) => value.includes(blocked))) {
    return false;
  }
  return WORK_CATEGORY_KEYWORDS.some((keyword) => value.includes(keyword));
}

export function loudnessToStatus(value: number): WorkSpotStatus {
  if (value < 35) return "quiet";
  if (value < 65) return "normal";
  return "busy";
}

export function statusLabel(status: WorkSpotStatus): string {
  if (status === "quiet") return "Quiet";
  if (status === "busy") return "Busy";
  return "Normal";
}

export function walkMinutes(distanceMeters: number): number {
  return Math.max(1, Math.round(distanceMeters / 80));
}

export function googleMapsWalkingDirections(
  spot: Pick<WorkSpot, "latitude" | "longitude" | "googlePlaceId" | "id">,
): string {
  const params = new URLSearchParams({
    api: "1",
    destination: `${spot.latitude},${spot.longitude}`,
    travelmode: "walking",
  });
  if (spot.googlePlaceId) {
    params.set("destination_place_id", spot.googlePlaceId);
  }
  return `https://www.google.com/maps/dir/?${params}`;
}

export function neighborhoodById(
  id: WorkSpotNeighborhoodId,
): WorkSpotNeighborhood {
  const match = DC_WORK_NEIGHBORHOODS.find((row) => row.id === id);
  return match ?? DC_WORK_NEIGHBORHOODS[0];
}

export function dcWorkSpotsForNeighborhood(
  neighborhood: WorkSpotNeighborhoodId,
  center: GeoPoint,
): WorkSpot[] {
  return DC_WORK_SPOT_SEEDS
    .filter((seed) => seed.neighborhood === neighborhood)
    .map((seed) => seedToWorkSpot(seed, center));
}

export function seedToWorkSpot(
  seed: WorkSpotSeed,
  center: GeoPoint,
  overrides: Partial<WorkSpot> = {},
): WorkSpot {
  const distance = distanceMeters(center, seed);
  return {
    id: seed.id,
    name: seed.name,
    neighborhood: seed.neighborhood,
    neighborhoodLabel: seed.neighborhoodLabel,
    type: seed.type,
    latitude: seed.latitude,
    longitude: seed.longitude,
    address: seed.address,
    distanceMeters: distance,
    tags: seed.tags,
    typicalLine: seed.typicalLine,
    bestTime: seed.bestTime,
    status: seed.exampleStatus,
    statusSource: "example",
    typicalDay: seed.typicalDay,
    lastReadMinutesAgo: null,
    contributorCount: 0,
    googlePlaceId: seed.googlePlaceId,
    hasLiveReading: false,
    ...overrides,
  };
}
