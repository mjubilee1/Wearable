import { Pressable, Text, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "@/lib/theme";

type DeviceStripProps = {
  score: number;
  /** Linked wearable short id, e.g. A1B2 */
  deviceId?: string | null;
  /** Same green / close decision as the website BLE reports. */
  ble?: "green" | "close" | null;
};

function lightFromScore(score: number): { label: string; color: string } {
  if (score < 35) return { label: "Cool red", color: "#ef4444" };
  if (score < 65) return { label: "Warm amber", color: "#f59e0b" };
  return { label: "Bright green", color: "#22c55e" };
}

function lightFromBle(ble: "green" | "close"): { label: string; color: string } {
  if (ble === "green") return { label: "Bright green", color: "#22c55e" };
  return { label: "Warm amber", color: "#f59e0b" };
}

export function DeviceStrip({ score, deviceId, ble = null }: DeviceStripProps) {
  const router = useRouter();
  const linked = Boolean(deviceId);
  const light = ble ? lightFromBle(ble) : lightFromScore(score);

  return (
    <Pressable
      onPress={() => router.push("/link-ring?from=profile")}
      style={styles.wrap}
    >
      <View
        style={[
          styles.dot,
          { backgroundColor: linked ? light.color : colors.muted },
        ]}
      />
      <View style={styles.copy}>
        <Text style={styles.title}>
          {linked
            ? `Wearable · NB-${deviceId}`
            : "Wearable · Not linked"}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {linked
            ? `Score light: ${light.label}`
            : "Tap to find and link your ring"}
        </Text>
      </View>
      <View style={[styles.badge, !linked && styles.badgeMuted]}>
        <Text style={[styles.badgeText, !linked && styles.badgeTextMuted]}>
          {linked ? "Linked" : "Setup"}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dot: { height: 12, width: 12, borderRadius: 999 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 12, fontWeight: "600", color: colors.ink },
  sub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  badge: {
    borderRadius: 999,
    backgroundColor: colors.tealSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeMuted: {
    backgroundColor: colors.surface,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.teal,
  },
  badgeTextMuted: {
    color: colors.muted,
  },
});
