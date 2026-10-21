"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DataMode,
  EnvironmentalAggregate,
  GeoPoint,
  SpatialSnapshot,
} from "@nearby/shared";
import { TabBar } from "@/components/TabBar";
import { NearbyPlacesSection } from "@/components/NearbyPlacesSection";
import { useAuth } from "@/lib/auth-context";
import {
  deleteSpatialContributions,
  getSpatialSnapshot,
  startSensorSession,
  stopSensorSession,
  submitObservation,
} from "@/lib/spatial-api";
import {
  browserLocationProvider,
  browserMotionProvider,
  browserSoundProvider,
} from "@/lib/sensor-providers";

type View = "nearby" | "explore" | "patterns";

const PILOT_LOCATION: GeoPoint = {
  latitude: Number(process.env.NEXT_PUBLIC_PILOT_LATITUDE ?? 38.9072),
  longitude: Number(process.env.NEXT_PUBLIC_PILOT_LONGITUDE ?? -77.0369),
};

function freshness(timestamp: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  return `${Math.round(minutes / 60)} hours ago`;
}

function aggregateTitle(aggregate: EnvironmentalAggregate): string {
  return aggregate.type === "sound_dbfs"
    ? "Ambient loudness"
    : "Participating-device activity";
}

function aggregateValue(aggregate: EnvironmentalAggregate): string {
  if (aggregate.type === "sound_dbfs") {
    return `${Number(aggregate.value).toFixed(1)} dBFS`;
  }
  if (aggregate.type === "motion_intensity") {
    return `${Number(aggregate.value).toFixed(2)} motion intensity`;
  }
  return String(aggregate.value);
}

function SpatialMap({
  location,
  snapshot,
}: {
  location: GeoPoint;
  snapshot: SpatialSnapshot | null;
}) {
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState(4);
  const cells = Array.from({ length: 9 }, (_, index) => index);
  return (
    <section className="overflow-hidden rounded-3xl border border-black/10 bg-[#dcebe8] shadow-sm">
      <div className="flex items-center justify-between border-b border-black/10 bg-card/90 px-4 py-3">
        <div>
          <p className="text-xs font-bold text-ink">Interactive spatial map</p>
          <p className="text-xs text-muted">
            Approx. {location.latitude.toFixed(3)}, {location.longitude.toFixed(3)}
          </p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(1, value - 1))}
            className="h-8 w-8 rounded-lg bg-card text-lg font-bold text-ink shadow-sm"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(3, value + 1))}
            className="h-8 w-8 rounded-lg bg-card text-lg font-bold text-ink shadow-sm"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>
      <div
        className="relative grid aspect-[16/9] min-h-64 grid-cols-3 gap-1.5 p-5 transition-transform"
        style={{ transform: `scale(${1 + (zoom - 1) * 0.035})` }}
      >
        {cells.map((cell) => {
          const current = cell === 4;
          const active = cell === selected;
          return (
            <button
              key={cell}
              type="button"
              onClick={() => setSelected(cell)}
              className={[
                "relative rounded-2xl border transition",
                current
                  ? "border-teal bg-teal/25"
                  : "border-white/70 bg-white/35 hover:bg-white/55",
                active ? "ring-2 ring-amber-glow ring-offset-1" : "",
              ].join(" ")}
              aria-label={current ? "Current observation zone" : "Nearby zone"}
            >
              {current ? (
                <span className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-white bg-teal text-xs font-bold text-white shadow-lg">
                  You
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-ink/60">Zone</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="border-t border-black/10 bg-card/90 px-4 py-3 text-xs text-muted">
        {snapshot
          ? `${snapshot.zone.resolutionMeters} m privacy-preserving grid · ${snapshot.zone.id}`
          : "Zone details become available after location access."}
      </div>
    </section>
  );
}

export function NearbyHelloDashboard({ view }: { view: View }) {
  const { user } = useAuth();
  const [location, setLocation] = useState<GeoPoint>(PILOT_LOCATION);
  const [usingDeviceLocation, setUsingDeviceLocation] = useState(false);
  const [mode, setMode] = useState<DataMode>("demo");
  const [snapshot, setSnapshot] = useState<SpatialSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSnapshot = useCallback(
    async (nextMode: DataMode, nextLocation: GeoPoint) => {
      if (!user) return;
      setBusy(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const next = await getSpatialSnapshot(token, nextLocation, nextMode);
        setMode(nextMode);
        setSnapshot(next);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Could not load spatial data.",
        );
      } finally {
        setBusy(false);
      }
    },
    [user],
  );

  useEffect(() => {
    void loadSnapshot("demo", PILOT_LOCATION);
  }, [loadSnapshot]);

  async function readThisSpot() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    let sessionId: string | null = null;
    try {
      const [locationResult, soundResult, motionResult] =
        await Promise.allSettled([
          browserLocationProvider.readCurrent(),
          browserSoundProvider.supported
            ? browserSoundProvider.readRelativeIntensity()
            : Promise.resolve(null),
          browserMotionProvider.supported
            ? browserMotionProvider.readMotionIntensity()
            : Promise.resolve(null),
        ]);
      const locationReading =
        locationResult.status === "fulfilled" ? locationResult.value : null;
      if (!locationReading) {
        setNotice(
          "Location was not allowed, so no reading was saved. You can still explore the labeled example.",
        );
        return;
      }
      const sound =
        soundResult.status === "fulfilled" ? soundResult.value : null;
      const motion =
        motionResult.status === "fulfilled" ? motionResult.value : null;
      if (!sound && !motion) {
        setNotice(
          "Mic and motion were not available, so no sensor numbers were saved. The example view still works.",
        );
        return;
      }
      const token = await user.getIdToken();
      const nextSession = await startSensorSession(token, {
        consent: {
          location: true,
          sound: Boolean(sound),
          motion: Boolean(motion),
        },
        enabledSensors: [
          "location",
          ...(sound ? (["sound"] as const) : []),
          ...(motion ? (["motion"] as const) : []),
        ],
      });
      sessionId = nextSession.id;
      const submissions = [];
      if (sound) {
        submissions.push(
          submitObservation(token, {
            sessionId,
            location: locationReading.value,
            type: "sound_dbfs",
            value: sound.value,
            observedAt: sound.measuredAt,
            source: "web",
            quality: { qualityScore: sound.qualityScore, calibrated: false },
          }),
        );
      }
      if (motion) {
        submissions.push(
          submitObservation(token, {
            sessionId,
            location: locationReading.value,
            type: "motion_intensity",
            value: motion.value,
            observedAt: motion.measuredAt,
            source: "web",
            quality: { qualityScore: motion.qualityScore, calibrated: false },
          }),
        );
      }
      await Promise.all(submissions);
      setLocation(locationReading.value);
      setUsingDeviceLocation(true);
      setMode("personal");
      setNotice(
        `${submissions.length} numeric reading${submissions.length === 1 ? "" : "s"} saved to this spot. Raw audio was discarded on this device.`,
      );
      await loadSnapshot("personal", locationReading.value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read this spot.");
    } finally {
      if (sessionId) {
        try {
          const token = await user.getIdToken();
          await stopSensorSession(token, sessionId);
        } catch {
          // The reading is complete even if the session close retry is needed.
        }
      }
      setBusy(false);
    }
  }

  async function deleteContributions() {
    if (!user || !window.confirm("Delete all of your environmental observations?")) {
      return;
    }
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const deleted = await deleteSpatialContributions(token);
      setNotice(`${deleted} contributed observation${deleted === 1 ? "" : "s"} deleted.`);
      await loadSnapshot("personal", location);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete observations.");
    } finally {
      setBusy(false);
    }
  }

  const visibleAggregates = snapshot?.aggregates ?? [];
  const title = view === "nearby" ? "What is happening around you" : view === "explore" ? "Explore nearby zones" : "Historical patterns";
  const description =
    view === "nearby"
      ? "Measured environmental signals, with freshness and uncertainty."
      : view === "explore"
        ? "Inspect spatial zones without exposing individual location trails."
        : "Compare conditions by hour once enough observations exist.";

  const modeLabel = useMemo(() => {
    if (mode === "demo") return "Example data";
    if (mode === "community") return "Community aggregate";
    return "Your measurements";
  }, [mode]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-20 pt-20 sm:px-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
              Nearby Hello
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted sm:text-base">{description}</p>
          </div>
          <span className={mode === "demo" ? "rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800" : "rounded-full bg-teal-soft px-3 py-1.5 text-xs font-bold text-teal"}>
            {modeLabel}
          </span>
        </div>
      </header>

      <main className="flex-1 space-y-5">
        {view === "nearby" ? (
          <p className="rounded-2xl bg-teal-soft px-4 py-3 text-sm text-teal">
            Tap once to let Nearby Hello use location, microphone loudness, and
            phone motion for about 10 seconds. Raw audio is never saved.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {view === "nearby" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void readThisSpot()}
              className="rounded-xl bg-teal px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "Reading this spot… about 10 seconds" : "Read this spot"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void loadSnapshot("demo", usingDeviceLocation ? location : PILOT_LOCATION)}
            className="rounded-xl border border-black/10 bg-card px-4 py-2.5 text-sm font-bold text-ink disabled:opacity-50"
          >
            View example data
          </button>
          <button
            type="button"
            disabled={busy || !usingDeviceLocation}
            onClick={() => void loadSnapshot("community", location)}
            className="rounded-xl border border-black/10 bg-card px-4 py-2.5 text-sm font-bold text-ink disabled:opacity-50"
          >
            Community view
          </button>
        </div>

        {error ? <p className="rounded-2xl bg-coral-soft px-4 py-3 text-sm text-coral">{error}</p> : null}
        {notice ? <p className="rounded-2xl bg-teal-soft px-4 py-3 text-sm text-teal">{notice}</p> : null}

        <SpatialMap location={location} snapshot={snapshot} />

        {view !== "patterns" ? (
          <NearbyPlacesSection initialLocation={location} />
        ) : null}

        {view !== "patterns" ? (
          <section className="grid gap-3 sm:grid-cols-2">
            {visibleAggregates.map((aggregate) => (
              <article key={aggregate.type} className="rounded-3xl border border-black/5 bg-card p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">{aggregateTitle(aggregate)}</p>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-2xl font-bold text-ink">{aggregate.classification}</p>
                    <p className="mt-1 text-sm text-muted">{aggregateValue(aggregate)}</p>
                  </div>
                  <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink">
                    {Math.round(aggregate.confidence * 100)}% confidence
                  </span>
                </div>
                <p className="mt-4 text-xs text-muted">
                  Updated {freshness(aggregate.lastUpdatedAt)} · {aggregate.observationCount} observations · {aggregate.distinctContributorCount} contributing {aggregate.distinctContributorCount === 1 ? "device" : "devices"}
                </p>
                {aggregate.type === "sound_dbfs" ? (
                  <p className="mt-2 text-xs text-muted">Uncalibrated digital loudness (dBFS), not sound-pressure dB. No raw audio is stored.</p>
                ) : (
                  <p className="mt-2 text-xs text-muted">Participating-device activity only—not occupancy or pedestrian count.</p>
                )}
              </article>
            ))}
            {!visibleAggregates.length && !busy ? (
              <div className="rounded-3xl border border-dashed border-black/15 bg-card p-6 sm:col-span-2">
                <p className="font-bold text-ink">No supported insight yet</p>
                <p className="mt-2 text-sm text-muted">
                  {mode === "community"
                    ? "Community insights stay unavailable until at least three distinct contributors support the aggregate."
                    : "Tap Read this spot or open the clearly labeled example view."}
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {view === "patterns" ? (
          <section className="space-y-3">
            {(snapshot?.patterns ?? []).map((pattern) => (
              <article key={`${pattern.type}-${pattern.dayOfWeek}-${pattern.hour}`} className="rounded-3xl border border-black/5 bg-card p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-teal">{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][pattern.dayOfWeek]} · {String(pattern.hour).padStart(2, "0")}:00 UTC</p>
                <p className="mt-2 text-xl font-bold text-ink">{pattern.type === "sound_dbfs" ? `${Number(pattern.baseline).toFixed(1)} dBFS usual` : `${Number(pattern.baseline).toFixed(2)} motion intensity`}</p>
                <p className="mt-2 text-sm text-muted">{pattern.sampleCount} historical samples · {Math.round(pattern.confidence * 100)}% confidence</p>
              </article>
            ))}
            {!snapshot?.patterns.length ? (
              <div className="rounded-3xl border border-dashed border-black/15 bg-card p-6">
                <p className="font-bold text-ink">Not enough history</p>
                <p className="mt-2 text-sm text-muted">Nearby Hello needs at least three observations in the same time bucket before showing a personal baseline.</p>
              </div>
            ) : null}
          </section>
        ) : null}

        {view === "nearby" ? (
          <section className="rounded-3xl border border-black/5 bg-card p-5 shadow-sm">
            <p className="text-lg font-bold text-ink">Your spot readings</p>
            <p className="mt-1 max-w-xl text-sm text-muted">
              Each tap takes one short reading and stops automatically. If a
              permission is denied, the rest of Nearby Hello still works.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void readThisSpot()} className="rounded-xl bg-ink px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? "Reading…" : "Read this spot"}</button>
              <button type="button" disabled={busy} onClick={() => void deleteContributions()} className="rounded-xl border border-black/10 bg-card px-4 py-2.5 text-sm font-bold text-muted disabled:opacity-50">Delete my readings</button>
            </div>
          </section>
        ) : null}
      </main>

      <TabBar active={view} />
    </div>
  );
}
