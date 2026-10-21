"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DataMode,
  EnvironmentalAggregate,
  GeoPoint,
  SensorSession,
  SpatialSnapshot,
} from "@nearby/shared";
import { TabBar } from "@/components/TabBar";
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
  return aggregate.type === "sound_relative"
    ? "Relative sound intensity"
    : "Participating-device activity";
}

function aggregateValue(aggregate: EnvironmentalAggregate): string {
  if (aggregate.type === "sound_relative") {
    return `${Math.round(Number(aggregate.value) * 100)} / 100`;
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
  const [session, setSession] = useState<SensorSession | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [motionEnabled, setMotionEnabled] = useState(false);
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

  async function acquireCurrentLocation() {
    setBusy(true);
    setError(null);
    try {
      const reading = await browserLocationProvider.readCurrent();
      if (!reading) {
        setError("Location permission is off or unavailable in this browser.");
        return;
      }
      setLocation(reading.value);
      setUsingDeviceLocation(true);
      await loadSnapshot("personal", reading.value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Location failed.");
    } finally {
      setBusy(false);
    }
  }

  async function startCollection() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const locationReading = await browserLocationProvider.readCurrent();
      if (!locationReading) throw new Error("Foreground location permission is required.");
      const enabledSensors = [
        "location" as const,
        ...(soundEnabled ? (["sound"] as const) : []),
        ...(motionEnabled ? (["motion"] as const) : []),
      ];
      const token = await user.getIdToken();
      const nextSession = await startSensorSession(token, {
        consent: {
          location: true,
          sound: soundEnabled,
          motion: motionEnabled,
        },
        enabledSensors,
      });
      setLocation(locationReading.value);
      setUsingDeviceLocation(true);
      setMode("personal");
      setSession(nextSession);
      setNotice("Foreground collection is active. Nothing records in the background.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start collection.");
    } finally {
      setBusy(false);
    }
  }

  async function measureNow() {
    if (!user || !session) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const locationReading = await browserLocationProvider.readCurrent();
      if (!locationReading) throw new Error("A current location fix is required.");
      const token = await user.getIdToken();
      let count = 0;
      if (soundEnabled) {
        if (!browserSoundProvider.supported) {
          throw new Error("Relative sound measurement is not supported here.");
        }
        const sound = await browserSoundProvider.readRelativeIntensity();
        if (!sound) throw new Error("Microphone permission was not granted.");
        await submitObservation(token, {
          sessionId: session.id,
          location: locationReading.value,
          type: "sound_relative",
          value: sound.value,
          observedAt: sound.measuredAt,
          source: "web",
          quality: { qualityScore: sound.qualityScore, calibrated: false },
        });
        count += 1;
      }
      if (motionEnabled) {
        if (!browserMotionProvider.supported) {
          throw new Error("Motion sensing is not supported in this browser.");
        }
        const motion = await browserMotionProvider.readMovementState();
        if (!motion) throw new Error("Motion permission or readings are unavailable.");
        await submitObservation(token, {
          sessionId: session.id,
          location: locationReading.value,
          type: "motion_state",
          value: motion.value,
          observedAt: motion.measuredAt,
          source: "web",
          quality: { qualityScore: motion.qualityScore, calibrated: false },
        });
        count += 1;
      }
      setNotice(
        `${count} personal measurement${count === 1 ? "" : "s"} saved. Raw audio never left this device.`,
      );
      await loadSnapshot("personal", locationReading.value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Measurement failed.");
    } finally {
      setBusy(false);
    }
  }

  async function stopCollection() {
    if (!user || !session) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      await stopSensorSession(token, session.id);
      setSession(null);
      setNotice("Collection stopped.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not stop collection.");
    } finally {
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
    if (mode === "demo") return "Demonstration data";
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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void acquireCurrentLocation()}
            className="rounded-xl bg-teal px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {usingDeviceLocation ? "Refresh my location" : "Use my location"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void loadSnapshot("demo", usingDeviceLocation ? location : PILOT_LOCATION)}
            className="rounded-xl border border-black/10 bg-card px-4 py-2.5 text-sm font-bold text-ink disabled:opacity-50"
          >
            View labeled demo
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
                {aggregate.type === "sound_relative" ? (
                  <p className="mt-2 text-xs text-muted">Relative intensity only—not calibrated decibels. No raw audio is stored.</p>
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
                    : "Start a personal foreground session or open the clearly labeled demonstration view."}
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {view === "patterns" ? (
          <section className="space-y-3">
            {(snapshot?.patterns ?? []).map((pattern) => (
              <article key={`${pattern.type}-${pattern.dayType}-${pattern.hour}`} className="rounded-3xl border border-black/5 bg-card p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-teal">{pattern.dayType} · {String(pattern.hour).padStart(2, "0")}:00 UTC</p>
                <p className="mt-2 text-xl font-bold text-ink">{pattern.type === "sound_relative" ? `${Math.round(Number(pattern.baseline) * 100)} / 100 relative sound` : String(pattern.baseline)}</p>
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-ink">Personal collection</p>
                <p className="mt-1 max-w-xl text-sm text-muted">
                  Foreground only. Each sensor requires separate permission. Closing or leaving this screen stops browser measurements.
                </p>
              </div>
              <span className={session ? "rounded-full bg-teal-soft px-3 py-1 text-xs font-bold text-teal" : "rounded-full bg-surface px-3 py-1 text-xs font-bold text-muted"}>
                {session ? "Sensing active" : "Sensing stopped"}
              </span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="flex items-start gap-3 rounded-2xl bg-surface p-4">
                <input type="checkbox" checked={soundEnabled} disabled={Boolean(session)} onChange={(event) => setSoundEnabled(event.target.checked)} className="mt-1 accent-teal" />
                <span><strong className="block text-sm text-ink">Relative sound</strong><span className="text-xs text-muted">One local one-second sample. Raw audio is discarded.</span></span>
              </label>
              <label className="flex items-start gap-3 rounded-2xl bg-surface p-4">
                <input type="checkbox" checked={motionEnabled} disabled={Boolean(session)} onChange={(event) => setMotionEnabled(event.target.checked)} className="mt-1 accent-teal" />
                <span><strong className="block text-sm text-ink">Device movement</strong><span className="text-xs text-muted">Broad state only; browser support varies.</span></span>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {!session ? (
                <button type="button" disabled={busy || (!soundEnabled && !motionEnabled)} onClick={() => void startCollection()} className="rounded-xl bg-ink px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Start foreground session</button>
              ) : (
                <>
                  <button type="button" disabled={busy} onClick={() => void measureNow()} className="rounded-xl bg-teal px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Measure now</button>
                  <button type="button" disabled={busy} onClick={() => void stopCollection()} className="rounded-xl border border-coral/40 bg-coral-soft px-4 py-2.5 text-sm font-bold text-coral disabled:opacity-50">Stop sensing</button>
                </>
              )}
              <button type="button" disabled={busy || Boolean(session)} onClick={() => void deleteContributions()} className="rounded-xl border border-black/10 bg-card px-4 py-2.5 text-sm font-bold text-muted disabled:opacity-50">Delete my observations</button>
            </div>
          </section>
        ) : null}
      </main>

      <TabBar active={view} />
    </div>
  );
}
