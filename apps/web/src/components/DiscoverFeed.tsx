"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_PLACE_RADIUS_METERS,
  intentForPlaceCategory,
  intentTitle,
  trustFromProvenance,
  trustFromVerification,
  type DataMode,
  type NearbySpatialPlace,
  type SpatialInsight,
  type SpatialSnapshot,
} from "@nearby/shared";
import { TabBar } from "@/components/TabBar";
import { TrustBadge } from "@/components/TrustBadge";
import { useAuth } from "@/lib/auth-context";
import {
  getNearbyPlaces,
  getPlaceInsights,
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
import { useSpatialLocation } from "@/lib/use-spatial-location";

type DiscoveryCard = {
  place: NearbySpatialPlace;
  insights: SpatialInsight[];
};

function freshness(timestamp: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function milesLabel(meters: number): string {
  const miles = meters / 1609.34;
  if (miles < 0.1) return "Nearby";
  return `Within ${miles < 1 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

export function DiscoverFeed() {
  const { user } = useAuth();
  const spatial = useSpatialLocation();
  const [mode, setMode] = useState<DataMode>("demo");
  const [snapshot, setSnapshot] = useState<SpatialSnapshot | null>(null);
  const [cards, setCards] = useState<DiscoveryCard[]>([]);
  const [placesUnavailable, setPlacesUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !spatial.ready) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      const nextMode: DataMode = spatial.usingDevice ? "personal" : "demo";
      const [nextSnapshot, placesResult] = await Promise.all([
        getSpatialSnapshot(token, spatial.location, nextMode),
        getNearbyPlaces(token, spatial.location, {
          radiusMeters: DEFAULT_PLACE_RADIUS_METERS,
          limit: 12,
        }).catch(() => null),
      ]);
      setMode(nextMode);
      setSnapshot(nextSnapshot);
      if (!placesResult) {
        setPlacesUnavailable(true);
        setCards([]);
        return;
      }
      setPlacesUnavailable(false);
      const top = placesResult.places.slice(0, 8);
      const withInsights = await Promise.all(
        top.map(async (place) => {
          try {
            const detail = await getPlaceInsights(token, place.id);
            return { place, insights: detail.insights };
          } catch {
            return { place, insights: [] as SpatialInsight[] };
          }
        }),
      );
      setCards(withInsights);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not load discoveries.");
    } finally {
      setBusy(false);
    }
  }, [spatial.location, spatial.ready, spatial.usingDevice, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function checkSpot() {
    if (!user) return;
    setBusy(true);
    setMessage(null);
    let sessionId: string | null = null;
    try {
      await spatial.requestDeviceLocation();
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
        setMessage("Allow location to contribute a reading.");
        return;
      }
      const sound =
        soundResult.status === "fulfilled" ? soundResult.value : null;
      const motion =
        motionResult.status === "fulfilled" ? motionResult.value : null;
      if (!sound && !motion) {
        setMessage("Allow mic or motion to contribute a reading.");
        return;
      }
      const token = await user.getIdToken();
      const session = await startSensorSession(token, {
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
      sessionId = session.id;
      const jobs = [];
      if (sound) {
        jobs.push(
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
        jobs.push(
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
      await Promise.all(jobs);
      spatial.setLocation(locationReading.value);
      spatial.setUsingDevice(true);
      spatial.setLabel("Around you");
      setMessage("Reading saved. Discoveries will update when enough signals exist.");
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not check this spot.");
    } finally {
      if (sessionId) {
        try {
          const token = await user.getIdToken();
          await stopSensorSession(token, sessionId);
        } catch {
          // Contribution already stored.
        }
      }
      setBusy(false);
    }
  }

  const radiusLabel = useMemo(
    () => milesLabel(DEFAULT_PLACE_RADIUS_METERS),
    [],
  );

  const atmosphere = snapshot?.aggregates.find((row) => row.type === "sound_dbfs");

  return (
    <div className="app-shell mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pb-24 pt-20">
      <header className="mb-8 space-y-2">
        <p className="text-sm text-muted">
          Discover around you · {radiusLabel}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Your local intelligence
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-muted">
          Find places to work, socialize, relax, or explore from real
          observations—not a business directory.
        </p>
        <p className="text-sm text-muted">
          {spatial.label}
          {mode === "demo" ? " · Example data" : ""}
          {busy ? " · Loading…" : ""}
        </p>
      </header>

      <main className="flex-1 space-y-10">
        <section className="space-y-3 border-t border-ink/10 pt-6">
          <h2 className="text-sm font-medium text-muted">Area atmosphere</h2>
          {atmosphere ? (
            <div>
              <p className="text-2xl font-semibold capitalize text-ink">
                {atmosphere.classification}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <TrustBadge label={trustFromProvenance(atmosphere.provenance)} />
                <span className="text-sm text-muted">
                  Updated {freshness(atmosphere.lastUpdatedAt)}
                </span>
              </div>
            </div>
          ) : (
            <div>
              <TrustBadge label="unavailable" showHint />
            </div>
          )}
        </section>

        <section className="space-y-4 border-t border-ink/10 pt-6">
          <h2 className="text-lg font-semibold text-ink">Nearby discoveries</h2>

          {placesUnavailable ? (
            <p className="text-sm text-muted">
              Place discovery is temporarily unavailable. Atmosphere readings can
              still work.
            </p>
          ) : null}

          {!busy && !placesUnavailable && !cards.length ? (
            <p className="text-sm text-muted">
              No nearby places loaded yet. Check this spot once location is on.
            </p>
          ) : null}

          <ul className="space-y-4">
            {cards.map(({ place, insights }) => {
              const intent = intentForPlaceCategory(place.category);
              const top = insights[0] ?? null;
              const trust = top
                ? trustFromVerification(top.verificationStatus)
                : ("unavailable" as const);
              return (
                <li key={place.id}>
                  <Link
                    href={`/places/${encodeURIComponent(place.id)}`}
                    className="block border border-ink/10 px-4 py-4 hover:border-ink/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted">
                          {intentTitle(intent)}
                        </p>
                        <p className="mt-1 text-lg font-semibold text-ink">
                          {place.name}
                        </p>
                      </div>
                      <p className="shrink-0 text-xs text-muted">
                        {place.distanceMeters < 1000
                          ? `${place.distanceMeters} m`
                          : `${(place.distanceMeters / 1000).toFixed(1)} km`}
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-ink">
                      {top
                        ? top.text
                        : "No verified observations yet for this place."}
                    </p>
                    <div className="mt-3">
                      <TrustBadge label={trust} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-3 border-t border-ink/10 pt-6">
          <h2 className="text-sm font-medium text-muted">Contribute</h2>
          <p className="text-sm leading-relaxed text-muted">
            Optional. A short foreground reading helps fill gaps. Nearby Hello
            never stores room audio.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void checkSpot()}
            className="bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Working…" : "Check this spot"}
          </button>
          {message ? <p className="text-sm text-muted">{message}</p> : null}
        </section>
      </main>

      <TabBar active="nearby" />
    </div>
  );
}
