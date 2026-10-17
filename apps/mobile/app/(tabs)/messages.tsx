import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { messageListTime } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { listConnections } from "@/lib/connections";
import { InvitePanel } from "@/components/InvitePanel";
import { createConversation, getConversations } from "@/lib/phone-messaging";
import { colors } from "@/lib/theme";

export default function MessagesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const conversations = useQuery({
    queryKey: ["conversations", user?.uid],
    enabled: Boolean(user),
    refetchInterval: 5_000,
    queryFn: async () => getConversations(await user!.getIdToken()).then((r) => r.conversations),
  });
  const connections = useQuery({
    queryKey: ["message-connections", user?.uid],
    enabled: Boolean(user) && composing,
    queryFn: () => listConnections(user!.uid),
  });
  const start = useMutation({
    mutationFn: async (recipientId: string) =>
      createConversation(await user!.getIdToken(), recipientId),
    onSuccess: ({ conversation }) => {
      setComposing(false);
      router.push(`/messages/${conversation.id}`);
    },
  });

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = conversations.data ?? [];
    if (!needle) return list;
    return list.filter((row) => {
      const preview = row.lastMessage?.content ?? "";
      return (
        row.other.name.toLowerCase().includes(needle) ||
        preview.toLowerCase().includes(needle)
      );
    });
  }, [conversations.data, query]);

  function openConnection(recipientId: string) {
    const existing = conversations.data?.find((row) => row.other.id === recipientId);
    if (existing) {
      setComposing(false);
      router.push(`/messages/${existing.id}`);
      return;
    }
    start.mutate(recipientId);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <Pressable onPress={() => setComposing(true)} style={styles.newButton}>
          <Text style={styles.newButtonText}>New message</Text>
        </Pressable>
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search"
        placeholderTextColor={colors.muted}
        style={styles.search}
      />
      <ScrollView contentContainerStyle={styles.list}>
        {conversations.isLoading ? <Text style={styles.muted}>Loading conversations…</Text> : null}
        {conversations.isError ? (
          <View style={styles.empty}>
            <Text style={styles.error}>Could not load conversations.</Text>
            <Pressable onPress={() => conversations.refetch()}>
              <Text style={styles.link}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
        {!conversations.isLoading && !conversations.isError && !rows.length ? (
          <View style={styles.empty}>
            <Text style={styles.name}>{query ? "No chats match that search." : "No conversations yet."}</Text>
            <Text style={styles.muted}>
              {query ? "Try another name." : "Invite someone to Nearby, then message them here."}
            </Text>
          </View>
        ) : null}
        {rows.map((row) => {
          const mine = row.lastMessage?.senderId === user?.uid;
          const preview = row.lastMessage
            ? `${mine ? "You: " : ""}${row.lastMessage.content}`
            : "Start the conversation";
          return (
            <Pressable
              key={row.id}
              style={styles.row}
              onPress={() => router.push(`/messages/${row.id}`)}
            >
              <View style={[styles.avatar, { backgroundColor: `hsl(${row.other.avatarHue}, 55%, 42%)` }]}>
                <Text style={styles.avatarText}>{row.other.initials}</Text>
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text numberOfLines={1} style={styles.name}>{row.other.name}</Text>
                  {row.lastMessage ? (
                    <Text style={styles.time}>{messageListTime(row.lastMessage.createdAt)}</Text>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={styles.muted}>{preview}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <Modal visible={composing} animationType="slide" transparent onRequestClose={() => setComposing(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>New message</Text>
              <Pressable onPress={() => setComposing(false)}>
                <Text style={styles.link}>Cancel</Text>
              </Pressable>
            </View>
            <ScrollView>
              {connections.isLoading ? <Text style={styles.muted}>Loading people…</Text> : null}
              {connections.data?.map((row) => (
                <Pressable
                  key={row.other.id}
                  disabled={start.isPending}
                  onPress={() => openConnection(row.other.id)}
                  style={styles.person}
                >
                  <View style={[styles.avatar, { backgroundColor: `hsl(${row.other.avatarHue}, 55%, 42%)` }]}>
                    <Text style={styles.avatarText}>{row.other.initials}</Text>
                  </View>
                  <Text style={styles.name}>{row.other.name}</Text>
                </Pressable>
              ))}
              {!connections.isLoading && !connections.data?.length ? (
                <Text style={styles.muted}>No one to message yet. Send an invite below.</Text>
              ) : null}
              <InvitePanel />
              {start.error ? <Text style={styles.error}>{start.error.message}</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page, paddingTop: 56 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.ink },
  newButton: { borderRadius: 999, backgroundColor: colors.teal, paddingHorizontal: 14, paddingVertical: 8 },
  newButtonText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  search: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.ink,
    fontSize: 15,
  },
  list: { paddingBottom: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "700" },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.ink },
  time: { fontSize: 12, color: colors.muted },
  muted: { fontSize: 13, color: colors.muted },
  empty: { paddingHorizontal: 24, paddingVertical: 40, alignItems: "center", gap: 6 },
  error: { fontSize: 13, color: colors.coral },
  link: { fontSize: 14, fontWeight: "700", color: colors.teal },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(17,24,39,0.4)" },
  sheet: {
    maxHeight: "70%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.card,
    padding: 16,
    gap: 8,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 17, fontWeight: "700", color: colors.ink },
  person: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
});
