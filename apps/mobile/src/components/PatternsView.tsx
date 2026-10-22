import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { SpatialSnapshot } from "@nearby/shared";
import { trustFromProvenance } from "@nearby/shared";
import { TrustBadge } from "@/components/TrustBadge";
import { useAuth } from "@/lib/auth-context";
import { getSpatialSnapshot } from "@/lib/spatial-api";
import { useSpatialLocation } from "@/lib/use-spatial-location";
import { colors } from "@/lib/theme";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function PatternsView() {
  const { user } = useAuth();
  const spatial = useSpatialLocation();
  const [snapshot, setSnapshot] = useState<SpatialSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !spatial.ready) return;
    try {
      const token = await user.getIdToken();
      const mode = spatial.usingDevice ? "personal" : "demo";
      setSnapshot(await getSpatialSnapshot(token, spatial.location, mode));
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not load patterns.",
      );
    }
  }, [spatial.location, spatial.ready, spatial.usingDevice, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const patterns = snapshot?.patterns ?? [];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Patterns</Text>
        <Text style={styles.lead}>
          What this area is usually like by time of day—only when enough
          readings exist.
        </Text>
        <TrustBadge
          label={spatial.usingDevice ? "historical" : "example"}
          showHint
        />
      </View>

      <View style={styles.list}>
        {patterns.length ? (
          patterns.map((pattern) => (
            <View
              key={`${pattern.type}-${pattern.dayOfWeek}-${pattern.hour}`}
              style={styles.row}
            >
              <Text style={styles.meta}>
                {WEEKDAYS[pattern.dayOfWeek]}{" "}
                {String(pattern.hour).padStart(2, "0")}:00
              </Text>
              <Text style={styles.value}>
                {pattern.type === "sound_dbfs"
                  ? "Usual quiet/loud"
                  : "Usual movement"}{" "}
                · {Number(pattern.baseline).toFixed(0)}
              </Text>
              <Text style={styles.meta}>
                From {pattern.sampleCount} readings ·{" "}
                {Math.round(pattern.confidence * 100)}% confidence
              </Text>
              <TrustBadge label={trustFromProvenance("historical")} />
            </View>
          ))
        ) : (
          <Text style={styles.meta}>
            {message ??
              "Not enough history yet. Contributions over different hours unlock this view."}
          </Text>
        )}
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
    gap: 24,
  },
  header: { gap: 8 },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: -0.4,
  },
  lead: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  list: { gap: 20 },
  row: {
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(17,24,39,0.1)",
    paddingTop: 16,
  },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  value: { color: colors.ink, fontSize: 20, fontWeight: "600" },
});
