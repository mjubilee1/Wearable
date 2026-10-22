"use client";

import { useCallback, useEffect, useState } from "react";
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

const WEEKDAYS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

function freshness(timestamp: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function primaryReading(
  aggregates: EnvironmentalAggregate[],
): EnvironmentalAggregate | null {
  return (
    aggregates.find((item) => item.type === "sound_dbfs") ??
    aggregates[0] ??
    null
  );
}

export function NearbyHelloDashboard({ view }: { view: View }) {
  const { user } = useAuth();
  const [location, setLocation] = useState<GeoPoint>(PILOT_LOCATION);
  const [usingDeviceLocation, setUsingDeviceLocation] = useState(false);
  const [mode, setMode] = useState<DataMode>("demo");
  const [snapshot, setSnapshot] = useState<SpatialSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadSnapshot = useCallback(
    async (nextMode: DataMode, nextLocation: GeoPoint) => {
      if (!user) return;
      setBusy(true);
      setMessage(null);
      try {
        const token = await user.getIdToken();
        const next = await getSpatialSnapshot(token, nextLocation, nextMode);
        setMode(nextMode);
        setSnapshot(next);
      } catch (caught) {
        setMessage(
          caught instanceof Error ? caught.message : "Could not load.",
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

  async function checkSpot() {
    if (!user) return;
    setBusy(true);
    setMessage(null);
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
        setMessage("Allow location to check this spot.");
        return;
      }
      const sound =
        soundResult.status === "fulfilled" ? soundResult.value : null;
      const motion =
        motionResult.status === "fulfilled" ? motionResult.value : null;
      if (!sound && !motion) {
        setMessage("Allow mic or motion to take a reading.");
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
      await loadSnapshot("personal", locationReading.value);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Check failed.");
    } finally {
      if (sessionId) {
        try {
          const token = await user.getIdToken();
          await stopSensorSession(token, sessionId);
        } catch {
          // Reading already finished.
        }
      }
      setBusy(false);
    }
  }

  async function deleteContributions() {
    if (!user || !window.confirm("Delete your readings?")) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      await deleteSpatialContributions(token);
      setMessage("Readings deleted.");
      await loadSnapshot("personal", location);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  const reading = primaryReading(snapshot?.aggregates ?? []);
  const title =
    view === "nearby" ? "Nearby" : view === "explore" ? "Explore" : "Patterns";

  return (
    <div className="app-shell mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pb-24 pt-20">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
      </header>

      <main className="flex-1 space-y-10">
        {view === "nearby" ? (
          <section className="space-y-6">
            <div>
              <p className="text-sm text-muted">This place</p>
              <p className="mt-2 text-4xl font-semibold capitalize tracking-tight text-ink">
                {reading?.classification ?? (busy ? "…" : "Unknown")}
              </p>
              {reading ? (
                <p className="mt-2 text-sm text-muted">
                  Updated {freshness(reading.lastUpdatedAt)}
                  {mode === "demo" ? " · example" : ""}
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted">
                  {mode === "demo"
                    ? "Example view until you check a spot."
                    : "No reading yet."}
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void checkSpot()}
              className="bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Checking…" : "Check this spot"}
            </button>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void loadSnapshot(
                    "demo",
                    usingDeviceLocation ? location : PILOT_LOCATION,
                  )
                }
                className="hover:text-ink disabled:opacity-50"
              >
                Example
              </button>
              {usingDeviceLocation ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void loadSnapshot("personal", location)}
                    className="hover:text-ink disabled:opacity-50"
                  >
                    Mine
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void loadSnapshot("community", location)}
                    className="hover:text-ink disabled:opacity-50"
                  >
                    Shared
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteContributions()}
                    className="hover:text-ink disabled:opacity-50"
                  >
                    Delete mine
                  </button>
                </>
              ) : null}
            </div>
          </section>
        ) : null}

        {view === "explore" ? (
          <NearbyPlacesSection initialLocation={location} />
        ) : null}

        {view === "nearby" ? (
          <NearbyPlacesSection initialLocation={location} />
        ) : null}

        {view === "patterns" ? (
          <section className="space-y-5">
            {(snapshot?.patterns ?? []).length ? (
              (snapshot?.patterns ?? []).map((pattern) => (
                <div
                  key={`${pattern.type}-${pattern.dayOfWeek}-${pattern.hour}`}
                >
                  <p className="text-sm text-muted">
                    {WEEKDAYS[pattern.dayOfWeek]} {String(pattern.hour).padStart(2, "0")}:00
                  </p>
                  <p className="mt-1 text-xl font-semibold text-ink">
                    {Number(pattern.baseline).toFixed(0)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">
                Check a spot a few times to see patterns.
              </p>
            )}
          </section>
        ) : null}

        {message ? <p className="text-sm text-muted">{message}</p> : null}
      </main>

      <TabBar active={view} />
    </div>
  );
}
