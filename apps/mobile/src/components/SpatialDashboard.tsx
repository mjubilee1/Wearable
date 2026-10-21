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

function freshness(timestamp: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function SpatialDashboard({ view }: { view: ViewMode }) {
  const { user } = useAuth();
  const recorder = useAudioRecorder(SOUND_RECORDING_OPTIONS);
  const [location, setLocation] = useState<GeoPoint>(PILOT_LOCATION);
  const [usingDeviceLocation, setUsingDeviceLocation] = useState(false);
  const [mode, setMode] = useState<DataMode>("demo");
  const [snapshot, setSnapshot] = useState<SpatialSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (nextMode: DataMode, nextLocation: GeoPoint) => {
      if (!user) return;
      setBusy(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        setSnapshot(
          await getSpatialSnapshot(token, nextLocation, nextMode),
        );
        setMode(nextMode);
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
    void load("demo", PILOT_LOCATION);
  }, [load]);

  async function relativeSound() {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) throw new Error("Microphone permission was not granted.");
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
          // Temporary audio may already be removed by the native recorder.
        }
      }
    }
    if (!readings.length) throw new Error("Sound metering is unavailable on this device.");
    return readings.reduce((sum, value) => sum + value, 0) / readings.length;
  }

  async function readThisSpot() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setNotice(null);
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
        setNotice(
          "Location was not allowed, so no reading was saved. You can still explore the labeled example.",
        );
        return;
      }
      const sound =
        soundResult.status === "fulfilled" ? soundResult.value : null;
      const motion =
        motionResult.status === "fulfilled" ? motionResult.value : null;
      if (sound === null && !motion) {
        setNotice(
          "Mic and motion were not available, so no sensor numbers were saved. The example view still works.",
        );
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
      setNotice(
        `${submissions.length} numeric reading${submissions.length === 1 ? "" : "s"} saved to this spot. Raw audio was deleted locally.`,
      );
      await load("personal", reading.value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read this spot.");
    } finally {
      if (sessionId) {
        try {
          const token = await user.getIdToken();
          await stopSensorSession(token, sessionId);
        } catch {
          // The spot reading has already completed.
        }
      }
      setBusy(false);
    }
  }

  function confirmDeletion() {
    Alert.alert(
      "Delete your observations?",
      "This removes your eligible environmental observations.",
      [
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
              .then((deleted) => {
                setNotice(`${deleted} observations deleted.`);
                return load("personal", location);
              })
              .catch((caught: unknown) =>
                setError(
                  caught instanceof Error ? caught.message : "Deletion failed.",
                ),
              )
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }

  const title =
    view === "nearby"
      ? "What is happening around you"
      : view === "explore"
        ? "Explore nearby zones"
        : "Historical patterns";

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.titleRow}>
        <View style={styles.titleCopy}>
          <Text style={styles.eyebrow}>NEARBY HELLO</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {view === "patterns"
              ? "Conditions by time once enough observations support a baseline."
              : "Measured environmental signals with freshness and uncertainty."}
          </Text>
        </View>
        <Text style={[styles.badge, mode === "demo" ? styles.demoBadge : styles.personalBadge]}>
          {mode === "demo" ? "EXAMPLE DATA" : mode.toUpperCase()}
        </Text>
      </View>

      <View style={styles.actions}>
        {view === "nearby" ? (
          <Pressable style={styles.primaryButton} disabled={busy} onPress={() => void readThisSpot()}>
            <Text style={styles.primaryButtonText}>
              {busy ? "Reading… about 10 seconds" : "Read this spot"}
            </Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => void load("demo", usingDeviceLocation ? location : PILOT_LOCATION)}>
          <Text style={styles.secondaryButtonText}>View example data</Text>
        </Pressable>
        <Pressable style={[styles.secondaryButton, !usingDeviceLocation && styles.disabled]} disabled={busy || !usingDeviceLocation} onPress={() => void load("community", location)}>
          <Text style={styles.secondaryButtonText}>Community view</Text>
        </Pressable>
      </View>

      {view === "nearby" ? (
        <Text style={styles.permissionNote}>
          Tap once to let Nearby Hello use location, microphone loudness, and
          phone motion for about 10 seconds. Raw audio is never saved.
        </Text>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <View style={styles.mapCard}>
        <View style={styles.mapHeader}>
          <View>
            <Text style={styles.cardTitle}>Interactive spatial map</Text>
            <Text style={styles.small}>
              Approx. {location.latitude.toFixed(3)}, {location.longitude.toFixed(3)}
            </Text>
          </View>
          {busy ? <ActivityIndicator color={colors.teal} /> : null}
        </View>
        <View style={styles.grid}>
          {Array.from({ length: 9 }, (_, index) => (
            <Pressable
              key={index}
              style={[styles.zone, index === 4 && styles.currentZone]}
            >
              {index === 4 ? <Text style={styles.you}>You</Text> : <Text style={styles.zoneText}>Zone</Text>}
            </Pressable>
          ))}
        </View>
        <Text style={styles.mapFooter}>
          {snapshot
            ? `${snapshot.zone.resolutionMeters} m grid · ${snapshot.zone.id}`
            : "Zone details unavailable"}
        </Text>
      </View>

      {view !== "patterns" ? (
        <NearbyPlacesSection initialLocation={location} />
      ) : null}

      {view !== "patterns" ? (
        <View style={styles.stack}>
          {(snapshot?.aggregates ?? []).map((aggregate) => (
            <View key={aggregate.type} style={styles.card}>
              <Text style={styles.cardEyebrow}>
                {aggregate.type === "sound_dbfs"
                  ? "AMBIENT LOUDNESS"
                  : "PARTICIPATING-DEVICE ACTIVITY"}
              </Text>
              <Text style={styles.metric}>{aggregate.classification}</Text>
              <Text style={styles.small}>
                {aggregate.type === "sound_dbfs"
                  ? `${Number(aggregate.value).toFixed(1)} dBFS · uncalibrated digital loudness`
                  : `${Number(aggregate.value).toFixed(2)} motion intensity · not occupancy`}
              </Text>
              <Text style={styles.meta}>
                {Math.round(aggregate.confidence * 100)}% confidence · updated {freshness(aggregate.lastUpdatedAt)}
              </Text>
            </View>
          ))}
          {!snapshot?.aggregates.length && !busy ? (
            <View style={styles.emptyCard}>
              <Text style={styles.cardTitle}>No supported insight yet</Text>
              <Text style={styles.small}>
                {mode === "community"
                  ? "Community data remains unavailable below three distinct contributors."
                  : "Tap Read this spot or open the clearly labeled example view."}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.stack}>
          {(snapshot?.patterns ?? []).map((pattern) => (
            <View key={`${pattern.type}-${pattern.dayOfWeek}-${pattern.hour}`} style={styles.card}>
              <Text style={styles.cardEyebrow}>
                {["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][pattern.dayOfWeek]} · {String(pattern.hour).padStart(2, "0")}:00 UTC
              </Text>
              <Text style={styles.metric}>
                {pattern.type === "sound_dbfs"
                  ? `${Number(pattern.baseline).toFixed(1)} dBFS usual`
                  : `${Number(pattern.baseline).toFixed(2)} motion intensity`}
              </Text>
              <Text style={styles.meta}>{pattern.sampleCount} historical samples · {Math.round(pattern.confidence * 100)}% confidence</Text>
            </View>
          ))}
          {!snapshot?.patterns.length ? (
            <View style={styles.emptyCard}>
              <Text style={styles.cardTitle}>Not enough history</Text>
              <Text style={styles.small}>At least three observations in the same time bucket are required.</Text>
            </View>
          ) : null}
        </View>
      )}

      {view === "nearby" ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your spot readings</Text>
          <Text style={styles.small}>
            Each tap takes one short foreground reading and stops automatically.
            If a permission is denied, the rest of Nearby Hello still works.
          </Text>
          <Pressable style={styles.darkButton} disabled={busy} onPress={() => void readThisSpot()}>
            <Text style={styles.primaryButtonText}>{busy ? "Reading…" : "Read this spot"}</Text>
          </Pressable>
          <Pressable style={styles.deleteButton} disabled={busy} onPress={confirmDeletion}>
            <Text style={styles.deleteButtonText}>Delete my readings</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 18, paddingTop: 60, paddingBottom: 34, gap: 18 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  titleCopy: { flex: 1 },
  eyebrow: { color: colors.teal, fontSize: 11, fontWeight: "800", letterSpacing: 1.8 },
  title: { color: colors.ink, fontSize: 29, fontWeight: "800", marginTop: 5 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 7 },
  badge: { overflow: "hidden", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, fontSize: 10, fontWeight: "800" },
  demoBadge: { backgroundColor: "#fef3c7", color: "#92400e" },
  personalBadge: { backgroundColor: colors.tealSoft, color: colors.teal },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  primaryButton: { backgroundColor: colors.teal, borderRadius: 12, paddingHorizontal: 15, paddingVertical: 11 },
  darkButton: { backgroundColor: colors.ink, borderRadius: 12, paddingHorizontal: 15, paddingVertical: 12, alignItems: "center", marginTop: 12 },
  primaryButtonText: { color: "white", fontSize: 13, fontWeight: "800" },
  secondaryButton: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11 },
  secondaryButtonText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  error: { color: colors.coral, backgroundColor: colors.coralSoft, borderRadius: 14, padding: 12, fontSize: 13 },
  notice: { color: colors.teal, backgroundColor: colors.tealSoft, borderRadius: 14, padding: 12, fontSize: 13 },
  permissionNote: { color: colors.teal, backgroundColor: colors.tealSoft, borderRadius: 14, padding: 12, fontSize: 13, lineHeight: 19 },
  mapCard: { overflow: "hidden", borderRadius: 26, backgroundColor: "#dcebe8", borderWidth: 1, borderColor: colors.border },
  mapHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "rgba(255,255,255,0.9)", padding: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 14 },
  zone: { width: "31.8%", aspectRatio: 1.25, alignItems: "center", justifyContent: "center", borderRadius: 15, borderWidth: 1, borderColor: "rgba(255,255,255,0.85)", backgroundColor: "rgba(255,255,255,0.35)" },
  currentZone: { backgroundColor: "rgba(13,148,136,0.2)", borderColor: colors.teal, borderWidth: 2 },
  you: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.teal, color: "white", textAlign: "center", textAlignVertical: "center", fontSize: 12, fontWeight: "800", overflow: "hidden" },
  zoneText: { color: "rgba(17,24,39,0.55)", fontSize: 10, fontWeight: "700" },
  mapFooter: { backgroundColor: "rgba(255,255,255,0.9)", color: colors.muted, fontSize: 11, padding: 12 },
  stack: { gap: 12 },
  card: { backgroundColor: colors.card, borderRadius: 24, padding: 18, borderWidth: 1, borderColor: colors.border },
  emptyCard: { backgroundColor: colors.card, borderRadius: 24, padding: 18, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(0,0,0,0.18)" },
  cardTitle: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  cardEyebrow: { color: colors.teal, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  metric: { color: colors.ink, fontSize: 23, fontWeight: "800", marginTop: 8 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  meta: { color: colors.muted, fontSize: 11, marginTop: 12 },
  deleteButton: { alignItems: "center", paddingVertical: 12, marginTop: 5 },
  deleteButtonText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
});
