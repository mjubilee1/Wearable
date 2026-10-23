"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_PLACE_RADIUS_METERS,
  PREVIEW_PLACE_LIMIT,
  intentForPlaceCategory,
  intentTitle,
  trustFromProvenance,
  trustFromVerification,
  type DataMode,
  type NearbySpatialPlace,
  type PublicAreaActivity,
  type SpatialInsight,
  type SpatialSnapshot,
} from "@nearby/shared";
import { TabBar } from "@/components/TabBar";
import { TrustBadge } from "@/components/TrustBadge";
import { useAuth } from "@/lib/auth-context";
import {
  getNearbyAreas,
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
import { useForegroundSensing } from "@/lib/sensing/session";
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        window.clearTimeout(timer);
        resolve(null);
      });
  });
}

export function DiscoverFeed() {
  const { user } = useAuth();
  const spatial = useSpatialLocation();
  const [snapshot, setSnapshot] = useState<SpatialSnapshot | null>(null);
  const [cards, setCards] = useState<DiscoveryCard[]>([]);
  const [placesUnavailable, setPlacesUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [areaActivity, setAreaActivity] = useState<PublicAreaActivity | null>(
    null,
  );
  useForegroundSensing();
  const cardsRef = useRef(cards);
  const loadId = useRef(0);
  cardsRef.current = cards;

  const load = useCallback(async () => {
    if (!user || !spatial.ready) return;
    const id = ++loadId.current;
    setLoading(true);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      const nextMode: DataMode = spatial.usingDevice ? "personal" : "demo";
      const [nextSnapshot, placesResult, areas] = await Promise.all([
        getSpatialSnapshot(token, spatial.location, nextMode),
        withTimeout(
          getNearbyPlaces(token, spatial.location, {
            radiusMeters: DEFAULT_PLACE_RADIUS_METERS,
            limit: PREVIEW_PLACE_LIMIT,
          }),
          4_000,
        ),
        withTimeout(getNearbyAreas(token, spatial.location), 8_000),
      ]);
      if (id !== loadId.current) return;
      setSnapshot(nextSnapshot);
      const activity =
        areas?.areas.find(
          (area) => area.activity && area.activity.value !== "insufficient",
        )?.activity ?? null;
      setAreaActivity(activity);
      if (!placesResult) {
        if (cardsRef.current.length === 0) setPlacesUnavailable(true);
        else setMessage("Showing the last places we found.");
        return;
      }
      setPlacesUnavailable(false);
      const top = placesResult.places.slice(0, PREVIEW_PLACE_LIMIT);
      if (top.length === 0) {
        setCards([]);
        return;
      }
      setCards(top.map((place) => ({ place, insights: [] })));
      setLoading(false);
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
      if (id !== loadId.current) return;
      setCards(withInsights);
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not load discoveries.",
      );
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, [spatial.location, spatial.ready, spatial.usingDevice, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function useMyLocation() {
    setLocating(true);
    setMessage(null);
    try {
      await spatial.requestDeviceLocation();
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Could not read your location.",
      );
    } finally {
      setLocating(false);
    }
  }

  async function checkSpot() {
    if (!user) return;
    setChecking(true);
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
      setMessage("Reading saved.");
      await load();
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not check this spot.",
      );
    } finally {
      if (sessionId) {
        try {
          const token = await user.getIdToken();
          await stopSensorSession(token, sessionId);
        } catch {
          // Contribution already stored.
        }
      }
      setChecking(false);
    }
  }

  const radiusLabel = useMemo(
    () => milesLabel(DEFAULT_PLACE_RADIUS_METERS),
    [],
  );
  const atmosphere = snapshot?.aggregates.find(
    (row) => row.type === "sound_dbfs",
  );
  const exampleMode = !spatial.usingDevice;
  const liveLine = atmosphere
    ? atmosphere.classification
    : areaActivity
      ? areaActivity.label
      : null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-white px-5 pb-24 pt-20">
      <header className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm text-muted">
            Discover · {radiusLabel}
            {loading ? " · Loading…" : ""}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            What&apos;s nearby
          </h1>
          <p className="max-w-lg text-base leading-relaxed text-muted">
            Find places around you. Live calm or busy readings show up only when
            enough people opt in.
          </p>
        </div>

        {exampleMode ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted">
              Showing a Washington, DC sample area.
            </p>
            <button
              type="button"
              disabled={locating || loading}
              onClick={() => void useMyLocation()}
              className="bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {locating ? "Getting location…" : "Use my location"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted">Around you</p>
        )}
      </header>

      <main className="mt-10 flex-1 space-y-10">
        {(liveLine || !loading) && (
          <section className="space-y-2 border-t border-ink/10 pt-6">
            <h2 className="text-sm font-medium text-muted">Right now</h2>
            {liveLine ? (
              <>
                <p className="text-2xl font-semibold capitalize text-ink">
                  {liveLine}
                </p>
                {atmosphere ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <TrustBadge
                      label={trustFromProvenance(atmosphere.provenance)}
                    />
                    <span className="text-sm text-muted">
                      Updated {freshness(atmosphere.lastUpdatedAt)}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    Estimated from consenting devices—not a crowd count.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm leading-relaxed text-muted">
                No live readings for this area yet. You can still browse places
                below.
              </p>
            )}
          </section>
        )}

        <section className="space-y-4 border-t border-ink/10 pt-6">
          <h2 className="text-lg font-semibold text-ink">Places</h2>

          {loading ? (
            <p className="text-sm text-muted">Loading places…</p>
          ) : null}

          {placesUnavailable ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Couldn&apos;t load places. Try again.
              </p>
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

          {!loading && !placesUnavailable && !cards.length ? (
            <p className="text-sm text-muted">
              No named places this close yet.
              {exampleMode ? " Try Use my location." : " Search a neighborhood in Explore."}
            </p>
          ) : null}

          <ul className="divide-y divide-ink/10 border-t border-ink/10">
            {cards.map(({ place, insights }) => {
              const intent = intentForPlaceCategory(place.category);
              const top = insights[0] ?? null;
              return (
                <li key={place.id}>
                  <Link
                    href={`/places/${encodeURIComponent(place.id)}`}
                    className="block py-4 hover:bg-surface/60"
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
                    <p className="mt-2 text-sm text-muted">
                      {top
                        ? top.text
                        : "No live notes yet for this place."}
                    </p>
                    {top ? (
                      <div className="mt-2">
                        <TrustBadge
                          label={trustFromVerification(top.verificationStatus)}
                        />
                      </div>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-3 border-t border-ink/10 pt-6">
          <h2 className="text-sm font-medium text-muted">Optional check-in</h2>
          <p className="text-sm leading-relaxed text-muted">
            Share a short reading while you&apos;re here. Audio is never stored.{" "}
            <Link href="/settings" className="font-medium text-teal">
              Settings
            </Link>
          </p>
          <button
            type="button"
            disabled={checking || locating}
            onClick={() => void checkSpot()}
            className="border border-ink/15 px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
          >
            {checking ? "Checking…" : "Check this spot"}
          </button>
          {message ? <p className="text-sm text-muted">{message}</p> : null}
        </section>
      </main>

      <TabBar active="nearby" />
    </div>
  );
}
