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
    <>
    <section className="border-t border-ink/10 pt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Places</h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refreshPlaces()}
          className="text-sm text-muted hover:text-ink disabled:opacity-50"
        >
          {busy ? "…" : "Refresh"}
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">{centerLabel}</p>

      {permissionText ? (
        <p className="mt-2 text-sm text-muted">{permissionText}</p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void manualSearch();
          }}
          placeholder="Search"
          aria-label="Search places"
          className="min-w-0 flex-1 border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink"
        />
        <button
          type="button"
          disabled={searching || search.trim().length < 2}
          onClick={() => void manualSearch()}
          className="border border-ink/15 px-3 py-2 text-sm text-ink disabled:opacity-50"
        >
          Go
        </button>
      </div>
      {searchResults.length ? (
        <div className="mt-2 border border-ink/10">
          {searchResults.map((result) => (
            <button
              key={result.id}
              type="button"
              onClick={() => chooseSearchResult(result)}
              className="block w-full border-b border-ink/10 px-3 py-2 text-left text-sm text-ink last:border-0 hover:bg-surface"
            >
              {result.label}
            </button>
          ))}
        </div>
      ) : null}
      {searchAttempted && !searching && !searchResults.length ? (
        <p className="mt-2 text-sm text-muted">Nothing found.</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1" aria-label="Place categories">
        {CATEGORIES.map(([value, label]) => (
          <button
            key={value || "all"}
            type="button"
            aria-pressed={category === value}
            onClick={() => selectCategory(value)}
            className={
              category === value
                ? "text-sm font-medium text-ink"
                : "text-sm text-muted hover:text-ink"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="mt-3 text-sm text-muted">{error}</p> : null}
      {!busy && response && !response.places.length ? (
        <p className="mt-3 text-sm text-muted">No places here yet.</p>
      ) : null}
      <ul className="mt-4 divide-y divide-ink/10 border-t border-ink/10">
        {(response?.places ?? []).slice(0, 8).map((place) => (
          <li key={place.id} className="flex items-baseline justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{place.name}</p>
              <p className="mt-0.5 text-xs capitalize text-muted">
                {place.category.replaceAll("_", " ")}
              </p>
            </div>
            <p className="shrink-0 text-xs text-muted">
              {distanceLabel(place.distanceMeters)}
            </p>
          </li>
        ))}
      </ul>
      {response?.cacheStatus === "stale" ? (
        <p className="mt-3 text-xs text-muted">Using saved places (map service is down).</p>
      ) : null}
    </section>
    </>
  );
}
