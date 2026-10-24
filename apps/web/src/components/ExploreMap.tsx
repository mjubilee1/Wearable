"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_PLACE_RADIUS_METERS,
  PREVIEW_PLACE_LIMIT,
  intentForPlaceCategory,
  intentTitle,
  placesFromStoredPreview,
  type NearbySpatialPlace,
  type PlaceSearchResult,
  type StoredPlacePreview,
} from "@nearby/shared";
import { TabBar } from "@/components/TabBar";
import { useAuth } from "@/lib/auth-context";
import {
  getNearbyPlaces,
  searchSpatialLocations,
} from "@/lib/spatial-api";
import { useSpatialLocation } from "@/lib/use-spatial-location";

function project(
  place: NearbySpatialPlace,
  center: { latitude: number; longitude: number },
  radiusMeters: number,
): { x: number; y: number } {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng =
    111_320 * Math.cos((center.latitude * Math.PI) / 180);
  const dx =
    ((place.longitude - center.longitude) * metersPerDegreeLng) / radiusMeters;
  const dy =
    ((place.latitude - center.latitude) * metersPerDegreeLat) / radiusMeters;
  return {
    x: 50 + dx * 42,
    y: 50 - dy * 42,
  };
}

const PREVIEW_KEY = "nearby.explore.preview";

function readPreview(location: { latitude: number; longitude: number }) {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(PREVIEW_KEY);
    if (!raw) return [];
    return (
      placesFromStoredPreview(JSON.parse(raw) as StoredPlacePreview, location) ??
      []
    );
  } catch {
    return [];
  }
}

function writePreview(
  location: { latitude: number; longitude: number },
  places: NearbySpatialPlace[],
) {
  if (typeof window === "undefined" || places.length === 0) return;
  const stored: StoredPlacePreview = {
    latitude: location.latitude,
    longitude: location.longitude,
    places: places.slice(0, PREVIEW_PLACE_LIMIT),
    savedAt: Date.now(),
  };
  sessionStorage.setItem(PREVIEW_KEY, JSON.stringify(stored));
}

function distanceLabel(meters: number): string {
  if (meters < 1_000) return `${meters} m`;
  return `${(meters / 1_000).toFixed(1)} km`;
}

export function ExploreMap() {
  const { user } = useAuth();
  const spatial = useSpatialLocation();
  const [places, setPlaces] = useState<NearbySpatialPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const placesRef = useRef<NearbySpatialPlace[]>([]);
  const requestId = useRef(0);
  placesRef.current = places;

  const load = useCallback(async () => {
    if (!user || !spatial.ready) return;
    const id = ++requestId.current;
    setBusy(true);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      const response = await getNearbyPlaces(token, spatial.location, {
        radiusMeters: DEFAULT_PLACE_RADIUS_METERS,
        limit: PREVIEW_PLACE_LIMIT,
      });
      if (id !== requestId.current) return;
      const next = response.places.slice(0, PREVIEW_PLACE_LIMIT);
      if (next.length > 0) {
        setPlaces(next);
        writePreview(spatial.location, next);
        if (response.cacheStatus === "stale") {
          setMessage("Showing saved places while the map service is down.");
        }
      } else if (placesRef.current.length === 0) {
        setMessage(
          "No named places are mapped this close. Search a neighborhood above.",
        );
      } else {
        setMessage("Showing the last places we found.");
      }
    } catch (caught) {
      if (id !== requestId.current) return;
      if (placesRef.current.length === 0) {
        setMessage(
          caught instanceof Error
            ? caught.message
            : "Could not load nearby places.",
        );
      } else {
        setMessage("Showing the last places we found.");
      }
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }, [spatial.location, spatial.ready, user]);

  useEffect(() => {
    if (!spatial.ready) return;
    setPlaces(readPreview(spatial.location));
  }, [spatial.ready, spatial.location]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runSearch() {
    if (!user || search.trim().length < 2) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      setResults(await searchSpatialLocations(token, search));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  const mapRadius = useMemo(() => {
    const farthest = places.reduce(
      (max, place) => Math.max(max, place.distanceMeters),
      0,
    );
    return Math.max(DEFAULT_PLACE_RADIUS_METERS, Math.round(farthest * 1.15));
  }, [places]);

  const pins = useMemo(
    () =>
      places.map((place) => ({
        place,
        point: project(place, spatial.location, mapRadius),
      })),
    [mapRadius, places, spatial.location],
  );

  const selected = places.find((place) => place.id === selectedId) ?? null;

  return (
    <div className="app-shell mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pb-24 pt-20">
      <header className="mb-6 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Explore your surroundings
        </h1>
        <p className="text-base text-muted">
          Nearby places and observations on a local map. Pins are relative—not
          a live traffic or occupancy layer.
        </p>
        <p className="text-sm text-muted">
          {spatial.label}
          {busy && places.length === 0
            ? " · Finding places…"
            : places.length > 0
              ? ` · ${places.length} ${places.length === 1 ? "place" : "places"}`
              : " · No places this close"}
        </p>
      </header>

      <div className="mb-4 flex gap-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void runSearch();
          }}
          placeholder="Search a neighborhood or place"
          className="min-w-0 flex-1 border border-ink/15 px-3 py-2 text-sm outline-none focus:border-ink"
        />
        <button
          type="button"
          disabled={busy || search.trim().length < 2}
          onClick={() => void runSearch()}
          className="border border-ink/15 px-3 py-2 text-sm disabled:opacity-50"
        >
          Search
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void spatial.requestDeviceLocation().then(() => load())}
          className="border border-ink/15 px-3 py-2 text-sm disabled:opacity-50"
        >
          Use my location
        </button>
      </div>

      {results.length ? (
        <div className="mb-4 border border-ink/10">
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              className="block w-full border-b border-ink/10 px-3 py-2 text-left text-sm last:border-0 hover:bg-surface"
              onClick={() => {
                spatial.setManual(
                  { latitude: result.latitude, longitude: result.longitude },
                  result.label,
                );
                setResults([]);
                setSearch("");
              }}
            >
              {result.label}
            </button>
          ))}
        </div>
      ) : null}

      {places.length > 0 ? (
        <ul className="mb-4 divide-y divide-ink/10 border border-ink/10">
          {places.map((place) => {
            const active = place.id === selectedId;
            return (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(place.id)}
                  className={
                    active
                      ? "flex w-full items-baseline justify-between gap-3 bg-surface px-3 py-3 text-left"
                      : "flex w-full items-baseline justify-between gap-3 px-3 py-3 text-left hover:bg-surface"
                  }
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">
                      {place.name}
                    </span>
                    <span className="mt-0.5 block text-sm capitalize text-muted">
                      {place.category.replaceAll("_", " ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm text-muted">
                    {distanceLabel(place.distanceMeters)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : busy ? (
        <p className="mb-4 text-sm text-muted">Finding a few places near you…</p>
      ) : null}

      <section
        className="relative aspect-square w-full overflow-hidden border border-ink/10 bg-[#eef2f0]"
        aria-label="Interactive discovery map"
      >
        <div className="absolute inset-0 opacity-40">
          <div className="absolute inset-x-0 top-1/2 h-px bg-ink/20" />
          <div className="absolute inset-y-0 left-1/2 w-px bg-ink/20" />
        </div>
        <div className="absolute left-1/2 top-1/2 z-10 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-[10px] font-semibold text-white">
          You
        </div>
        {pins.map(({ place, point }) => {
          const active = place.id === selectedId;
          const clampedX = Math.min(94, Math.max(6, point.x));
          const clampedY = Math.min(94, Math.max(6, point.y));
          return (
            <button
              key={place.id}
              type="button"
              title={place.name}
              onClick={() => setSelectedId(place.id)}
              className={
                active
                  ? "absolute z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-white"
                  : "absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal"
              }
              style={{ left: `${clampedX}%`, top: `${clampedY}%` }}
            />
          );
        })}
        <p className="absolute bottom-3 left-3 right-3 text-xs text-muted">
          Relative positions within ~1 mile. OpenStreetMap place identity only.
        </p>
      </section>

      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}

      {selected ? (
        <div className="mt-4 border border-ink/10 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-muted">
            {intentTitle(intentForPlaceCategory(selected.category))}
          </p>
          <p className="mt-1 text-lg font-semibold text-ink">{selected.name}</p>
          <p className="mt-1 text-sm capitalize text-muted">
            {selected.category.replaceAll("_", " ")}
          </p>
          <Link
            href={`/places/${encodeURIComponent(selected.id)}`}
            className="mt-3 inline-block text-sm font-medium text-ink underline underline-offset-2"
          >
            Open place intelligence
          </Link>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">
          Tap a pin to preview a place, then open its intelligence profile.
        </p>
      )}

      <TabBar active="explore" />
    </div>
  );
}
