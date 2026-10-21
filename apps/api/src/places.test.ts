import assert from "node:assert/strict";
import test from "node:test";
import {
  distanceMeters,
  isLocationAccuracyUsable,
  locationPermissionMessage,
} from "@nearby/shared";
import {
  PlaceError,
  deduplicatePlaces,
  nearbyPlaces,
  normalizeOverpassElement,
  parseNearbyPlaceQuery,
  resetPlacesForTest,
} from "./places.js";

const center = { latitude: 38.9072, longitude: -77.0369 };
const originalFetch = globalThis.fetch;
const originalRetry = process.env.PLACES_RETRY_BASE_MS;
const originalTtl = process.env.PLACES_CACHE_TTL_MS;

function overpassResponse(elements: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ elements }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function element(
  id: number,
  name: string,
  latitude: number,
  longitude: number,
  amenity = "cafe",
) {
  return {
    type: "node" as const,
    id,
    lat: latitude,
    lon: longitude,
    timestamp: "2026-10-20T12:00:00Z",
    tags: {
      name,
      amenity,
      "addr:housenumber": "100",
      "addr:street": "Test Street",
    },
  };
}

test.beforeEach(() => {
  resetPlacesForTest();
  process.env.PLACES_RETRY_BASE_MS = "0";
  delete process.env.PLACES_CACHE_TTL_MS;
});

test.after(() => {
  globalThis.fetch = originalFetch;
  if (originalRetry === undefined) delete process.env.PLACES_RETRY_BASE_MS;
  else process.env.PLACES_RETRY_BASE_MS = originalRetry;
  if (originalTtl === undefined) delete process.env.PLACES_CACHE_TTL_MS;
  else process.env.PLACES_CACHE_TTL_MS = originalTtl;
});

test("nearby place query validates coordinates, radius, category, and limits", () => {
  assert.throws(
    () => parseNearbyPlaceQuery({ latitude: "91", longitude: "-77" }),
    (error: unknown) =>
      error instanceof PlaceError && error.status === 400,
  );
  assert.throws(
    () =>
      parseNearbyPlaceQuery({
        latitude: "38.9",
        longitude: "-77",
        radius: "9000",
      }),
    /Radius must be between/,
  );
  assert.throws(
    () =>
      parseNearbyPlaceQuery({
        latitude: "38.9",
        longitude: "-77",
        category: "cafe!",
      }),
    /unsupported characters/,
  );
  const parsed = parseNearbyPlaceQuery({
    lat: "38.9",
    lng: "-77",
    radius: "750",
    page: "2",
    limit: "10",
  });
  assert.equal(parsed.radiusMeters, 750);
  assert.equal(parsed.page, 2);
  assert.equal(parsed.pageSize, 10);
});

test("distance calculation is stable and rejects invalid coordinates", () => {
  const distance = distanceMeters(center, {
    latitude: 38.9169,
    longitude: -77.0369,
  });
  assert.ok(distance >= 1_070 && distance <= 1_090);
  assert.throws(
    () => distanceMeters(center, { latitude: 100, longitude: 0 }),
    /valid geographic points/,
  );
});

test("provider normalization keeps attribution and supported static fields", () => {
  const place = normalizeOverpassElement({
    ...element(1, "Example Café", 38.9073, -77.0368),
    tags: {
      name: "Example Café",
      amenity: "cafe",
      cuisine: "coffee_shop",
      opening_hours: "Mo-Fr 08:00-17:00",
      occupancy: "busy",
    },
  });
  assert.ok(place);
  assert.equal(place.category, "cafe");
  assert.equal(place.providerPlaceId, "node/1");
  assert.equal(place.attributes.cuisine, "coffee_shop");
  assert.equal(place.attributes.opening_hours, "Mo-Fr 08:00-17:00");
  assert.equal(place.attributes.occupancy, undefined);
  assert.match(place.sources[0].attribution, /OpenStreetMap/);
});

test("normalization rejects unnamed or unlocated provider rows", () => {
  assert.equal(
    normalizeOverpassElement({
      type: "node",
      id: 1,
      lat: 38.9,
      lon: -77,
      tags: { amenity: "cafe" },
    }),
    null,
  );
  assert.equal(
    normalizeOverpassElement({
      type: "way",
      id: 2,
      tags: { name: "No center", amenity: "cafe" },
    }),
    null,
  );
});

test("duplicate ingestion is idempotent across provider and nearby duplicates", () => {
  const first = normalizeOverpassElement(
    element(1, "Same Café", 38.9073, -77.0368),
  );
  const sameProvider = normalizeOverpassElement(
    element(1, "Same Café", 38.9073, -77.0368),
  );
  const nearbyWay = normalizeOverpassElement({
    type: "way",
    id: 2,
    center: { lat: 38.90731, lon: -77.03681 },
    tags: { name: "Same Café", amenity: "cafe" },
  });
  assert.ok(first && sameProvider && nearbyWay);
  const deduplicated = deduplicatePlaces([first, sameProvider, nearbyWay]);
  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0].sources.length, 2);
});

test("nearby discovery filters radius and category then sorts by distance", async () => {
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return overpassResponse([
      element(1, "Near Café", 38.9073, -77.0369, "cafe"),
      element(2, "Far Café", 38.912, -77.0369, "cafe"),
      element(3, "Restaurant", 38.9074, -77.0369, "restaurant"),
      element(4, "Outside", 38.93, -77.0369, "cafe"),
    ]);
  };
  const all = await nearbyPlaces(
    "user",
    parseNearbyPlaceQuery({
      latitude: String(center.latitude),
      longitude: String(center.longitude),
      radius: "1000",
    }),
  );
  assert.deepEqual(
    all.places.map((place) => place.name),
    ["Near Café", "Restaurant", "Far Café"],
  );
  assert.ok(
    all.places[0].distanceMeters <= all.places[1].distanceMeters,
  );

  const cafes = await nearbyPlaces(
    "user",
    parseNearbyPlaceQuery({
      latitude: String(center.latitude),
      longitude: String(center.longitude),
      radius: "1000",
      category: "cafe",
    }),
  );
  assert.deepEqual(
    cafes.places.map((place) => place.name),
    ["Near Café", "Far Café"],
  );
  assert.equal(fetches, 1, "category filtering should reuse the provider cache");
});

test("fresh cache prevents repeated provider requests", async () => {
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return overpassResponse([
      element(1, "Cached Café", 38.9073, -77.0369),
    ]);
  };
  const query = parseNearbyPlaceQuery({
    latitude: String(center.latitude),
    longitude: String(center.longitude),
  });
  await nearbyPlaces("user", query);
  await nearbyPlaces("user", query);
  assert.equal(fetches, 1);
});

test("stale cache is returned when the provider becomes unavailable", async () => {
  process.env.PLACES_CACHE_TTL_MS = "-1";
  let available = true;
  globalThis.fetch = async () => {
    if (available) {
      return overpassResponse([
        element(1, "Fallback Café", 38.9073, -77.0369),
      ]);
    }
    return overpassResponse([], 429);
  };
  const query = parseNearbyPlaceQuery({
    latitude: String(center.latitude),
    longitude: String(center.longitude),
  });
  await nearbyPlaces("user", query);
  available = false;
  const stale = await nearbyPlaces("user", query);
  assert.equal(stale.cacheStatus, "stale");
  assert.equal(stale.places[0].name, "Fallback Café");
});

test("provider failures surface when no cache is available", async () => {
  globalThis.fetch = async () => overpassResponse([], 503);
  await assert.rejects(
    () =>
      nearbyPlaces(
        "user",
        parseNearbyPlaceQuery({
          latitude: String(center.latitude),
          longitude: String(center.longitude),
        }),
      ),
    (error: unknown) =>
      error instanceof PlaceError &&
      error.status === 503 &&
      error.code === "provider_unavailable",
  );
});

test("place request rate limiting protects provider quotas", async () => {
  globalThis.fetch = async () => overpassResponse([]);
  const query = parseNearbyPlaceQuery({
    latitude: String(center.latitude),
    longitude: String(center.longitude),
  });
  for (let request = 0; request < 30; request += 1) {
    await nearbyPlaces("rate-user", query);
  }
  await assert.rejects(
    () => nearbyPlaces("rate-user", query),
    (error: unknown) =>
      error instanceof PlaceError &&
      error.status === 429 &&
      error.code === "rate_limited",
  );
});

test("permission states explain denied and unavailable fallbacks", () => {
  assert.match(locationPermissionMessage("denied") ?? "", /search manually/);
  assert.match(locationPermissionMessage("unavailable") ?? "", /unavailable/);
  assert.equal(locationPermissionMessage("granted"), null);
  assert.equal(isLocationAccuracyUsable(null), true);
  assert.equal(isLocationAccuracyUsable(25), true);
  assert.equal(isLocationAccuracyUsable(750), false);
});
