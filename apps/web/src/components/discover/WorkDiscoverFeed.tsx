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
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-white px-5 pb-24 pt-20">
      <header className="space-y-4">
        <p className="text-sm text-muted">Nearby Hello</p>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Where can I work right now?
        </h1>
        <p className="text-base leading-relaxed text-muted">
          Know what a place is like before you walk in.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-ink/15 px-3 py-1.5 text-sm font-medium text-ink">
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
                  ? "rounded-full bg-ink px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-full border border-ink/15 px-3 py-1.5 text-sm text-ink"
              }
            >
              {hood.label}
            </button>
          ))}
          <button
            type="button"
            disabled={locating || loading}
            onClick={() => void handleUseMyLocation()}
            className="rounded-full border border-ink/15 px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-50"
          >
            {locating ? "Getting location…" : "Use my location"}
          </button>
        </div>
      </header>

      <main className="mt-8 flex-1 space-y-4">
        {loading ? (
          <p className="text-sm text-muted">Loading work-friendly spots…</p>
        ) : null}

        {loadFailed ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">Couldn&apos;t load spots right now.</p>
            <button
              type="button"
              disabled={loading}
              onClick={() => void load()}
              className="border border-ink/15 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
            >
              Retry
            </button>
          </div>
        ) : null}

        <div className="space-y-3">
          {spots.map((spot) => (
            <WorkSpotCard
              key={spot.id}
              spot={spot}
              onOpen={() => setSelected(spot)}
            />
          ))}
        </div>

        {!loading && !spots.length ? (
          <p className="text-sm text-muted">
            No work-friendly spots here yet. Try another neighborhood.
          </p>
        ) : null}
      </main>

      {selected ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-ink/20"
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
