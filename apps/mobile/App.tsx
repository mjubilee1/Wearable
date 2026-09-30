import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  SEED_PROFILES,
  compatibilityScore,
  vibeCaption,
  type MatchProfile,
} from "@nearby/shared";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

async function loadMatches(): Promise<MatchProfile[]> {
  try {
    const res = await fetch(`${API_URL}/v1/matches`, {
      headers: { Authorization: "Bearer dev" },
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = (await res.json()) as { matches: MatchProfile[] };
    return data.matches;
  } catch {
    const now = Date.now();
    const self = {
      id: "dev-user",
      email: "dev@nearby.local",
      name: "You",
      age: 28,
      role: "Explorer",
      interests: ["Coffee walks", "Indie film"],
      avatarHue: 180,
      initials: "Y",
      createdAt: now,
      updatedAt: now,
    };
    return SEED_PROFILES.map((profile) => {
      const other = { ...profile, createdAt: now, updatedAt: now };
      const score = compatibilityScore(self, other);
      return { ...other, score, vibeCaption: vibeCaption(other.name, score) };
    }).sort((a, b) => b.score - a.score);
  }
}

function scoreColor(score: number): string {
  if (score >= 75) return "#0d9488";
  if (score >= 55) return "#f59e0b";
  return "#f97066";
}

export default function App() {
  const [matches, setMatches] = useState<MatchProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await loadMatches();
        if (!cancelled) setMatches(next);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Nearby</Text>
        <Text style={styles.title}>Nearby Matches</Text>
        <Text style={styles.subtitle}>People around you (~40–50 ft)</Text>
      </View>

      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator color="#0d9488" />
          <Text style={styles.muted}>Scanning nearby…</Text>
        </View>
      )}

      {error && (
        <View style={styles.centered}>
          <Text style={styles.error}>{error}</Text>
        </View>
      )}

      {!loading && !error && (
        <FlatList
          data={matches}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: `hsl(${item.avatarHue} 55% 42%)` },
                ]}
              >
                <Text style={styles.avatarText}>{item.initials}</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.name}>
                  {item.name}
                  {item.age ? `, ${item.age}` : ""}
                </Text>
                <Text style={styles.role}>{item.role}</Text>
                <Text style={styles.caption}>{item.vibeCaption}</Text>
              </View>
              <Text style={[styles.score, { color: scoreColor(item.score) }]}>
                {item.score}%
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.muted}>No one nearby yet.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2.5,
    textTransform: "uppercase",
    color: "#0d9488",
  },
  title: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: "700",
    color: "#111827",
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: "#6b7280",
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.06)",
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  role: {
    marginTop: 2,
    fontSize: 12,
    color: "#6b7280",
  },
  caption: {
    marginTop: 4,
    fontSize: 12,
    color: "#374151",
  },
  score: {
    fontSize: 18,
    fontWeight: "800",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  muted: {
    color: "#6b7280",
    fontSize: 14,
  },
  error: {
    color: "#f97066",
    fontSize: 14,
  },
});
