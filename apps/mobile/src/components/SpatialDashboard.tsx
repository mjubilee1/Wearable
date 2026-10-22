import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";
import type {
  DataMode,
  EnvironmentalAggregate,
  GeoPoint,
  SpatialSnapshot,
} from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";
import {
  deleteSpatialContributions,
  getSpatialSnapshot,
  startSensorSession,
  stopSensorSession,
  submitObservation,
} from "@/lib/spatial-api";
import {
  mobileLocationProvider,
  mobileMotionProvider,
} from "@/lib/sensor-providers";
import { NearbyPlacesSection } from "@/components/NearbyPlacesSection";

type ViewMode = "nearby" | "explore" | "patterns";

const PILOT_LOCATION: GeoPoint = {
  latitude: Number(process.env.EXPO_PUBLIC_PILOT_LATITUDE ?? 38.9072),
  longitude: Number(process.env.EXPO_PUBLIC_PILOT_LONGITUDE ?? -77.0369),
};

const SOUND_RECORDING_OPTIONS = {
  ...RecordingPresets.LOW_QUALITY,
  isMeteringEnabled: true,
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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

export function SpatialDashboard({ view }: { view: ViewMode }) {
  const { user } = useAuth();
  const recorder = useAudioRecorder(SOUND_RECORDING_OPTIONS);
  const [location, setLocation] = useState<GeoPoint>(PILOT_LOCATION);
  const [usingDeviceLocation, setUsingDeviceLocation] = useState(false);
  const [mode, setMode] = useState<DataMode>("demo");
  const [snapshot, setSnapshot] = useState<SpatialSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(
    async (nextMode: DataMode, nextLocation: GeoPoint) => {
      if (!user) return;
      setBusy(true);
      setMessage(null);
      try {
        const token = await user.getIdToken();
        setSnapshot(await getSpatialSnapshot(token, nextLocation, nextMode));
        setMode(nextMode);
      } catch (caught) {
        setMessage(caught instanceof Error ? caught.message : "Could not load.");
      } finally {
        setBusy(false);
      }
    },
    [user],
  );

  useEffect(() => {
    void load("demo", PILOT_LOCATION);
  }, [load]);

  async function relativeSound() {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      throw new Error("Allow the microphone to take a reading.");
    }
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
    if (!readings.length) {
      throw new Error("Sound metering is unavailable on this device.");
    }
    return readings.reduce((sum, value) => sum + value, 0) / readings.length;
  }

  async function checkSpot() {
    if (!user) return;
    setBusy(true);
    setMessage(null);
    let sessionId: string | null = null;
    try {
      const [locationResult, soundResult, motionResult] =
        await Promise.allSettled([
          mobileLocationProvider.readCurrent(),
          relativeSound(),
          mobileMotionProvider.readMotionIntensity(),
        ]);
      const reading =
        locationResult.status === "fulfilled" ? locationResult.value : null;
      if (!reading) {
        setMessage("Allow location to check this spot.");
        return;
      }
      const sound =
        soundResult.status === "fulfilled" ? soundResult.value : null;
      const motion =
        motionResult.status === "fulfilled" ? motionResult.value : null;
      if (sound === null && !motion) {
        setMessage("Allow mic or motion to take a reading.");
        return;
      }
      const token = await user.getIdToken();
      const next = await startSensorSession(token, {
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
      sessionId = next.id;
      const submissions = [];
      if (sound !== null) {
        submissions.push(
          submitObservation(token, {
            sessionId,
            location: reading.value,
            type: "sound_dbfs",
            value: sound,
            observedAt: Date.now(),
            source: "mobile",
            quality: { qualityScore: 0.75, calibrated: false },
          }),
        );
      }
      if (motion) {
        submissions.push(
          submitObservation(token, {
            sessionId,
            location: reading.value,
            type: "motion_intensity",
            value: motion.value,
            observedAt: motion.measuredAt,
            source: "mobile",
            quality: { qualityScore: motion.qualityScore, calibrated: false },
          }),
        );
      }
      await Promise.all(submissions);
      setLocation(reading.value);
      setUsingDeviceLocation(true);
      setMode("personal");
      await load("personal", reading.value);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Check failed.");
    } finally {
      if (sessionId) {
        try {
          const token = await user.getIdToken();
          await stopSensorSession(token, sessionId);
        } catch {
          // Spot reading already finished.
        }
      }
      setBusy(false);
    }
  }

  function confirmDeletion() {
    Alert.alert("Delete your readings?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          if (!user) return;
          setBusy(true);
          void user
            .getIdToken()
            .then(deleteSpatialContributions)
            .then(() => {
              setMessage("Readings deleted.");
              return load("personal", location);
            })
            .catch((caught: unknown) =>
              setMessage(
                caught instanceof Error ? caught.message : "Delete failed.",
              ),
            )
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  const reading = primaryReading(snapshot?.aggregates ?? []);
  const title =
    view === "nearby" ? "Nearby" : view === "explore" ? "Explore" : "Patterns";

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>{title}</Text>

      {view === "nearby" ? (
        <View style={styles.block}>
          <Text style={styles.label}>This place</Text>
          <Text style={styles.hero}>
            {reading?.classification ?? (busy ? "…" : "Unknown")}
          </Text>
          <Text style={styles.meta}>
            {reading
              ? `Updated ${freshness(reading.lastUpdatedAt)}${mode === "demo" ? " · example" : ""}`
              : mode === "demo"
                ? "Example view until you check a spot."
                : "No reading yet."}
          </Text>

          <Pressable
            style={styles.button}
            disabled={busy}
            onPress={() => void checkSpot()}
          >
            <Text style={styles.buttonText}>
              {busy ? "Checking…" : "Check this spot"}
            </Text>
          </Pressable>

          <View style={styles.links}>
            <Pressable
              disabled={busy}
              onPress={() =>
                void load(
                  "demo",
                  usingDeviceLocation ? location : PILOT_LOCATION,
                )
              }
            >
              <Text style={styles.link}>Example</Text>
            </Pressable>
            {usingDeviceLocation ? (
              <>
                <Pressable
                  disabled={busy}
                  onPress={() => void load("personal", location)}
                >
                  <Text style={styles.link}>Mine</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => void load("community", location)}
                >
                  <Text style={styles.link}>Shared</Text>
                </Pressable>
                <Pressable disabled={busy} onPress={confirmDeletion}>
                  <Text style={styles.link}>Delete mine</Text>
                </Pressable>
              </>
            ) : null}
            {busy ? <ActivityIndicator color={colors.ink} /> : null}
          </View>
        </View>
      ) : null}

      {view === "explore" || view === "nearby" ? (
        <NearbyPlacesSection initialLocation={location} />
      ) : null}

      {view === "patterns" ? (
        <View style={styles.block}>
          {(snapshot?.patterns ?? []).length ? (
            (snapshot?.patterns ?? []).map((pattern) => (
              <View
                key={`${pattern.type}-${pattern.dayOfWeek}-${pattern.hour}`}
                style={styles.patternRow}
              >
                <Text style={styles.meta}>
                  {WEEKDAYS[pattern.dayOfWeek]}{" "}
                  {String(pattern.hour).padStart(2, "0")}:00
                </Text>
                <Text style={styles.patternValue}>
                  {Number(pattern.baseline).toFixed(0)}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.meta}>
              Check a spot a few times to see patterns.
            </Text>
          )}
        </View>
      ) : null}

      {message ? <Text style={styles.meta}>{message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 40, gap: 28 },
  title: { color: colors.ink, fontSize: 24, fontWeight: "600" },
  block: { gap: 10 },
  label: { color: colors.muted, fontSize: 14 },
  hero: {
    color: colors.ink,
    fontSize: 36,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  button: {
    alignSelf: "flex-start",
    backgroundColor: colors.ink,
    paddingHorizontal: 16,
    paddingVertical: 11,
    marginTop: 8,
  },
  buttonText: { color: "white", fontSize: 14, fontWeight: "600" },
  links: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14, marginTop: 6 },
  link: { color: colors.muted, fontSize: 14 },
  patternRow: { marginBottom: 14 },
  patternValue: { color: colors.ink, fontSize: 20, fontWeight: "600", marginTop: 2 },
});
