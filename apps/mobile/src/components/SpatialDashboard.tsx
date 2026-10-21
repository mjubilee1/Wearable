import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
  SensorSession,
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
  const [session, setSession] = useState<SensorSession | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [motionEnabled, setMotionEnabled] = useState(false);
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

  async function useLocation() {
    setBusy(true);
    setError(null);
    try {
      const reading = await mobileLocationProvider.readCurrent();
      if (!reading) throw new Error("Foreground location permission is required.");
      setLocation(reading.value);
      setUsingDeviceLocation(true);
      await load("personal", reading.value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Location failed.");
    } finally {
      setBusy(false);
    }
  }

  async function begin() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const reading = await mobileLocationProvider.readCurrent();
      if (!reading) throw new Error("Foreground location permission is required.");
      const token = await user.getIdToken();
      const next = await startSensorSession(token, {
        consent: {
          location: true,
          sound: soundEnabled,
          motion: motionEnabled,
        },
        enabledSensors: [
          "location",
          ...(soundEnabled ? (["sound"] as const) : []),
          ...(motionEnabled ? (["motion"] as const) : []),
        ],
      });
      setLocation(reading.value);
      setUsingDeviceLocation(true);
      setMode("personal");
      setSession(next);
      setNotice("Foreground sensing is active.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start sensing.");
    } finally {
      setBusy(false);
    }
  }

  async function relativeSound() {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) throw new Error("Microphone permission was not granted.");
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record({ forDuration: 2 });
    const readings: number[] = [];
    try {
      for (let index = 0; index < 8; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 125));
        const metering = recorder.getStatus().metering;
        if (typeof metering === "number") {
          readings.push(Math.min(1, Math.max(0, (metering + 80) / 80)));
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

  async function measure() {
    if (!user || !session) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const reading = await mobileLocationProvider.readCurrent();
      if (!reading) throw new Error("A current location fix is required.");
      const token = await user.getIdToken();
      let count = 0;
      if (soundEnabled) {
        const value = await relativeSound();
        await submitObservation(token, {
          sessionId: session.id,
          location: reading.value,
          type: "sound_relative",
          value,
          observedAt: Date.now(),
          source: "mobile",
          quality: { qualityScore: 0.75, calibrated: false },
        });
        count += 1;
      }
      if (motionEnabled) {
        const motion = await mobileMotionProvider.readMovementState();
        if (!motion) throw new Error("Motion permission or readings are unavailable.");
        await submitObservation(token, {
          sessionId: session.id,
          location: reading.value,
          type: "motion_state",
          value: motion.value,
          observedAt: motion.measuredAt,
          source: "mobile",
          quality: { qualityScore: motion.qualityScore, calibrated: false },
        });
        count += 1;
      }
      setNotice(
        `${count} personal measurement${count === 1 ? "" : "s"} saved. Raw audio was deleted locally.`,
      );
      await load("personal", reading.value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Measurement failed.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!user || !session) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      await stopSensorSession(token, session.id);
      setSession(null);
      setNotice("Sensing stopped.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not stop sensing.");
    } finally {
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
          {mode === "demo" ? "DEMO" : mode.toUpperCase()}
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.primaryButton} disabled={busy} onPress={() => void useLocation()}>
          <Text style={styles.primaryButtonText}>
            {usingDeviceLocation ? "Refresh location" : "Use my location"}
          </Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => void load("demo", usingDeviceLocation ? location : PILOT_LOCATION)}>
          <Text style={styles.secondaryButtonText}>Labeled demo</Text>
        </Pressable>
        <Pressable style={[styles.secondaryButton, !usingDeviceLocation && styles.disabled]} disabled={busy || !usingDeviceLocation} onPress={() => void load("community", location)}>
          <Text style={styles.secondaryButtonText}>Community</Text>
        </Pressable>
      </View>

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
        <View style={styles.stack}>
          {(snapshot?.aggregates ?? []).map((aggregate) => (
            <View key={aggregate.type} style={styles.card}>
              <Text style={styles.cardEyebrow}>
                {aggregate.type === "sound_relative"
                  ? "RELATIVE SOUND"
                  : "PARTICIPATING-DEVICE ACTIVITY"}
              </Text>
              <Text style={styles.metric}>{aggregate.classification}</Text>
              <Text style={styles.small}>
                {aggregate.type === "sound_relative"
                  ? `${Math.round(Number(aggregate.value) * 100)} / 100 · not calibrated decibels`
                  : `${String(aggregate.value)} · not occupancy`}
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
                  : "Start a personal session or open the labeled demonstration."}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.stack}>
          {(snapshot?.patterns ?? []).map((pattern) => (
            <View key={`${pattern.type}-${pattern.dayType}-${pattern.hour}`} style={styles.card}>
              <Text style={styles.cardEyebrow}>
                {pattern.dayType.toUpperCase()} · {String(pattern.hour).padStart(2, "0")}:00 UTC
              </Text>
              <Text style={styles.metric}>
                {pattern.type === "sound_relative"
                  ? `${Math.round(Number(pattern.baseline) * 100)} / 100 relative sound`
                  : String(pattern.baseline)}
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
          <View style={styles.collectionHeader}>
            <View style={styles.titleCopy}>
              <Text style={styles.cardTitle}>Personal collection</Text>
              <Text style={styles.small}>Foreground only, with separate sensor permissions.</Text>
            </View>
            <Text style={[styles.badge, session ? styles.personalBadge : styles.stoppedBadge]}>
              {session ? "ACTIVE" : "STOPPED"}
            </Text>
          </View>
          <View style={styles.toggle}>
            <View style={styles.titleCopy}>
              <Text style={styles.toggleTitle}>Relative sound</Text>
              <Text style={styles.small}>Raw audio is discarded locally.</Text>
            </View>
            <Switch value={soundEnabled} disabled={Boolean(session)} onValueChange={setSoundEnabled} trackColor={{ true: colors.tealSoft }} thumbColor={soundEnabled ? colors.teal : colors.muted} />
          </View>
          <View style={styles.toggle}>
            <View style={styles.titleCopy}>
              <Text style={styles.toggleTitle}>Device movement</Text>
              <Text style={styles.small}>Broad state only.</Text>
            </View>
            <Switch value={motionEnabled} disabled={Boolean(session)} onValueChange={setMotionEnabled} trackColor={{ true: colors.tealSoft }} thumbColor={motionEnabled ? colors.teal : colors.muted} />
          </View>
          {!session ? (
            <Pressable style={[styles.darkButton, (!soundEnabled && !motionEnabled) && styles.disabled]} disabled={busy || (!soundEnabled && !motionEnabled)} onPress={() => void begin()}>
              <Text style={styles.primaryButtonText}>Start foreground session</Text>
            </Pressable>
          ) : (
            <View style={styles.actions}>
              <Pressable style={styles.primaryButton} disabled={busy} onPress={() => void measure()}>
                <Text style={styles.primaryButtonText}>Measure now</Text>
              </Pressable>
              <Pressable style={styles.stopButton} disabled={busy} onPress={() => void stop()}>
                <Text style={styles.stopButtonText}>Stop sensing</Text>
              </Pressable>
            </View>
          )}
          <Pressable style={styles.deleteButton} disabled={busy || Boolean(session)} onPress={confirmDeletion}>
            <Text style={styles.deleteButtonText}>Delete my observations</Text>
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
  stoppedBadge: { backgroundColor: colors.surface, color: colors.muted },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  primaryButton: { backgroundColor: colors.teal, borderRadius: 12, paddingHorizontal: 15, paddingVertical: 11 },
  darkButton: { backgroundColor: colors.ink, borderRadius: 12, paddingHorizontal: 15, paddingVertical: 12, alignItems: "center", marginTop: 12 },
  primaryButtonText: { color: "white", fontSize: 13, fontWeight: "800" },
  secondaryButton: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11 },
  secondaryButtonText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  error: { color: colors.coral, backgroundColor: colors.coralSoft, borderRadius: 14, padding: 12, fontSize: 13 },
  notice: { color: colors.teal, backgroundColor: colors.tealSoft, borderRadius: 14, padding: 12, fontSize: 13 },
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
  collectionHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: 16, padding: 13, marginTop: 10 },
  toggleTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  stopButton: { backgroundColor: colors.coralSoft, borderRadius: 12, paddingHorizontal: 15, paddingVertical: 11 },
  stopButtonText: { color: colors.coral, fontSize: 13, fontWeight: "800" },
  deleteButton: { alignItems: "center", paddingVertical: 12, marginTop: 5 },
  deleteButtonText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
});
