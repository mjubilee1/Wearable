"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GeoPoint,
  LocationPermissionState,
  NearbyPlacesResponse,
  PlaceSearchResult,
} from "@nearby/shared";
import { locationPermissionMessage } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { browserLocationService } from "@/lib/device-location";
import {
  getNearbyPlaces,
  searchSpatialLocations,
} from "@/lib/spatial-api";

const CATEGORIES = [
  ["", "All"],
  ["cafe", "Cafés"],
  ["restaurant", "Food"],
  ["bar", "Social"],
  ["park", "Parks"],
  ["library", "Libraries"],
] as const;

function distanceLabel(meters: number): string {
  if (meters < 1_000) return `${meters} m away`;
  return `${(meters / 1_000).toFixed(1)} km away`;
}

export function NearbyPlacesSection({
  initialLocation,
}: {
  initialLocation: GeoPoint;
}) {
  const { user } = useAuth();
  const [center, setCenter] = useState(initialLocation);
  const [permission, setPermission] =
    useState<LocationPermissionState>("unknown");
  const [category, setCategory] = useState("");
  const categoryRef = useRef("");
  const [response, setResponse] = useState<NearbyPlacesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [centerLabel, setCenterLabel] = useState("Washington, DC example area");

  const loadPlaces = useCallback(
    async (location: GeoPoint, nextCategory = categoryRef.current) => {
      if (!user) return;
      setBusy(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        setResponse(
          await getNearbyPlaces(token, location, {
            category: nextCategory || null,
            radiusMeters: 1_000,
            limit: 20,
          }),
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load nearby places.",
        );
      } finally {
        setBusy(false);
      }
    },
    [user],
  );

  useEffect(() => {
    setCenter(initialLocation);
    void loadPlaces(initialLocation);
  }, [initialLocation, loadPlaces]);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const state = await browserLocationService.permissionState();
      if (cancelled) return;
      setPermission(state);
      if (state !== "granted") return;
      try {
        const current = await browserLocationService.getCurrentLocation({
          requestPermission: false,
        });
        if (cancelled) return;
        const next = {
          latitude: current.latitude,
          longitude: current.longitude,
          ...(current.accuracyMeters !== null
            ? { accuracyMeters: current.accuracyMeters }
            : {}),
        };
        setCenter(next);
        setCenterLabel("Your approximate location");
        await loadPlaces(next);
        stop = await browserLocationService.watchLocation((changed) => {
          const watched = {
            latitude: changed.latitude,
            longitude: changed.longitude,
            ...(changed.accuracyMeters !== null
              ? { accuracyMeters: changed.accuracyMeters }
              : {}),
          };
          setCenter(watched);
          setCenterLabel("Your approximate location");
          void loadPlaces(watched);
        });
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Location is unavailable.",
        );
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [loadPlaces]);

  const selectCategory = (next: string) => {
    setCategory(next);
    categoryRef.current = next;
    void loadPlaces(center, next);
  };

  const refreshPlaces = async () => {
    if ((await browserLocationService.permissionState()) === "granted") {
      try {
        const current = await browserLocationService.getCurrentLocation({
          requestPermission: false,
        });
        const next = {
          latitude: current.latitude,
          longitude: current.longitude,
          ...(current.accuracyMeters !== null
            ? { accuracyMeters: current.accuracyMeters }
            : {}),
        };
        setCenter(next);
        setCenterLabel("Your approximate location");
        await loadPlaces(next);
        return;
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Location is unavailable.",
        );
      }
    }
    await loadPlaces(center);
  };

  const manualSearch = async () => {
    if (!user || search.trim().length < 2) return;
    setSearching(true);
    setSearchAttempted(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      setSearchResults(await searchSpatialLocations(token, search));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Location search failed.",
      );
    } finally {
      setSearching(false);
    }
  };

  const chooseSearchResult = (result: PlaceSearchResult) => {
    const next = {
      latitude: result.latitude,
      longitude: result.longitude,
    };
    setCenter(next);
    setCenterLabel(result.label);
    setSearchResults([]);
    setSearchAttempted(false);
    void loadPlaces(next);
  };

  const permissionText = locationPermissionMessage(permission);

  return (
    <section className="rounded-3xl border border-black/5 bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold text-ink">Places nearby</p>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Real place names and categories from OpenStreetMap around{" "}
            {centerLabel}. No ratings or live-condition claims.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refreshPlaces()}
          className="rounded-xl border border-black/10 px-3 py-2 text-xs font-bold text-ink disabled:opacity-50"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {permissionText ? (
        <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-xs text-muted">
          {permissionText}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void manualSearch();
          }}
          placeholder="Search a city, address, or place"
          aria-label="Manual location search"
          className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-teal"
        />
        <button
          type="button"
          disabled={searching || search.trim().length < 2}
          onClick={() => void manualSearch()}
          className="rounded-xl bg-ink px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          Search
        </button>
      </div>
      {searchResults.length ? (
        <div className="mt-2 overflow-hidden rounded-xl border border-black/10">
          {searchResults.map((result) => (
            <button
              key={result.id}
              type="button"
              onClick={() => chooseSearchResult(result)}
              className="block w-full border-b border-black/5 px-3 py-2.5 text-left text-sm text-ink last:border-0 hover:bg-surface"
            >
              {result.label}
            </button>
          ))}
        </div>
      ) : null}
      {searchAttempted && !searching && !searchResults.length ? (
        <p className="mt-2 text-xs text-muted">No locations found.</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2" aria-label="Place categories">
        {CATEGORIES.map(([value, label]) => (
          <button
            key={value || "all"}
            type="button"
            aria-pressed={category === value}
            onClick={() => selectCategory(value)}
            className={
              category === value
                ? "rounded-full bg-teal px-3 py-1.5 text-xs font-bold text-white"
                : "rounded-full bg-surface px-3 py-1.5 text-xs font-bold text-muted"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mt-4 rounded-xl bg-coral-soft px-3 py-2 text-sm text-coral">
          {error}
        </p>
      ) : null}
      {!busy && response && !response.places.length ? (
        <p className="mt-4 rounded-xl border border-dashed border-black/15 p-4 text-sm text-muted">
          No sourced places were found in this area for that category.
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(response?.places ?? []).map((place) => (
          <article
            key={place.id}
            className="rounded-2xl border border-black/10 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-ink">{place.name}</p>
                <p className="mt-1 text-xs capitalize text-muted">
                  {place.category.replaceAll("_", " ")}
                </p>
              </div>
              <p className="shrink-0 text-xs font-semibold text-teal">
                {distanceLabel(place.distanceMeters)}
              </p>
            </div>
            {place.address ? (
              <p className="mt-3 text-xs leading-relaxed text-muted">
                {place.address}
              </p>
            ) : null}
          </article>
        ))}
      </div>
      {response ? (
        <p className="mt-4 text-[11px] text-muted">
          {response.attribution} · refreshed{" "}
          {new Date(response.fetchedAt).toLocaleString()}
          {response.cacheStatus === "stale"
            ? " · cached data shown while the provider is unavailable"
            : ""}
        </p>
      ) : null}
    </section>
  );
}
