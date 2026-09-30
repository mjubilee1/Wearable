import { Text, View, StyleSheet } from "react-native";
import { colors } from "@/lib/theme";

type CompatibilityScoreProps = {
  score: number;
  caption: string;
};

function scoreColor(score: number): string {
  if (score < 35) return "#ef4444";
  if (score < 65) return "#f97316";
  return "#22c55e";
}

function scoreLabel(score: number): string {
  if (score < 35) return "Warming up";
  if (score < 65) return "Getting closer";
  return "Strong match";
}

export function CompatibilityScore({
  score,
  caption,
}: CompatibilityScoreProps) {
  const color = scoreColor(score);
  const clamped = Math.max(0, Math.min(100, score));

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View>
          <Text style={styles.label}>Compatibility</Text>
          <Text style={[styles.status, { color }]}>{scoreLabel(clamped)}</Text>
        </View>
        <Text style={styles.score}>
          {Math.round(clamped)}
          <Text style={styles.pct}>%</Text>
        </Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${clamped}%`,
              backgroundColor: color,
            },
          ]}
        />
      </View>
      <Text style={styles.caption}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16, gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.muted,
  },
  status: { marginTop: 2, fontSize: 14, fontWeight: "500" },
  score: {
    fontSize: 30,
    fontWeight: "700",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  pct: { fontSize: 16, fontWeight: "600", color: colors.muted },
  track: {
    height: 14,
    borderRadius: 999,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 999 },
  caption: { fontSize: 14, lineHeight: 20, color: colors.muted },
});
