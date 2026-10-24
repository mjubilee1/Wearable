"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DC_WORK_NEIGHBORHOODS,
  dcWorkSpotsForNeighborhood,
  neighborhoodById,
  type WorkSpot,
  type WorkSpotNeighborhoodId,
} from "@nearby/shared";
import { TabBar } from "@/components/TabBar";
import { WorkSpotCard } from "@/components/discover/WorkSpotCard";
import { WorkSpotSheet } from "@/components/discover/WorkSpotSheet";
import { useAuth } from "@/lib/auth-context";
import { applyLocalReadings } from "@/lib/local-spot-readings";
import { useSpatialLocation } from "@/lib/use-spatial-location";
import { getWorkSpots } from "@/lib/work-spots-api";

function SpotSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-ink/6 bg-card p-4 shadow-sm">
      <div className="flex gap-3">
        <div className="h-11 w-11 rounded-xl bg-surface" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-24 rounded bg-surface" />
          <div className="h-5 w-3/4 rounded bg-surface" />
          <div className="h-4 w-full rounded bg-surface" />
        </div>
      </div>
    </div>
  );
}

export function WorkDiscoverFeed() {
  const { user } = useAuth();
  const spatial = useSpatialLocation();
  const [neighborhood, setNeighborhood] =
    useState<WorkSpotNeighborhoodId>("adams-morgan");
  const [spots, setSpots] = useState<WorkSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [selected, setSelected] = useState<WorkSpot | null>(null);

  const center = useMemo(() => {
    if (spatial.usingDevice) return spatial.location;
    return neighborhoodById(neighborhood).center;
  }, [neighborhood, spatial.location, spatial.usingDevice]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = user ? await user.getIdToken() : null;
      const response = await getWorkSpots({
        latitude: center.latitude,
        longitude: center.longitude,
        neighborhood,
        token,
      });
      setLoadFailed(response.loadFailed);
      setSpots(applyLocalReadings(response.spots));
    } catch (error) {
      console.error("[nearby] work spots load failed", error);
      setLoadFailed(true);
      setSpots(
        applyLocalReadings(dcWorkSpotsForNeighborhood(neighborhood, center)),
      );
    } finally {
      setLoading(false);
    }
  }, [center, neighborhood, user]);

  useEffect(() => {
    if (!spatial.ready) return;
    void load();
  }, [load, spatial.ready]);

  useEffect(() => {
    if (!selected) return;
    const fresh = spots.find((spot) => spot.id === selected.id);
    if (fresh) setSelected(fresh);
  }, [spots, selected]);

  async function handleUseMyLocation() {
    setLocating(true);
    try {
      await spatial.requestDeviceLocation();
    } catch {
      // Keep neighborhood center.
    } finally {
      setLocating(false);
    }
  }

  const chipLabel = spatial.usingDevice
    ? "Around you"
    : `${neighborhoodById(neighborhood).label} · DC`;

  return (
    <div className="discover-shell min-h-dvh pb-24">
      <div className="mx-auto flex w-full max-w-2xl flex-col px-5 pt-20">
        <header className="space-y-5">
          <p className="font-display text-2xl italic text-teal">Nearby Hello</p>
          <div className="space-y-2">
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-ink sm:text-3xl">
              Where can I work right now?
            </h1>
            <p className="text-base leading-relaxed text-ink/75">
              Know what a place is like before you walk in. Cafés, libraries, and
              coworking only—sorted for focus.
            </p>
          </div>

          <div className="rounded-2xl border border-teal/15 bg-gradient-to-br from-teal-soft/90 to-white px-4 py-4">
            <p className="text-sm font-semibold text-ink">How to use this</p>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink/80">
              <li>· Pick a neighborhood or use your location.</li>
              <li>· Open a spot for the typical day, then read it live.</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-3 text-xs font-medium text-ink/70">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-teal" /> Quiet
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-glow" /> Normal
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-coral" /> Busy
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Neighborhood
            </p>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              <span
                className={`shrink-0 rounded-full px-3 py-2 text-sm font-semibold ${
                  spatial.usingDevice
                    ? "bg-teal text-white"
                    : "border border-ink/10 bg-white text-ink"
                }`}
              >
                {chipLabel}
              </span>
              {DC_WORK_NEIGHBORHOODS.map((hood) => (
                <button
                  key={hood.id}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    spatial.setManual(hood.center, `${hood.label} · DC`);
                    setNeighborhood(hood.id);
                  }}
                  className={
                    neighborhood === hood.id && !spatial.usingDevice
                      ? "shrink-0 rounded-full bg-ink px-3 py-2 text-sm font-semibold text-white shadow-sm"
                      : "shrink-0 rounded-full border border-ink/10 bg-white px-3 py-2 text-sm font-medium text-ink"
                  }
                >
                  {hood.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={locating || loading}
              onClick={() => void handleUseMyLocation()}
              className="text-sm font-semibold text-teal underline decoration-teal/30 underline-offset-4 disabled:opacity-50"
            >
              {locating ? "Getting your location…" : "Use my location instead"}
            </button>
          </div>
        </header>

        <main className="mt-8 flex-1 space-y-4">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">Spots to work from</h2>
            {!loading ? (
              <p className="text-sm text-muted">
                {spots.length} {spots.length === 1 ? "place" : "places"}
              </p>
            ) : null}
          </div>

          {loading ? (
            <div className="space-y-3">
              <SpotSkeleton />
              <SpotSkeleton />
              <SpotSkeleton />
            </div>
          ) : null}

          {loadFailed ? (
            <div className="rounded-2xl border border-coral/25 bg-coral-soft/60 px-4 py-3">
              <p className="text-sm font-medium text-ink">
                Couldn&apos;t load spots right now.
              </p>
              <p className="mt-1 text-sm text-ink/75">
                Showing saved Washington, DC work spots below.
              </p>
              <button
                type="button"
                disabled={loading}
                onClick={() => void load()}
                className="mt-3 rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Retry
              </button>
            </div>
          ) : null}

          <div className="space-y-4">
            {spots.map((spot) => (
              <WorkSpotCard
                key={spot.id}
                spot={spot}
                onOpen={() => setSelected(spot)}
              />
            ))}
          </div>

          {!loading && !spots.length ? (
            <div className="rounded-2xl border border-ink/10 bg-white px-4 py-6 text-center">
              <p className="text-sm text-muted">
                No work-friendly spots here yet. Try another neighborhood.
              </p>
            </div>
          ) : null}
        </main>
      </div>

      {selected ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px]"
            aria-label="Close spot details"
            onClick={() => setSelected(null)}
          />
          <WorkSpotSheet
            spot={selected}
            onClose={() => setSelected(null)}
            onRefresh={() => void load()}
          />
        </>
      ) : null}

      <TabBar active="nearby" />
    </div>
  );
}
