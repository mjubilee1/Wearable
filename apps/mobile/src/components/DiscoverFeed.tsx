import { useCallback, useEffect, useMemo, useState } from "react";
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
  intentForPlaceCategory,
  intentTitle,
  trustFromProvenance,
  trustFromVerification,
  type DataMode,
  type NearbySpatialPlace,
  type SpatialInsight,
  type SpatialSnapshot,
} from "@nearby/shared";
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
      setMessage(
        caught instanceof Error ? caught.message : "Could not load discoveries.",
      );
    } finally {
      setBusy(false);
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

  async function checkSpot() {
    if (!user) return;
    setBusy(true);
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
      setMessage(
        "Reading saved. Discoveries will update when enough signals exist.",
      );
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
      setBusy(false);
    }
  }

  const radiusLabel = useMemo(
    () => milesLabel(DEFAULT_PLACE_RADIUS_METERS),
    [],
  );
  const atmosphere = snapshot?.aggregates.find((row) => row.type === "sound_dbfs");

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.eyebrow}>
          Discover around you · {radiusLabel}
        </Text>
        <Text style={styles.title}>Your local intelligence</Text>
        <Text style={styles.lead}>
          Find places to work, socialize, relax, or explore from real
          observations—not a business directory.
        </Text>
        <Text style={styles.meta}>
          {spatial.label}
          {mode === "demo" ? " · Example data" : ""}
          {busy ? " · Loading…" : ""}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Area atmosphere</Text>
        {atmosphere ? (
          <>
            <Text style={styles.hero}>{atmosphere.classification}</Text>
            <View style={styles.row}>
              <TrustBadge label={trustFromProvenance(atmosphere.provenance)} />
              <Text style={styles.meta}>
                Updated {freshness(atmosphere.lastUpdatedAt)}
              </Text>
            </View>
          </>
        ) : (
          <TrustBadge label="unavailable" showHint />
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Nearby discoveries</Text>

        {placesUnavailable ? (
          <Text style={styles.meta}>
            Place discovery is temporarily unavailable. Atmosphere readings can
            still work.
          </Text>
        ) : null}

        {!busy && !placesUnavailable && !cards.length ? (
          <Text style={styles.meta}>
            No nearby places loaded yet. Check this spot once location is on.
          </Text>
        ) : null}

        {cards.map(({ place, insights }) => {
          const intent = intentForPlaceCategory(place.category);
          const top = insights[0] ?? null;
          const trust = top
            ? trustFromVerification(top.verificationStatus)
            : ("unavailable" as const);
          return (
            <Pressable
              key={place.id}
              style={styles.card}
              onPress={() =>
                router.push(`/places/${encodeURIComponent(place.id)}`)
              }
            >
              <View style={styles.cardTop}>
                <View style={styles.cardCopy}>
                  <Text style={styles.intent}>{intentTitle(intent)}</Text>
                  <Text style={styles.cardTitle}>{place.name}</Text>
                </View>
                <Text style={styles.meta}>
                  {place.distanceMeters < 1000
                    ? `${place.distanceMeters} m`
                    : `${(place.distanceMeters / 1000).toFixed(1)} km`}
                </Text>
              </View>
              <Text style={styles.body}>
                {top
                  ? top.text
                  : "No verified observations yet for this place."}
              </Text>
              <View style={styles.badgePad}>
                <TrustBadge label={trust} />
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Contribute</Text>
        <Text style={styles.meta}>
          Optional. A short foreground reading helps fill gaps. Nearby Hello
          never stores room audio.
        </Text>
        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          disabled={busy}
          onPress={() => void checkSpot()}
        >
          <Text style={styles.buttonText}>
            {busy ? "Working…" : "Check this spot"}
          </Text>
        </Pressable>
        {busy ? <ActivityIndicator color={colors.ink} /> : null}
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
  section: {
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(17,24,39,0.1)",
    paddingTop: 20,
  },
  sectionLabel: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: "600" },
  hero: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(17,24,39,0.1)",
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  cardCopy: { flex: 1, gap: 4 },
  intent: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  cardTitle: { color: colors.ink, fontSize: 18, fontWeight: "600" },
  body: { color: colors.ink, fontSize: 14, lineHeight: 20 },
  badgePad: { marginTop: 4 },
  button: {
    alignSelf: "flex-start",
    backgroundColor: colors.ink,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "white", fontSize: 14, fontWeight: "600" },
});
