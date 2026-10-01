import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FacilitateResponse } from "@nearby/shared";
import { DeviceStrip } from "@/components/DeviceStrip";
import { HelloComposer } from "@/components/HelloComposer";
import { ProfileCard } from "@/components/ProfileCard";
import { useAuth } from "@/lib/auth-context";
import {
  blockedUserIds,
  connectionStatusMap,
  sendConnectionRequest,
} from "@/lib/connections";
import { listNearbyMatches } from "@/lib/users";
import { colors } from "@/lib/theme";

const DEMO_STAGES = [15, 55, 85] as const;
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

export default function NearbyScreen() {
  const { profile, user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [demoOn, setDemoOn] = useState(false);
  const [demoScore, setDemoScore] = useState(78);
  const [facilitate, setFacilitate] = useState<FacilitateResponse | null>(
    null,
  );
  const [facilitateLoading, setFacilitateLoading] = useState(false);
  const [facilitateError, setFacilitateError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const stageRef = useRef(0);

  const matchesQuery = useQuery({
    queryKey: ["nearby-matches", profile?.id],
    enabled: Boolean(profile),
    queryFn: async () => {
      if (!profile) return [];
      const blocked = await blockedUserIds(profile.id);
      return listNearbyMatches(profile, { excludeIds: blocked });
    },
  });

  const matches = useMemo(
    () => matchesQuery.data ?? [],
    [matchesQuery.data],
  );
  const matchIds = useMemo(() => matches.map((m) => m.id), [matches]);

  const statusQuery = useQuery({
    queryKey: ["connection-status", profile?.id, matchIds.join(",")],
    enabled: Boolean(profile) && matchIds.length > 0,
    queryFn: async () => {
      if (!profile) return new Map();
      return connectionStatusMap(profile.id, matchIds);
    },
  });

  const firstId = matches[0]?.id ?? null;
  const activeId =
    selectedId && matches.some((m) => m.id === selectedId)
      ? selectedId
      : firstId;
  const selected = matches.find((m) => m.id === activeId) ?? matches[0];
  const statusFor = (id: string) => statusQuery.data?.get(id) ?? "none";

  useEffect(() => {
    setFacilitate(null);
    setFacilitateError(null);
    setComposerOpen(false);
    setSendError(null);
  }, [activeId]);

  useEffect(() => {
    if (!selected) return;

    if (!demoOn) {
      setDemoScore(selected.score);
      stageRef.current = 0;
      return;
    }

    stageRef.current = 0;
    setDemoScore(DEMO_STAGES[0]);

    const id = setInterval(() => {
      stageRef.current = (stageRef.current + 1) % DEMO_STAGES.length;
      setDemoScore(DEMO_STAGES[stageRef.current]);
    }, 1800);

    return () => clearInterval(id);
  }, [demoOn, selected]);

  const displayScore =
    selected && activeId === firstId ? demoScore : (selected?.score ?? 0);

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!profile || !activeId) throw new Error("Not ready");
      return sendConnectionRequest({
        from: profile,
        toId: activeId,
        message,
      });
    },
    onSuccess: async () => {
      setComposerOpen(false);
      setSendError(null);
      await queryClient.invalidateQueries({ queryKey: ["connection-status"] });
      await queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (err) => {
      setSendError(err instanceof Error ? err.message : "Could not send hello");
    },
  });

  async function onFacilitate() {
    if (!activeId) return;
    setFacilitateLoading(true);
    setFacilitateError(null);
    try {
      const token = user ? await user.getIdToken() : "";
      if (!token) throw new Error("Sign in required");
      const res = await fetch(`${API_URL}/v1/facilitate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ otherId: activeId }),
      });
      if (!res.ok) {
        throw new Error(`Could not facilitate (${res.status})`);
      }
      const data = (await res.json()) as FacilitateResponse;
      setFacilitate(data);
    } catch (err) {
      setFacilitateError(
        err instanceof Error ? err.message : "Facilitator unavailable",
      );
    } finally {
      setFacilitateLoading(false);
    }
  }

  const draft =
    facilitate?.icebreakers[0] ??
    (selected
      ? `Hey ${selected.name} — we seem to overlap nearby. Want to connect?`
      : "");

  return (
    <View style={styles.screen}>
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Text style={styles.eyebrow}>Nearby</Text>
            <Text style={styles.title}>Nearby Matches</Text>
            <Text style={styles.subtitle}>
              People around you (~40–50 ft). Send a short hello — they review
              your profile and choose whether to connect.
            </Text>

            <View style={styles.demoRow}>
              <View style={styles.demoCopy}>
                <Text style={styles.demoTitle}>Walk-by demo</Text>
                <Text style={styles.demoSub}>
                  Animate score 15% → 55% → 85%
                </Text>
              </View>
              <Pressable
                onPress={() => setDemoOn((v) => !v)}
                style={[styles.switch, demoOn && styles.switchOn]}
              >
                <View
                  style={[styles.knob, demoOn && styles.knobOn]}
                />
              </Pressable>
            </View>

            <DeviceStrip
              score={displayScore}
              deviceId={profile?.deviceId ?? null}
            />

            {facilitate || facilitateError ? (
              <View style={styles.facilitator}>
                <Text style={styles.facilitatorLabel}>
                  Facilitator
                  {facilitate ? ` · ${facilitate.mode}` : ""}
                </Text>
                {facilitateError ? (
                  <Text style={styles.errorText}>{facilitateError}</Text>
                ) : null}
                {facilitate ? (
                  <>
                    <Text style={styles.facilitatorWhy}>
                      {facilitate.whyYouVibe}
                    </Text>
                    {facilitate.icebreakers.map((line) => (
                      <View key={line} style={styles.icebreaker}>
                        <Text style={styles.icebreakerText}>{line}</Text>
                      </View>
                    ))}
                    {selected && statusFor(selected.id) === "none" ? (
                      <Pressable
                        onPress={() => {
                          setSendError(null);
                          setComposerOpen(true);
                        }}
                        style={styles.useBtn}
                      >
                        <Text style={styles.useBtnText}>
                          Use this · send hello
                        </Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : null}
              </View>
            ) : null}

            {matchesQuery.isLoading ? (
              <View style={styles.stateBox}>
                <ActivityIndicator color={colors.teal} />
                <Text style={styles.stateText}>Scanning nearby…</Text>
              </View>
            ) : null}

            {matchesQuery.isError ? (
              <View style={[styles.stateBox, styles.errorBox]}>
                <Text style={styles.errorText}>
                  Could not load matches. Check Firestore rules and try again.
                </Text>
              </View>
            ) : null}

            {!matchesQuery.isLoading && matches.length === 0 ? (
              <View style={styles.stateBox}>
                <Text style={styles.stateText}>
                  No one nearby yet. Invite a friend to sign up.
                </Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <ProfileCard
              profile={item}
              selected={item.id === activeId}
              connectionStatus={statusFor(item.id)}
              displayScore={
                item.id === activeId && item.id === firstId
                  ? demoScore
                  : undefined
              }
              onSelect={() => setSelectedId(item.id)}
              onFacilitate={item.id === activeId ? onFacilitate : undefined}
              onSayHello={
                item.id === activeId
                  ? () => {
                      setSendError(null);
                      setComposerOpen(true);
                    }
                  : undefined
              }
              facilitateLoading={
                item.id === activeId ? facilitateLoading : false
              }
            />
          </View>
        )}
      />

      {composerOpen && selected ? (
        <HelloComposer
          name={selected.name}
          initialMessage={draft}
          sending={sendMutation.isPending}
          error={sendError}
          onCancel={() => setComposerOpen(false)}
          onSend={(message) => sendMutation.mutate(message)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 32 },
  headerBlock: { gap: 16, marginBottom: 8 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.teal,
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.ink },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.muted },
  demoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(13,148,136,0.3)",
    backgroundColor: "rgba(204,251,241,0.4)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  demoCopy: { flex: 1 },
  demoTitle: { fontSize: 12, fontWeight: "600", color: colors.ink },
  demoSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  switch: {
    width: 56,
    height: 32,
    borderRadius: 999,
    backgroundColor: "#d1d5db",
    padding: 4,
  },
  switchOn: { backgroundColor: colors.teal },
  knob: {
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  knobOn: { alignSelf: "flex-end" },
  facilitator: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(13,148,136,0.2)",
    backgroundColor: "rgba(255,255,255,0.8)",
    padding: 20,
    gap: 8,
  },
  facilitatorLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.teal,
  },
  facilitatorWhy: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  icebreaker: {
    borderRadius: 16,
    backgroundColor: "rgba(204,251,241,0.5)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  icebreakerText: { fontSize: 14, color: colors.ink },
  useBtn: {
    marginTop: 8,
    alignSelf: "flex-start",
    borderRadius: 16,
    backgroundColor: colors.teal,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  useBtnText: { fontSize: 12, fontWeight: "600", color: "#fff" },
  stateBox: {
    borderRadius: 24,
    backgroundColor: colors.card,
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  stateText: { fontSize: 14, color: colors.muted, textAlign: "center" },
  errorBox: { backgroundColor: colors.coralSoft },
  errorText: { fontSize: 14, color: colors.coral },
  cardWrap: { marginBottom: 12 },
});
