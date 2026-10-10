import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicProfileCard } from "@/components/PublicProfileCard";
import { useAuth } from "@/lib/auth-context";
import {
  acceptConnectionRequest,
  blockUser,
  cancelConnectionRequest,
  declineConnectionRequest,
  listConnections,
  listIncomingRequests,
  listOutgoingRequests,
  type RequestWithProfile,
} from "@/lib/connections";
import { colors } from "@/lib/theme";

type Tab = "incoming" | "sent" | "connected";

export default function ConnectionsScreen() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("incoming");
  const [actionError, setActionError] = useState<string | null>(null);

  const incomingQuery = useQuery({
    queryKey: ["connections", "incoming", profile?.id],
    enabled: Boolean(profile),
    queryFn: () => listIncomingRequests(profile!.id),
  });

  const sentQuery = useQuery({
    queryKey: ["connections", "sent", profile?.id],
    enabled: Boolean(profile),
    queryFn: () => listOutgoingRequests(profile!.id),
  });

  const connectedQuery = useQuery({
    queryKey: ["connections", "connected", profile?.id],
    enabled: Boolean(profile),
    queryFn: () => listConnections(profile!.id),
  });

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["connections"] }),
      queryClient.invalidateQueries({ queryKey: ["connection-status"] }),
      queryClient.invalidateQueries({ queryKey: ["nearby-matches"] }),
    ]);
  }

  const acceptMutation = useMutation({
    mutationFn: (requestId: string) =>
      acceptConnectionRequest(requestId, profile!.id),
    onSuccess: refreshAll,
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Could not accept"),
  });

  const declineMutation = useMutation({
    mutationFn: (requestId: string) =>
      declineConnectionRequest(requestId, profile!.id),
    onSuccess: refreshAll,
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Could not decline"),
  });

  const cancelMutation = useMutation({
    mutationFn: (requestId: string) =>
      cancelConnectionRequest(requestId, profile!.id),
    onSuccess: refreshAll,
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Could not cancel"),
  });

  const blockMutation = useMutation({
    mutationFn: (blockedId: string) => blockUser(profile!.id, blockedId),
    onSuccess: refreshAll,
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Could not block"),
  });

  const busy =
    acceptMutation.isPending ||
    declineMutation.isPending ||
    cancelMutation.isPending ||
    blockMutation.isPending;

  const tabs: { id: Tab; label: string; count: number }[] = [
    {
      id: "incoming",
      label: "Incoming",
      count: incomingQuery.data?.length ?? 0,
    },
    { id: "sent", label: "Sent", count: sentQuery.data?.length ?? 0 },
    {
      id: "connected",
      label: "Connected",
      count: connectedQuery.data?.length ?? 0,
    },
  ];

  const rows: RequestWithProfile[] =
    tab === "incoming"
      ? (incomingQuery.data ?? [])
      : tab === "sent"
        ? (sentQuery.data ?? [])
        : (connectedQuery.data ?? []);

  const loading =
    (tab === "incoming" && incomingQuery.isLoading) ||
    (tab === "sent" && sentQuery.isLoading) ||
    (tab === "connected" && connectedQuery.isLoading);

  const emptyCopy =
    tab === "incoming"
      ? "No hellos waiting. When someone nearby reaches out, you’ll review their profile here."
      : tab === "sent"
        ? "You haven’t sent a hello yet. Pick someone on Nearby and send a short intro."
        : "No connections yet. Accept a hello to start a mutual link.";

  return (
    <View style={styles.screen}>
      <FlatList
        data={rows}
        keyExtractor={({ request, other }) =>
          `${tab}-${request.id}-${other.id}`
        }
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Text style={styles.eyebrow}>Nearby</Text>
            <Text style={styles.title}>Connections</Text>
            <Text style={styles.subtitle}>
              Hellos you’ve received, sent, and people you’ve mutually linked
              with. Decline is quiet — they won’t be notified.
            </Text>

            <View style={styles.tabs}>
              {tabs.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    setTab(item.id);
                    setActionError(null);
                  }}
                  style={[styles.tab, tab === item.id && styles.tabActive]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      tab === item.id && styles.tabTextActive,
                    ]}
                  >
                    {item.label}
                    {item.count > 0 ? ` ${item.count}` : ""}
                  </Text>
                </Pressable>
              ))}
            </View>

            {actionError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{actionError}</Text>
              </View>
            ) : null}

            {loading ? (
              <View style={styles.stateBox}>
                <ActivityIndicator color={colors.teal} />
                <Text style={styles.stateText}>Loading…</Text>
              </View>
            ) : null}

            {!loading && rows.length === 0 ? (
              <View style={styles.stateBox}>
                <Text style={styles.stateText}>{emptyCopy}</Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item: { request, other } }) => (
          <View style={styles.cardWrap}>
            <PublicProfileCard
              profile={other}
              revealed={tab === "connected"}
              message={
                tab === "incoming" || tab === "sent"
                  ? request.message
                  : undefined
              }
              footer={
                tab === "incoming" ? (
                  <View style={styles.footerCol}>
                    <View style={styles.footerRow}>
                      <Pressable
                        disabled={busy}
                        onPress={() => {
                          setActionError(null);
                          declineMutation.mutate(request.id);
                        }}
                        style={[
                          styles.btn,
                          styles.btnGhost,
                          busy && styles.disabled,
                        ]}
                      >
                        <Text style={styles.btnGhostText}>Decline</Text>
                      </Pressable>
                      <Pressable
                        disabled={busy}
                        onPress={() => {
                          setActionError(null);
                          acceptMutation.mutate(request.id);
                        }}
                        style={[
                          styles.btn,
                          styles.btnPrimary,
                          busy && styles.disabled,
                        ]}
                      >
                        <Text style={styles.btnPrimaryText}>Accept</Text>
                      </Pressable>
                    </View>
                    <Pressable
                      disabled={busy}
                      onPress={() => {
                        setActionError(null);
                        blockMutation.mutate(other.id);
                      }}
                    >
                      <Text style={styles.blockLink}>
                        Block · hide from Nearby
                      </Text>
                    </Pressable>
                  </View>
                ) : tab === "sent" ? (
                  <View style={styles.sentRow}>
                    <Text style={styles.waitText}>
                      Waiting for them to review your profile
                    </Text>
                    {request.status === "pending" ? (
                      <Pressable
                        disabled={busy}
                        onPress={() => {
                          setActionError(null);
                          cancelMutation.mutate(request.id);
                        }}
                      >
                        <Text style={styles.cancelLink}>Cancel</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.connectedText}>
                    Connected · chat coming soon
                  </Text>
                )
              }
            />
          </View>
        )}
      />
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
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tab: {
    borderRadius: 999,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  tabActive: { backgroundColor: colors.teal },
  tabText: { fontSize: 14, fontWeight: "600", color: colors.muted },
  tabTextActive: { color: "#fff" },
  errorBox: {
    borderRadius: 16,
    backgroundColor: colors.coralSoft,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorText: { fontSize: 14, color: colors.coral },
  stateBox: {
    borderRadius: 24,
    backgroundColor: colors.card,
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  stateText: { fontSize: 14, color: colors.muted, textAlign: "center" },
  cardWrap: { marginBottom: 12 },
  footerCol: { gap: 8 },
  footerRow: { flexDirection: "row", gap: 8 },
  btn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnGhostText: { fontSize: 14, fontWeight: "600", color: colors.muted },
  btnPrimary: { backgroundColor: colors.teal },
  btnPrimaryText: { fontSize: 14, fontWeight: "600", color: "#fff" },
  blockLink: {
    fontSize: 12,
    fontWeight: "500",
    color: colors.coral,
    textAlign: "center",
  },
  sentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  waitText: { flex: 1, fontSize: 12, color: colors.muted },
  cancelLink: { fontSize: 12, fontWeight: "600", color: colors.muted },
  connectedText: { fontSize: 12, fontWeight: "500", color: colors.teal },
  disabled: { opacity: 0.6 },
});
