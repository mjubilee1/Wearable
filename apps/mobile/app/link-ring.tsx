import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { normalizeDeviceId } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import {
  getBleAvailability,
  isBleNativeAvailable,
  startNearbyClipScan,
  type NearbyClipSighting,
} from "@/lib/ble";
import { useOnboarding } from "@/lib/onboarding-context";
import { updateUserProfile } from "@/lib/users";
import { colors } from "@/lib/theme";

export default function LinkRingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const fromProfile = params.from === "profile";
  const { profile, refreshProfile } = useAuth();
  const { markLinkRingSkipped, clearLinkRingSkip } = useOnboarding();

  const [availabilityMessage, setAvailabilityMessage] = useState<string | null>(
    null,
  );
  const [scanning, setScanning] = useState(false);
  const [sightings, setSightings] = useState<NearbyClipSighting[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [manualId, setManualId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bleNative = isBleNativeAvailable();

  const stopScan = useCallback((handle: { stop: () => void } | null) => {
    handle?.stop();
  }, []);

  useEffect(() => {
    if (profile?.deviceId) {
      setManualId(profile.deviceId);
      setSelectedId(profile.deviceId);
    }
  }, [profile?.deviceId]);

  useEffect(() => {
    let cancelled = false;
    let handle: { stop: () => void } | null = null;

    async function begin() {
      const availability = await getBleAvailability();
      if (cancelled) return;

      if (availability.status !== "ready") {
        setAvailabilityMessage(availability.reason);
        setScanning(false);
        return;
      }

      setAvailabilityMessage(null);
      setScanning(true);
      setScanError(null);

      handle = startNearbyClipScan(
        (next) => {
          if (cancelled) return;
          setSightings(next);
          setSelectedId((current) => {
            if (current && next.some((item) => item.clipId === current)) {
              return current;
            }
            if (next.length === 1) return next[0].clipId;
            return current;
          });
        },
        (message) => {
          if (cancelled) return;
          setScanError(message);
        },
      );

      if (cancelled) {
        handle.stop();
        handle = null;
      }
    }

    void begin();

    return () => {
      cancelled = true;
      stopScan(handle);
      setScanning(false);
    };
  }, [stopScan]);

  const chosenId = useMemo(() => {
    if (selectedId) return selectedId;
    const normalized = normalizeDeviceId(manualId);
    return normalized;
  }, [selectedId, manualId]);

  async function linkDevice(deviceId: string) {
    if (!profile) {
      setError("You need to be signed in to link a ring.");
      return;
    }

    const normalized = normalizeDeviceId(deviceId);
    if (!normalized) {
      setError("Use a 4-character ID like A1B2 (from NB-A1B2 on the ring).");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateUserProfile(profile.id, { deviceId: normalized });
      await clearLinkRingSkip();
      await refreshProfile();
      router.replace(fromProfile ? "/(tabs)/profile" : "/(tabs)");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save ring link");
    } finally {
      setSaving(false);
    }
  }

  async function skipForNow() {
    await markLinkRingSkipped();
    router.replace("/(tabs)");
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.eyebrow}>Setup</Text>
      <Text style={styles.title}>Link your Nearby ring</Text>
      <Text style={styles.subtitle}>
        Turn the ring on and keep it close. We’ll find its ID over Bluetooth and
        save it to your profile — no typing required when scan works.
      </Text>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Nearby rings</Text>
          {scanning ? (
            <View style={styles.scanningRow}>
              <ActivityIndicator color={colors.teal} size="small" />
              <Text style={styles.scanningText}>Scanning…</Text>
            </View>
          ) : (
            <Text style={styles.scanningText}>Scan idle</Text>
          )}
        </View>

        {availabilityMessage ? (
          <Text style={styles.hint}>{availabilityMessage}</Text>
        ) : null}
        {scanError ? <Text style={styles.errorText}>{scanError}</Text> : null}

        {!bleNative ? (
          <Text style={styles.hint}>
            Auto-scan needs a development build (`npx expo run:ios` /
            `run:android`). Expo Go can’t access Nearby BLE yet — use manual ID
            below for now.
          </Text>
        ) : null}

        {sightings.length === 0 && bleNative && !availabilityMessage ? (
          <Text style={styles.hint}>
            Waiting for manufacturer ads (FF FF N B + 4-byte id)… Power the clip
            on and hold it near your phone.
          </Text>
        ) : null}

        {sightings.map((item) => {
          const selected = selectedId === item.clipId;
          return (
            <Pressable
              key={item.clipId}
              onPress={() => {
                setSelectedId(item.clipId);
                setManualId(item.clipId);
              }}
              style={[styles.deviceRow, selected && styles.deviceRowSelected]}
            >
              <View style={styles.deviceCopy}>
                <Text style={styles.deviceId}>{item.clipId}</Text>
                <Text style={styles.deviceMeta}>
                  {Math.round(item.smoothedRssi)} dBm smoothed
                </Text>
              </View>
              <Text style={styles.selectLabel}>
                {selected ? "Selected" : "Select"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Or enter ID manually</Text>
        <Text style={styles.hint}>
          Prefer the 8-char manufacturer id (id0..id3). Short NB-XXXX (last 4
          hex) still works for legacy links.
        </Text>
        <TextInput
          value={manualId}
          onChangeText={(value) => {
            setManualId(value.toUpperCase());
            setSelectedId(null);
          }}
          maxLength={8}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="AABBCCDD"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => {
          if (!chosenId) {
            setError("Select a scanned ring or enter a valid ID first.");
            return;
          }
          void linkDevice(chosenId);
        }}
        disabled={saving}
        style={[styles.primaryBtn, saving && styles.disabled]}
      >
        <Text style={styles.primaryBtnText}>
          {saving ? "Linking…" : "Link this ring"}
        </Text>
      </Pressable>

      {fromProfile ? (
        <Pressable
          onPress={() => router.replace("/(tabs)/profile")}
          style={styles.secondaryBtn}
        >
          <Text style={styles.secondaryBtnText}>Back to profile</Text>
        </Pressable>
      ) : (
        <Pressable onPress={() => void skipForNow()} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>I’ll do this later</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: {
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 40,
    gap: 14,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.teal,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.ink,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    marginBottom: 4,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.ink,
  },
  scanningRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  scanningText: { fontSize: 12, color: colors.muted },
  hint: { fontSize: 12, lineHeight: 18, color: colors.muted },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  deviceRowSelected: {
    borderColor: colors.teal,
    backgroundColor: colors.tealSoft,
  },
  deviceCopy: { flex: 1, minWidth: 0 },
  deviceId: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  deviceMeta: { fontSize: 11, color: colors.muted, marginTop: 2 },
  selectLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.teal,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 2,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  primaryBtn: {
    marginTop: 4,
    borderRadius: 16,
    backgroundColor: colors.teal,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryBtn: {
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryBtnText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
  },
  errorBox: {
    borderRadius: 12,
    backgroundColor: colors.coralSoft,
    padding: 12,
  },
  errorText: { fontSize: 13, color: colors.coral },
  disabled: { opacity: 0.6 },
});
