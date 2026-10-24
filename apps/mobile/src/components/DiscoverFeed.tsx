import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";
import {
  DEFAULT_PLACE_RADIUS_METERS,
  PREVIEW_PLACE_LIMIT,
  intentForPlaceCategory,
  intentTitle,
  trustFromProvenance,
  trustFromVerification,
  type NearbySpatialPlace,
  type PublicAreaActivity,
  type SpatialInsight,
  type SpatialSnapshot,
} from "@nearby/shared";
import { TrustBadge } from "@/components/TrustBadge";
import { useAuth } from "@/lib/auth-context";
import { useForegroundSensing } from "@/lib/sensing/session";
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
  mobileLocationProvider,
  mobileMotionProvider,
} from "@/lib/sensor-providers";
import { useSpatialLocation } from "@/lib/use-spatial-location";
import { colors } from "@/lib/theme";

type DiscoveryCard = {
  place: NearbySpatialPlace;
  insights: SpatialInsight[];
};

const SOUND_RECORDING_OPTIONS = {
  ...RecordingPresets.LOW_QUALITY,
  isMeteringEnabled: true,
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
  const router = useRouter();
  const spatial = useSpatialLocation();
  const recorder = useAudioRecorder(SOUND_RECORDING_OPTIONS);
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
      const mode = spatial.usingDevice ? "personal" : "demo";
      const [nextSnapshot, placesResult, areas] = await Promise.all([
        getSpatialSnapshot(token, spatial.location, mode),
        getNearbyPlaces(token, spatial.location, {
          radiusMeters: DEFAULT_PLACE_RADIUS_METERS,
          limit: PREVIEW_PLACE_LIMIT,
        }).catch(() => null),
        getNearbyAreas(token, spatial.location).catch(() => null),
      ]);
      if (id !== loadId.current) return;
      setSnapshot(nextSnapshot);
      setAreaActivity(
        areas?.areas.find(
          (area) => area.activity && area.activity.value !== "insufficient",
        )?.activity ?? null,
      );
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

  async function relativeSound(): Promise<number | null> {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return null;
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record({ forDuration: 11 });
    const readings: number[] = [];
    try {
      for (let index = 0; index < 80; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 125));
        const metering = recorder.getStatus().metering;
        if (typeof metering === "number") {
          readings.push(Math.max(-100, Math.min(0, metering)));
        }
      }
    } finally {
      await recorder.stop();
      if (recorder.uri) {
        try {
          new File(recorder.uri).delete();
        } catch {
          // Temporary audio may already be removed.
        }
      }
    }
    if (!readings.length) return null;
    return readings.reduce((sum, value) => sum + value, 0) / readings.length;
  }

  async function handleUseMyLocation() {
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
          mobileLocationProvider.readCurrent(),
          relativeSound(),
          mobileMotionProvider.readMotionIntensity(),
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
      if (sound === null && !motion) {
        setMessage("Allow mic or motion to contribute a reading.");
        return;
      }
      const token = await user.getIdToken();
      const session = await startSensorSession(token, {
        consent: {
          location: true,
          sound: sound !== null,
          motion: Boolean(motion),
        },
        enabledSensors: [
          "location",
          ...(sound !== null ? (["sound"] as const) : []),
          ...(motion ? (["motion"] as const) : []),
        ],
      });
      sessionId = session.id;
      const jobs = [];
      if (sound !== null) {
        jobs.push(
          submitObservation(token, {
            sessionId,
            location: locationReading.value,
            type: "sound_dbfs",
            value: sound,
            observedAt: Date.now(),
            source: "mobile",
            quality: { qualityScore: 0.75, calibrated: false },
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
            source: "mobile",
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
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.eyebrow}>
          Discover · {radiusLabel}
          {loading ? " · Loading…" : ""}
        </Text>
        <Text style={styles.title}>What's nearby</Text>
        <Text style={styles.lead}>
          Find places around you. Live calm or busy readings show up only when
          enough people opt in.
        </Text>
      </View>

      {exampleMode ? (
        <View style={styles.locationRow}>
          <Text style={styles.meta}>Showing a Washington, DC sample area.</Text>
          <Pressable
            style={[styles.primaryBtn, (locating || loading) && styles.disabled]}
            disabled={locating || loading}
            onPress={() => void handleUseMyLocation()}
          >
            <Text style={styles.primaryBtnText}>
              {locating ? "Getting location…" : "Use my location"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.meta}>Around you</Text>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Right now</Text>
        {liveLine ? (
          <>
            <Text style={styles.live}>{liveLine}</Text>
            {atmosphere ? (
              <View style={styles.row}>
                <TrustBadge label={trustFromProvenance(atmosphere.provenance)} />
                <Text style={styles.meta}>
                  Updated {freshness(atmosphere.lastUpdatedAt)}
                </Text>
              </View>
            ) : (
              <Text style={styles.meta}>
                Estimated from consenting devices—not a crowd count.
              </Text>
            )}
          </>
        ) : (
          <Text style={styles.meta}>
            No live readings for this area yet. You can still browse places
            below.
          </Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Places</Text>
        {loading ? <Text style={styles.meta}>Loading places…</Text> : null}
        {placesUnavailable ? (
          <View style={styles.gap}>
            <Text style={styles.meta}>Couldn't load places. Try again.</Text>
            <Pressable
              style={[styles.secondaryBtn, loading && styles.disabled]}
              disabled={loading}
              onPress={() => void load()}
            >
              <Text style={styles.secondaryBtnText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {!loading && !placesUnavailable && !cards.length ? (
          <Text style={styles.meta}>
            No named places this close yet.
            {exampleMode ? " Try Use my location." : " Search a neighborhood in Explore."}
          </Text>
        ) : null}

        {cards.map(({ place, insights }) => {
          const intent = intentForPlaceCategory(place.category);
          const top = insights[0] ?? null;
          return (
            <Pressable
              key={place.id}
              style={styles.place}
              onPress={() =>
                router.push(`/places/${encodeURIComponent(place.id)}`)
              }
            >
              <View style={styles.placeTop}>
                <View style={styles.placeCopy}>
                  <Text style={styles.intent}>{intentTitle(intent)}</Text>
                  <Text style={styles.placeName}>{place.name}</Text>
                </View>
                <Text style={styles.meta}>
                  {place.distanceMeters < 1000
                    ? `${place.distanceMeters} m`
                    : `${(place.distanceMeters / 1000).toFixed(1)} km`}
                </Text>
              </View>
              <Text style={styles.placeBody}>
                {top ? top.text : "No live notes yet for this place."}
              </Text>
              {top ? (
                <TrustBadge
                  label={trustFromVerification(top.verificationStatus)}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Optional check-in</Text>
        <Text style={styles.meta}>
          Share a short reading while you are here. Audio is never stored.
          Ongoing sensing is in Settings.
        </Text>
        <Pressable
          style={[styles.secondaryBtn, (checking || locating) && styles.disabled]}
          disabled={checking || locating}
          onPress={() => void checkSpot()}
        >
          <Text style={styles.secondaryBtnText}>
            {checking ? "Checking…" : "Check this spot"}
          </Text>
        </Pressable>
        {checking ? <ActivityIndicator color={colors.ink} /> : null}
        {message ? <Text style={styles.meta}>{message}</Text> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 40,
    gap: 28,
  },
  header: { gap: 8 },
  eyebrow: { color: colors.muted, fontSize: 14 },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: -0.4,
  },
  lead: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  locationRow: { gap: 12 },
  section: {
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 20,
  },
  sectionLabel: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: "600" },
  live: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  gap: { gap: 12 },
  place: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingVertical: 16,
    gap: 8,
  },
  placeTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  placeCopy: { flex: 1, gap: 4 },
  intent: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  placeName: { color: colors.ink, fontSize: 18, fontWeight: "600" },
  placeBody: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  primaryBtn: {
    alignSelf: "flex-start",
    backgroundColor: colors.ink,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  primaryBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  secondaryBtn: {
    alignSelf: "flex-start",
    borderColor: "rgba(17,24,39,0.15)",
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  secondaryBtnText: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.5 },
});
