import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  intentForPlaceCategory,
  intentTitle,
  trustFromVerification,
  type SpatialInsight,
  type SpatialPlace,
} from "@nearby/shared";
import { TrustBadge } from "@/components/TrustBadge";
import { useAuth } from "@/lib/auth-context";
import { getPlaceDetail } from "@/lib/spatial-api";
import { colors } from "@/lib/theme";

function groupInsights(insights: SpatialInsight[]) {
  const verified = insights.filter(
    (insight) => insight.verificationStatus === "verified",
  );
  const estimated = insights.filter((insight) =>
    ["recent", "low_confidence", "conflicting", "insufficient_evidence"].includes(
      insight.verificationStatus,
    ),
  );
  const historical = insights.filter(
    (insight) => insight.verificationStatus === "stale",
  );
  return { verified, estimated, historical };
}

export function PlaceIntelligence({ placeId }: { placeId: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const [place, setPlace] = useState<SpatialPlace | null>(null);
  const [insights, setInsights] = useState<SpatialInsight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const detail = await getPlaceDetail(token, placeId);
        if (cancelled) return;
        setPlace(detail.place);
        setInsights(detail.insights);
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "Place not found.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [placeId, user]);

  const groups = useMemo(() => groupInsights(insights), [insights]);
  const intent = place ? intentForPlaceCategory(place.category) : "explore";

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.crumbs}>
        <Pressable onPress={() => router.push("/(tabs)/nearby")}>
          <Text style={styles.crumb}>Discover</Text>
        </Pressable>
        <Text style={styles.crumbSep}> / </Text>
        <Pressable onPress={() => router.push("/(tabs)/explore")}>
          <Text style={styles.crumb}>Explore</Text>
        </Pressable>
      </View>

      {loading ? <Text style={styles.meta}>Loading place…</Text> : null}
      {error ? <Text style={styles.meta}>{error}</Text> : null}

      {place ? (
        <View style={styles.header}>
          <Text style={styles.intent}>{intentTitle(intent)}</Text>
          <Text style={styles.title}>{place.name}</Text>
          <Text style={styles.meta}>
            {place.category.replaceAll("_", " ")}
            {place.address ? ` · ${place.address}` : ""}
          </Text>
          <Text style={styles.note}>
            Place identity from OpenStreetMap. Live crowd or seating claims only
            appear when observations support them.
          </Text>
        </View>
      ) : null}

      {place ? (
        <View style={styles.main}>
          <InsightBlock
            title="Verified"
            empty="No verified observations yet."
            items={groups.verified}
          />
          <InsightBlock
            title="Estimated"
            empty="Nothing estimated for this place right now."
            items={groups.estimated}
          />
          <InsightBlock
            title="Historical"
            empty="No historical observations yet."
            items={groups.historical}
          />

          {!insights.length ? (
            <View style={styles.emptyBlock}>
              <TrustBadge label="unavailable" showHint />
              <Text style={styles.meta}>
                Open Explore to contribute a photo observation, or check the
                spot when you are there.
              </Text>
              <Pressable onPress={() => router.push("/(tabs)/explore")}>
                <Text style={styles.openLink}>Go to Explore</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function InsightBlock({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: SpatialInsight[];
}) {
  return (
    <View style={styles.block}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {items.length ? (
        items.map((insight) => (
          <View key={insight.id} style={styles.insight}>
            <Text style={styles.body}>{insight.text}</Text>
            <View style={styles.row}>
              <TrustBadge
                label={trustFromVerification(insight.verificationStatus)}
              />
              <Text style={styles.note}>
                {insight.sourceLabel} ·{" "}
                {new Date(insight.observedAt).toLocaleString()}
              </Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.meta}>{empty}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 40,
    gap: 20,
  },
  crumbs: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  crumb: { color: colors.muted, fontSize: 14 },
  crumbSep: { color: colors.muted, fontSize: 14 },
  header: { gap: 8, marginBottom: 8 },
  intent: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: -0.4,
  },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  main: { gap: 24 },
  block: {
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(17,24,39,0.1)",
    paddingTop: 20,
  },
  sectionLabel: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  insight: { gap: 8 },
  body: { color: colors.ink, fontSize: 16, lineHeight: 22 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  emptyBlock: {
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(17,24,39,0.1)",
    paddingTop: 20,
  },
  openLink: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
