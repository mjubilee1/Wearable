import { Text, View, StyleSheet } from "react-native";
import { colors } from "@/lib/theme";

type DeviceStripProps = {
  score: number;
};

function lightFromScore(score: number): { label: string; color: string } {
  if (score < 35) return { label: "Cool red", color: "#ef4444" };
  if (score < 65) return { label: "Warm amber", color: "#f59e0b" };
  return { label: "Bright green", color: "#22c55e" };
}

export function DeviceStrip({ score }: DeviceStripProps) {
  const light = lightFromScore(score);

  return (
    <View style={styles.wrap}>
      <View style={[styles.dot, { backgroundColor: light.color }]} />
      <View style={styles.copy}>
        <Text style={styles.title}>Wearable · BLE connected</Text>
        <Text style={styles.sub} numberOfLines={1}>
          Score light: {light.label}
        </Text>
      </View>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>Live</Text>
      </View>
    </View>
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
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.teal,
  },
});
