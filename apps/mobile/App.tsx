import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SEED_PROFILES,
  compatibilityScore,
  normalizeDeviceId,
  vibeCaption,
  walkByScore,
  type FacilitateResponse,
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
      vibes: ["Curious", "Chill"],
      lookingFor: "New friends",
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

type Tab = "nearby" | "scan" | "profile";

export default function App() {
  const [tab, setTab] = useState<Tab>("nearby");
  const [matches, setMatches] = useState<MatchProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [facilitate, setFacilitate] = useState<FacilitateResponse | null>(
    null,
  );
  const [deviceLookup, setDeviceLookup] = useState("A1B2");
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await loadMatches();
        if (!cancelled) {
          setMatches(next);
          setSelectedId(next[0]?.id ?? null);
        }
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

  const selected = matches.find((m) => m.id === selectedId) ?? matches[0];

  const onFacilitate = useCallback(async () => {
    if (!selected) return;
    setFacilitate(null);
    try {
      const res = await fetch(`${API_URL}/v1/facilitate`, {
        method: "POST",
        headers: {
          Authorization: "Bearer dev",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ otherId: selected.id }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      setFacilitate((await res.json()) as FacilitateResponse);
    } catch {
      setFacilitate(null);
    }
  }, [selected]);

  async function onLookupDevice() {
    const id = normalizeDeviceId(deviceLookup);
    if (!id) {
      setScanResult("Enter a 4-hex ID like A1B2 (from NB-A1B2 ads).");
      return;
    }
    setScanBusy(true);
    setScanResult(null);
    try {
      const res = await fetch(`${API_URL}/v1/devices/${id}?band=2`, {
        headers: { Authorization: "Bearer dev" },
      });
      if (!res.ok) {
        setScanResult(`No profile for ${id} (${res.status}).`);
        return;
      }
      const data = (await res.json()) as {
        score: number;
        vibeCaption: string;
        profile: MatchProfile;
      };
      setScanResult(
        `${data.profile.name} · ${data.score}% — ${data.vibeCaption}`,
      );
    } catch {
      // Offline demo: resolve against seeds
      const now = Date.now();
      const self = {
        id: "dev-user",
        email: "",
        name: "You",
        age: 28,
        role: "",
        interests: ["Coffee walks", "Indie film"],
        avatarHue: 180,
        initials: "Y",
        vibes: ["Curious"],
        lookingFor: "New friends",
        createdAt: now,
        updatedAt: now,
      };
      const other = SEED_PROFILES.find(
        (p) => normalizeDeviceId(String(p.deviceId ?? "")) === id,
      );
      if (!other) {
        setScanResult(`No seed device ${id}. Try A1B2, C3D4, E5F6, or 7890.`);
        return;
      }
      const full = { ...other, createdAt: now, updatedAt: now };
      const score = walkByScore(self, full, 2);
      setScanResult(
        `${other.name} · ${score}% (offline) — ${vibeCaption(other.name, score)}`,
      );
    } finally {
      setScanBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Nearby</Text>
        <Text style={styles.title}>
          {tab === "nearby"
            ? "Nearby Matches"
            : tab === "scan"
              ? "Walk-by scan"
              : "Your profile"}
        </Text>
        <Text style={styles.subtitle}>
          {tab === "nearby"
            ? "People around you (~40–50 ft)"
            : tab === "scan"
              ? "Stage 2 bridge: look up a ring ID (BLE wiring next)"
              : "Voluntary depth — photo & prompts live on web for now"}
        </Text>
      </View>

      {tab === "nearby" && (
        <>
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
              ListHeaderComponent={
                facilitate ? (
                  <View style={styles.facilitate}>
                    <Text style={styles.facilitateEyebrow}>
                      Facilitator · {facilitate.mode}
                    </Text>
                    <Text style={styles.facilitateBody}>
                      {facilitate.whyYouVibe}
                    </Text>
                    {facilitate.icebreakers.map((line) => (
                      <Text key={line} style={styles.ice}>
                        {line}
                      </Text>
                    ))}
                  </View>
                ) : null
              }
              renderItem={({ item }) => {
                const active = item.id === selected?.id;
                return (
                  <Pressable
                    onPress={() => {
                      setSelectedId(item.id);
                      setFacilitate(null);
                    }}
                    style={[styles.card, active && styles.cardActive]}
                  >
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
                      {item.bio ? (
                        <Text style={styles.bio} numberOfLines={2}>
                          {item.bio}
                        </Text>
                      ) : null}
                      <Text style={styles.caption}>{item.vibeCaption}</Text>
                      {active ? (
                        <Pressable
                          onPress={onFacilitate}
                          style={styles.helpBtn}
                        >
                          <Text style={styles.helpBtnText}>Help me say hi</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <Text
                      style={[styles.score, { color: scoreColor(item.score) }]}
                    >
                      {item.score}%
                    </Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.muted}>No one nearby yet.</Text>
              }
            />
          )}
        </>
      )}

      {tab === "scan" && (
        <View style={styles.panel}>
          <Text style={styles.panelCopy}>
            Firmware advertises NB-XXXX. Link that short ID on your profile,
            then look up walk-bys here. Native BLE scan lands next.
          </Text>
          <TextInput
            value={deviceLookup}
            onChangeText={(t) => setDeviceLookup(t.toUpperCase())}
            autoCapitalize="characters"
            maxLength={7}
            placeholder="A1B2"
            style={styles.input}
          />
          <Pressable
            onPress={onLookupDevice}
            style={styles.primaryBtn}
            disabled={scanBusy}
          >
            <Text style={styles.primaryBtnText}>
              {scanBusy ? "Looking up…" : "Lookup device score"}
            </Text>
          </Pressable>
          {scanResult ? (
            <Text style={styles.scanResult}>{scanResult}</Text>
          ) : null}
        </View>
      )}

      {tab === "profile" && (
        <View style={styles.panel}>
          <Text style={styles.panelCopy}>
            Rich profile editing (photo, bio, prompts, wearable ID) is on the
            web app for now. Open Profile there to deepen what walk-bys can see.
          </Text>
          <Text style={styles.muted}>
            Seed device IDs: A1B2 Maya · C3D4 Jordan · E5F6 Sam · 7890 Alex
          </Text>
        </View>
      )}

      <View style={styles.tabBar}>
        {(
          [
            ["nearby", "Nearby"],
            ["scan", "Scan"],
            ["profile", "Profile"],
          ] as const
        ).map(([id, label]) => (
          <Pressable
            key={id}
            onPress={() => setTab(id)}
            style={[styles.tab, tab === id && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8fafc" },
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
  list: { padding: 16, gap: 12, paddingBottom: 96 },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.06)",
  },
  cardActive: {
    borderColor: "rgba(13,148,136,0.35)",
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  cardBody: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: "700", color: "#111827" },
  role: { marginTop: 2, fontSize: 12, color: "#6b7280" },
  bio: { marginTop: 4, fontSize: 12, color: "#374151" },
  caption: { marginTop: 4, fontSize: 12, color: "#374151" },
  score: { fontSize: 18, fontWeight: "800" },
  helpBtn: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#ccfbf1",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  helpBtnText: { color: "#0d9488", fontWeight: "700", fontSize: 12 },
  facilitate: {
    marginBottom: 12,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(13,148,136,0.25)",
    gap: 8,
  },
  facilitateEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: "#0d9488",
  },
  facilitateBody: { fontSize: 14, color: "#111827", lineHeight: 20 },
  ice: {
    fontSize: 13,
    color: "#134e4a",
    backgroundColor: "#ccfbf1",
    padding: 10,
    borderRadius: 12,
    overflow: "hidden",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  muted: { color: "#6b7280", fontSize: 14 },
  error: { color: "#f97066", fontSize: 14 },
  panel: { flex: 1, padding: 20, gap: 14 },
  panelCopy: { fontSize: 14, color: "#374151", lineHeight: 20 },
  input: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.1)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Courier",
  },
  primaryBtn: {
    backgroundColor: "#0d9488",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "700" },
  scanResult: {
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 16,
    lineHeight: 20,
  },
  tabBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 6,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.06)",
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
  },
  tabActive: { backgroundColor: "#ccfbf1" },
  tabText: { fontSize: 12, fontWeight: "600", color: "#6b7280" },
  tabTextActive: { color: "#0d9488" },
});
