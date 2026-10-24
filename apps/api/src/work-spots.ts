import {
  DC_WORK_SPOT_SEEDS,
  DEFAULT_PLACE_RADIUS_METERS,
  dcWorkSpotsForNeighborhood,
  distanceMeters,
  isGeoPoint,
  isWorkFriendlyPlaceCategory,
  loudnessToStatus,
  neighborhoodById,
  seedToWorkSpot,
  type GeoPoint,
  type NearbySpatialPlace,
  type WorkSpot,
  type WorkSpotNeighborhoodId,
  type WorkSpotSeed,
  type WorkSpotsResponse,
} from "@nearby/shared";
import { nearbyPlaces, parseNearbyPlaceQuery, PlaceError } from "./places.js";

const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

function seedSpotsForNeighborhood(
  neighborhood: WorkSpotNeighborhoodId,
  center: GeoPoint,
): WorkSpot[] {
  return dcWorkSpotsForNeighborhood(neighborhood, center);
}

function mergeLivePlace(
  live: NearbySpatialPlace,
  center: GeoPoint,
  seeds: WorkSpotSeed[],
): WorkSpot | null {
  if (!isWorkFriendlyPlaceCategory(live.category)) return null;
  const seed = seeds.find(
    (row) =>
      row.name.toLowerCase() === live.name.toLowerCase() ||
      distanceMeters(
        { latitude: row.latitude, longitude: row.longitude },
        live,
      ) < 80,
  );
  if (seed) {
    return seedToWorkSpot(seed, center, {
      id: live.id,
      distanceMeters: live.distanceMeters,
      latitude: live.latitude,
      longitude: live.longitude,
      address: live.address ?? seed.address,
      status: seed.exampleStatus,
      statusSource: "example",
      hasLiveReading: false,
    });
  }
  const type = live.category.includes("library")
    ? "library"
    : live.category.includes("cowork")
      ? "coworking"
      : "cafe";
  return {
    id: live.id,
    name: live.name,
    neighborhood: "adams-morgan",
    neighborhoodLabel: "Nearby",
    type,
    latitude: live.latitude,
    longitude: live.longitude,
    address: live.address ?? "",
    distanceMeters: live.distanceMeters,
    tags: ["Outlets"],
    typicalLine: "No pattern yet for this spot",
    bestTime: "",
    status: null,
    statusSource: null,
    typicalDay: [],
    lastReadMinutesAgo: null,
    contributorCount: 0,
    hasLiveReading: false,
  };
}

function dedupeSpots(spots: WorkSpot[]): WorkSpot[] {
  const byKey = new Map<string, WorkSpot>();
  for (const spot of spots) {
    const key = spot.name.toLowerCase();
    const existing = byKey.get(key);
    if (!existing || spot.distanceMeters < existing.distanceMeters) {
      byKey.set(key, spot);
    }
  }
  return [...byKey.values()].sort(
    (first, second) =>
      first.distanceMeters - second.distanceMeters ||
      first.name.localeCompare(second.name),
  );
}

export function parseWorkSpotsQuery(input: {
  latitude?: string;
  longitude?: string;
  neighborhood?: string;
}): { center: GeoPoint; neighborhood: WorkSpotNeighborhoodId } {
  const neighborhood = (input.neighborhood?.trim() ||
    "adams-morgan") as WorkSpotNeighborhoodId;
  const hood = neighborhoodById(neighborhood);
  const latitude = Number(input.latitude ?? hood.center.latitude);
  const longitude = Number(input.longitude ?? hood.center.longitude);
  const center = { latitude, longitude };
  if (!isGeoPoint(center)) {
    throw new PlaceError("Valid latitude and longitude are required.");
  }
  return { center, neighborhood };
}

export async function getWorkSpots(
  userId: string | null,
  query: ReturnType<typeof parseWorkSpotsQuery>,
): Promise<WorkSpotsResponse> {
  const hood = neighborhoodById(query.neighborhood);
  const seeds = DC_WORK_SPOT_SEEDS;
  let loadFailed = false;
  let live: NearbySpatialPlace[] = [];

  if (userId) {
    try {
      const response = await nearbyPlaces(
        userId,
        parseNearbyPlaceQuery({
          latitude: String(query.center.latitude),
          longitude: String(query.center.longitude),
          radiusMeters: String(DEFAULT_PLACE_RADIUS_METERS),
          limit: "30",
        }),
        { skipRateLimit: userId === "public-guest" },
      );
      live = response.places.filter((place) =>
        isWorkFriendlyPlaceCategory(place.category),
      );
    } catch (error) {
      loadFailed = true;
      console.error("[work-spots] live places fetch failed", {
        neighborhood: query.neighborhood,
        center: query.center,
        message: error instanceof Error ? error.message : String(error),
        code:
          error instanceof PlaceError
            ? error.code
            : error instanceof Error
              ? error.name
              : "unknown",
      });
    }
  }

  const seeded = seedSpotsForNeighborhood(query.neighborhood, query.center);
  const merged = dedupeSpots([
    ...seeded,
    ...live
      .map((place) => mergeLivePlace(place, query.center, seeds))
      .filter((place): place is WorkSpot => Boolean(place)),
  ]).slice(0, 15);

  const source =
    live.length > 0 && seeded.length > 0
      ? "mixed"
      : live.length > 0
        ? "live"
        : "seed";

  for (const spot of merged) {
    if (!spot.id.startsWith("seed_")) {
      spot.statusSource = spot.statusSource ?? "example";
    }
  }

  return {
    spots: merged,
    center: query.center,
    neighborhood: query.neighborhood,
    neighborhoodLabel: hood.label,
    loadFailed,
    source,
    attribution: OSM_ATTRIBUTION,
  };
}

/** In-memory community reads for anonymous demo contributions. */
const communityReads = new Map<
  string,
  { status: WorkSpot["status"]; loudness: number; at: number; tags: string[] }
>();

export function recordCommunityRead(
  spotId: string,
  input: { loudness: number; status: WorkSpot["status"]; tags: string[] },
): void {
  communityReads.set(spotId, {
    loudness: input.loudness,
    status: input.status,
    tags: input.tags,
    at: Date.now(),
  });
}

export function applyCommunityReads(spots: WorkSpot[]): WorkSpot[] {
  return spots.map((spot) => {
    const read = communityReads.get(spot.id);
    if (!read || !read.status) return spot;
    const minutes = Math.max(0, Math.round((Date.now() - read.at) / 60_000));
    return {
      ...spot,
      status: read.status,
      statusSource: "community",
      hasLiveReading: true,
      lastReadMinutesAgo: minutes,
      contributorCount: 1,
      tags: [...new Set([...spot.tags, ...read.tags])],
    };
  });
}

export function loudnessFromDbfs(dbfs: number): number {
  const clamped = Math.max(-80, Math.min(-10, dbfs));
  return Math.round(((clamped + 80) / 70) * 100);
}

export function statusFromLoudness(loudness: number): WorkSpot["status"] {
  return loudnessToStatus(loudness);
}
