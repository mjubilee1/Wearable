import { createHash } from "node:crypto";
import {
  DEFAULT_PLACE_RADIUS_METERS,
  MAX_PLACE_RADIUS_METERS,
  MAX_PLACE_RESULTS,
  assignSpatialZone,
  distanceMeters,
  isGeoPoint,
  type GeoPoint,
  type NearbyPlacesResponse,
  type NearbySpatialPlace,
  type PlaceSearchResult,
  type SpatialPlace,
} from "@nearby/shared";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
const OSM_LICENSE = "Open Database License (ODbL)";
const DEFAULT_OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const STALE_CACHE_MS = 7 * 24 * 60 * 60 * 1_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  timestamp?: string;
  tags?: Record<string, string>;
};

type PlaceCache = {
  center: GeoPoint;
  radiusMeters: number;
  category: string | null;
  places: SpatialPlace[];
  fetchedAt: number;
  expiresAt: number;
};

const memoryPlaces = new Map<string, SpatialPlace>();
const memoryCache = new Map<string, PlaceCache>();
const searchCache = new Map<string, { expiresAt: number; results: PlaceSearchResult[] }>();
const rateCounters = new Map<string, { count: number; resetAt: number }>();
export const placeIngestionMetrics = {
  providerRequests: 0,
  providerFailures: 0,
  cacheHits: 0,
  normalizedPlaces: 0,
  upsertedPlaces: 0,
};

export class PlaceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "place_error",
  ) {
    super(message);
  }
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseNearbyPlaceQuery(input: {
  latitude?: string;
  longitude?: string;
  lat?: string;
  lng?: string;
  radiusMeters?: string;
  radius?: string;
  category?: string;
  page?: string;
  limit?: string;
}): {
  center: GeoPoint;
  radiusMeters: number;
  category: string | null;
  page: number;
  pageSize: number;
} {
  const latitude = finiteNumber(input.latitude ?? input.lat);
  const longitude = finiteNumber(input.longitude ?? input.lng);
  const center = { latitude, longitude };
  if (!isGeoPoint(center)) {
    throw new PlaceError("Valid latitude and longitude are required.");
  }
  const radiusMeters = Math.round(
    finiteNumber(input.radiusMeters ?? input.radius) ??
      DEFAULT_PLACE_RADIUS_METERS,
  );
  if (radiusMeters < 50 || radiusMeters > MAX_PLACE_RADIUS_METERS) {
    throw new PlaceError(
      `Radius must be between 50 and ${MAX_PLACE_RADIUS_METERS} meters.`,
    );
  }
  const page = Math.max(1, Math.floor(finiteNumber(input.page) ?? 1));
  const pageSize = Math.floor(finiteNumber(input.limit) ?? 20);
  if (pageSize < 1 || pageSize > MAX_PLACE_RESULTS) {
    throw new PlaceError(
      `Limit must be between 1 and ${MAX_PLACE_RESULTS}.`,
    );
  }
  const category = input.category?.trim().toLowerCase() || null;
  if (category && !/^[a-z0-9_-]{2,40}$/.test(category)) {
    throw new PlaceError("Category contains unsupported characters.");
  }
  return {
    center: center as GeoPoint,
    radiusMeters,
    category,
    page,
    pageSize,
  };
}

async function enforceRateLimit(userId: string): Promise<void> {
  const now = Date.now();
  const bucket = Math.floor(now / RATE_WINDOW_MS);
  if (isFirebaseConfigured()) {
    const db = getFirebaseAdmin().firestore();
    const id = createHash("sha256")
      .update(`${userId}:places:${bucket}`)
      .digest("hex");
    const ref = db.collection("rateLimits").doc(id);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const count = Number(snapshot.data()?.count ?? 0);
      if (count >= RATE_LIMIT) {
        throw new PlaceError(
          "Too many place requests. Try again in a minute.",
          429,
          "rate_limited",
        );
      }
      transaction.set(ref, {
        uid: userId,
        action: "places-read",
        count: count + 1,
        expiresAt: (bucket + 1) * RATE_WINDOW_MS,
      });
    });
    return;
  }
  const current = rateCounters.get(userId);
  if (!current || current.resetAt <= now) {
    rateCounters.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  if (current.count >= RATE_LIMIT) {
    throw new PlaceError(
      "Too many place requests. Try again in a minute.",
      429,
      "rate_limited",
    );
  }
  current.count += 1;
}

function categoryFor(tags: Record<string, string>): string {
  for (const key of [
    "amenity",
    "shop",
    "tourism",
    "leisure",
    "public_transport",
    "office",
  ]) {
    if (tags[key]) return tags[key].toLowerCase();
  }
  return "place";
}

function addressFor(tags: Record<string, string>): string | undefined {
  const line = [tags["addr:housenumber"], tags["addr:street"]]
    .filter(Boolean)
    .join(" ");
  const locality = [tags["addr:city"], tags["addr:state"], tags["addr:postcode"]]
    .filter(Boolean)
    .join(", ");
  return [line, locality].filter(Boolean).join(", ") || undefined;
}

function safeAttributes(
  tags: Record<string, string>,
): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {};
  for (const key of [
    "opening_hours",
    "cuisine",
    "website",
    "phone",
    "wheelchair",
    "outdoor_seating",
    "internet_access",
    "socket:type1",
    "socket:type2",
    "socket:schuko",
  ]) {
    if (tags[key]) attributes[key] = tags[key];
  }
  return attributes;
}

export function normalizeOverpassElement(
  element: OverpassElement,
  syncedAt = new Date().toISOString(),
): SpatialPlace | null {
  const latitude = finiteNumber(element.lat ?? element.center?.lat);
  const longitude = finiteNumber(element.lon ?? element.center?.lon);
  const tags = element.tags ?? {};
  const name = tags.name?.trim();
  if (
    !name ||
    !isGeoPoint({ latitude, longitude }) ||
    !["node", "way", "relation"].includes(element.type)
  ) {
    return null;
  }
  const providerPlaceId = `${element.type}/${element.id}`;
  return {
    id: `osm_${element.type}_${element.id}`,
    zoneId: assignSpatialZone({
      latitude: latitude as number,
      longitude: longitude as number,
    }).id,
    name,
    category: categoryFor(tags),
    latitude: latitude as number,
    longitude: longitude as number,
    ...(addressFor(tags) ? { address: addressFor(tags) } : {}),
    provider: "openstreetmap",
    providerPlaceId,
    externalIds: { openstreetmap: providerPlaceId },
    attributes: safeAttributes(tags),
    sources: [
      {
        provider: "openstreetmap",
        providerPlaceId,
        attribution: OSM_ATTRIBUTION,
        license: OSM_LICENSE,
        sourceUpdatedAt: element.timestamp ?? null,
      },
    ],
    lastSyncedAt: syncedAt,
  };
}

function duplicateKey(place: SpatialPlace): string {
  return [
    place.name.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    place.category,
    place.latitude.toFixed(4),
    place.longitude.toFixed(4),
  ].join(":");
}

export function deduplicatePlaces(places: SpatialPlace[]): SpatialPlace[] {
  const byProviderId = new Map<string, SpatialPlace>();
  const duplicateKeys = new Map<string, string>();
  for (const place of places) {
    const providerKey = `${place.provider}:${place.providerPlaceId}`;
    if (byProviderId.has(providerKey)) continue;
    const key = duplicateKey(place);
    const duplicateId = duplicateKeys.get(key);
    if (duplicateId) {
      const existing = byProviderId.get(duplicateId);
      if (existing) {
        existing.externalIds = {
          ...existing.externalIds,
          [`openstreetmap_${place.providerPlaceId.replace("/", "_")}`]:
            place.providerPlaceId,
        };
        existing.sources = [...existing.sources, ...place.sources];
      }
      continue;
    }
    byProviderId.set(providerKey, { ...place });
    duplicateKeys.set(key, providerKey);
  }
  return [...byProviderId.values()];
}

function overpassQuery(center: GeoPoint, radiusMeters: number): string {
  const around = `${Math.round(radiusMeters)},${center.latitude},${center.longitude}`;
  return `[out:json][timeout:20];
    nwr(around:${around})["name"][~"^(amenity|shop|tourism|leisure|public_transport|office)$"~"."];
    out center meta qt;`;
}

async function providerFetch(
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(
          Number(process.env.PLACES_PROVIDER_TIMEOUT_MS ?? 8_000),
        ),
      });
      if (response.ok) return response;
      if (response.status !== 429 && response.status < 500) {
        throw new PlaceError(
          `Place provider rejected the request (${response.status}).`,
          502,
          "provider_error",
        );
      }
      lastError = new Error(`Provider returned ${response.status}`);
    } catch (error) {
      if (error instanceof PlaceError) throw error;
      lastError = error;
    }
    if (attempt < attempts - 1) {
      const base = Number(process.env.PLACES_RETRY_BASE_MS ?? 250);
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, base) * 2 ** attempt),
      );
    }
  }
  throw new PlaceError(
    lastError instanceof Error
      ? `Place provider unavailable: ${lastError.message}`
      : "Place provider unavailable.",
    503,
    "provider_unavailable",
  );
}

export async function fetchOverpassPlaces(
  center: GeoPoint,
  radiusMeters: number,
): Promise<SpatialPlace[]> {
  const endpoints = (
    process.env.OVERPASS_API_URLS ??
    process.env.OVERPASS_API_URL ??
    DEFAULT_OVERPASS_URLS.join(",")
  )
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  let response: Response | null = null;
  let lastError: unknown;
  for (let index = 0; index < endpoints.length; index += 1) {
    placeIngestionMetrics.providerRequests += 1;
    try {
      response = await providerFetch(
        endpoints[index],
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "User-Agent":
              process.env.OSM_USER_AGENT ??
              "NearbyHello/0.1 (nearbyhello.com)",
          },
          body: new URLSearchParams({
            data: overpassQuery(
              center,
              Math.min(MAX_PLACE_RADIUS_METERS, radiusMeters),
            ),
          }),
        },
        1,
      );
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (index < endpoints.length - 1) {
        const base = Number(process.env.PLACES_RETRY_BASE_MS ?? 250);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, base) * 2 ** index),
        );
      }
    }
  }
  if (lastError || !response) {
    placeIngestionMetrics.providerFailures += 1;
    throw lastError instanceof Error
      ? lastError
      : new PlaceError(
          "Place provider unavailable.",
          503,
          "provider_unavailable",
        );
  }
  const payload = (await response.json()) as { elements?: OverpassElement[] };
  const syncedAt = new Date().toISOString();
  const places = deduplicatePlaces(
    (payload.elements ?? [])
      .map((element) => normalizeOverpassElement(element, syncedAt))
      .filter((place): place is SpatialPlace => Boolean(place)),
  );
  placeIngestionMetrics.normalizedPlaces += places.length;
  return places;
}

function cacheKey(
  center: GeoPoint,
  radiusMeters: number,
): string {
  const raw = [
    center.latitude.toFixed(3),
    center.longitude.toFixed(3),
    radiusMeters,
  ].join(":");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function normalizeStoredPlace(value: unknown): SpatialPlace | null {
  const row = (value ?? {}) as Partial<SpatialPlace>;
  if (
    typeof row.id !== "string" ||
    typeof row.zoneId !== "string" ||
    typeof row.name !== "string" ||
    typeof row.category !== "string" ||
    !isGeoPoint({ latitude: row.latitude, longitude: row.longitude }) ||
    row.provider !== "openstreetmap" ||
    typeof row.providerPlaceId !== "string"
  ) {
    return null;
  }
  return row as SpatialPlace;
}

async function readCache(key: string): Promise<PlaceCache | null> {
  if (!isFirebaseConfigured()) return memoryCache.get(key) ?? null;
  const snapshot = await getFirebaseAdmin()
    .firestore()
    .collection("spatialPlaceLookups")
    .doc(key)
    .get();
  if (!snapshot.exists) return null;
  const row = snapshot.data() ?? {};
  const center = row.center as GeoPoint;
  const places = Array.isArray(row.places)
    ? row.places
        .map(normalizeStoredPlace)
        .filter((place): place is SpatialPlace => Boolean(place))
    : [];
  if (!isGeoPoint(center)) return null;
  return {
    center,
    radiusMeters: Number(row.radiusMeters ?? 0),
    category: typeof row.category === "string" ? row.category : null,
    places,
    fetchedAt: Number(row.fetchedAt ?? 0),
    expiresAt: Number(row.expiresAt ?? 0),
  };
}

async function persistPlaces(key: string, cache: PlaceCache): Promise<void> {
  placeIngestionMetrics.upsertedPlaces += cache.places.length;
  if (!isFirebaseConfigured()) {
    memoryCache.set(key, cache);
    for (const place of cache.places) memoryPlaces.set(place.id, place);
    return;
  }
  const db = getFirebaseAdmin().firestore();
  await Promise.all([
    db
      .collection("spatialPlaceLookups")
      .doc(key)
      .set(cache as unknown as Record<string, unknown>),
    ...cache.places.map((place) =>
      db
        .collection("spatialPlaces")
        .doc(place.id)
        .set(place as unknown as Record<string, unknown>, { merge: true }),
    ),
  ]);
}

function pagePlaces(
  places: SpatialPlace[],
  center: GeoPoint,
  radiusMeters: number,
  category: string | null,
  page: number,
  pageSize: number,
): { places: NearbySpatialPlace[]; total: number } {
  const sorted = places
    .filter((place) => !category || place.category === category)
    .map((place) => ({
      ...place,
      distanceMeters: distanceMeters(center, place),
    }))
    .filter((place) => place.distanceMeters <= radiusMeters)
    .sort(
      (first, second) =>
        first.distanceMeters - second.distanceMeters ||
        first.name.localeCompare(second.name),
    );
  const start = (page - 1) * pageSize;
  return { places: sorted.slice(start, start + pageSize), total: sorted.length };
}

export async function nearbyPlaces(
  userId: string,
  query: ReturnType<typeof parseNearbyPlaceQuery>,
  options: { skipRateLimit?: boolean } = {},
): Promise<NearbyPlacesResponse> {
  if (!options.skipRateLimit) await enforceRateLimit(userId);
  const key = cacheKey(query.center, query.radiusMeters);
  const now = Date.now();
  let cached = await readCache(key);
  let cacheStatus: "fresh" | "stale" = "fresh";
  if (!cached || cached.expiresAt <= now) {
    try {
      const places = await fetchOverpassPlaces(
        query.center,
        Math.min(MAX_PLACE_RADIUS_METERS, query.radiusMeters + 250),
      );
      cached = {
        center: query.center,
        radiusMeters: query.radiusMeters,
        category: query.category,
        places,
        fetchedAt: now,
        expiresAt:
          now + Number(process.env.PLACES_CACHE_TTL_MS ?? CACHE_TTL_MS),
      };
      await persistPlaces(key, cached);
    } catch (error) {
      if (!cached || now - cached.fetchedAt > STALE_CACHE_MS) throw error;
      cacheStatus = "stale";
    }
  } else {
    placeIngestionMetrics.cacheHits += 1;
  }
  const result = pagePlaces(
    cached.places,
    query.center,
    query.radiusMeters,
    query.category,
    query.page,
    query.pageSize,
  );
  return {
    ...result,
    page: query.page,
    pageSize: query.pageSize,
    radiusMeters: query.radiusMeters,
    center: query.center,
    attribution: OSM_ATTRIBUTION,
    fetchedAt: new Date(cached.fetchedAt).toISOString(),
    cacheStatus,
  };
}

export async function searchLocations(
  userId: string,
  rawQuery: string,
): Promise<PlaceSearchResult[]> {
  await enforceRateLimit(userId);
  const query = rawQuery.trim();
  if (query.length < 2 || query.length > 120) {
    throw new PlaceError("Search must be between 2 and 120 characters.");
  }
  const key = query.toLowerCase();
  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.results;
  const endpoint = process.env.NOMINATIM_API_URL ?? DEFAULT_NOMINATIM_URL;
  const url = new URL("/search", endpoint);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "0");
  const response = await providerFetch(url.toString(), {
    headers: {
      "User-Agent":
        process.env.OSM_USER_AGENT ?? "NearbyHello/0.1 (nearbyhello.com)",
      Accept: "application/json",
    },
  });
  const payload = (await response.json()) as Array<Record<string, unknown>>;
  const results = payload
    .map((row): PlaceSearchResult | null => {
      const latitude = finiteNumber(row.lat);
      const longitude = finiteNumber(row.lon);
      if (!isGeoPoint({ latitude, longitude })) return null;
      return {
        id: `nominatim_${String(row.place_id ?? `${latitude}_${longitude}`)}`,
        label: String(row.display_name ?? query),
        latitude: latitude as number,
        longitude: longitude as number,
        type: String(row.type ?? row.category ?? "place"),
        attribution: OSM_ATTRIBUTION,
      };
    })
    .filter((row): row is PlaceSearchResult => Boolean(row));
  searchCache.set(key, {
    results,
    expiresAt: Date.now() + 24 * 60 * 60 * 1_000,
  });
  return results;
}

export async function syncConfiguredPilotPlaces(): Promise<number> {
  const center = {
    latitude: Number(process.env.SPATIAL_PILOT_LATITUDE ?? 38.9072),
    longitude: Number(process.env.SPATIAL_PILOT_LONGITUDE ?? -77.0369),
  };
  const radiusMeters = Number(
    process.env.SPATIAL_PILOT_RADIUS_METERS ?? DEFAULT_PLACE_RADIUS_METERS,
  );
  const query = parseNearbyPlaceQuery({
    latitude: String(center.latitude),
    longitude: String(center.longitude),
    radiusMeters: String(radiusMeters),
    limit: String(MAX_PLACE_RESULTS),
  });
  const response = await nearbyPlaces("scheduled-sync", query, {
    skipRateLimit: true,
  });
  return response.total;
}

export function resetPlacesForTest(): void {
  memoryPlaces.clear();
  memoryCache.clear();
  searchCache.clear();
  rateCounters.clear();
  placeIngestionMetrics.providerRequests = 0;
  placeIngestionMetrics.providerFailures = 0;
  placeIngestionMetrics.cacheHits = 0;
  placeIngestionMetrics.normalizedPlaces = 0;
  placeIngestionMetrics.upsertedPlaces = 0;
}
