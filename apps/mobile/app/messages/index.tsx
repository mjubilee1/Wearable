import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { listConnections } from "@/lib/connections";
import { createConversation, getConversations } from "@/lib/phone-messaging";
import { colors } from "@/lib/theme";

export default function MessagesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const conversations = useQuery({
    queryKey: ["conversations", user?.uid],
    enabled: Boolean(user),
    refetchInterval: 5_000,
    queryFn: async () => getConversations(await user!.getIdToken()).then((r) => r.conversations),
  });
  const connections = useQuery({
    queryKey: ["message-connections", user?.uid],
    enabled: Boolean(user),
    queryFn: () => listConnections(user!.uid),
  });
  const start = useMutation({
    mutationFn: async (recipientId: string) =>
      createConversation(await user!.getIdToken(), recipientId),
    onSuccess: ({ conversation }) => router.push(`/messages/${conversation.id}`),
  });
  const existing = new Set(conversations.data?.map((row) => row.other.id) ?? []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Nearby</Text>
          <Text style={styles.title}>Messages</Text>
        </View>
        <Pressable onPress={() => router.back()}><Text style={styles.link}>Back</Text></Pressable>
      </View>
      <View style={styles.card}>
        {conversations.isLoading ? <Text style={styles.muted}>Loading conversations…</Text> : null}
        {!conversations.isLoading && !conversations.data?.length ? <Text style={styles.muted}>No conversations yet.</Text> : null}
        {conversations.data?.map((row) => (
          <Pressable key={row.id} style={styles.row} onPress={() => router.push(`/messages/${row.id}`)}>
            <View style={[styles.avatar, { backgroundColor: `hsl(${row.other.avatarHue}, 55%, 45%)` }]}>
              <Text style={styles.avatarText}>{row.other.initials}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.name}>{row.other.name}</Text>
              <Text numberOfLines={1} style={styles.muted}>{row.lastMessage?.content ?? "Start the conversation"}</Text>
            </View>
            {row.lastMessage ? <Text style={styles.time}>{new Date(row.lastMessage.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text> : null}
          </Pressable>
        ))}
      </View>
      <Text style={styles.sectionTitle}>Start a chat with a connection</Text>
      {connections.data?.filter((row) => !existing.has(row.other.id)).map((row) => (
        <Pressable key={row.other.id} style={styles.connection} disabled={start.isPending} onPress={() => start.mutate(row.other.id)}>
          <Text style={styles.name}>{row.other.name}</Text>
          <Text style={styles.link}>Message</Text>
        </Pressable>
      ))}
      {!connections.isLoading && !connections.data?.length ? <Text style={styles.muted}>Connect with someone through Nearby before messaging.</Text> : null}
      {conversations.error ? <Text style={styles.error}>{conversations.error.message}</Text> : null}
      {start.error ? <Text style={styles.error}>{start.error.message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 40, gap: 16 },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1.8, textTransform: "uppercase", color: colors.teal },
  title: { marginTop: 4, fontSize: 28, fontWeight: "700", color: colors.ink },
  link: { fontSize: 13, fontWeight: "700", color: colors.teal },
  card: { overflow: "hidden", borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "700" },
  rowBody: { flex: 1 },
  name: { fontSize: 14, fontWeight: "700", color: colors.ink },
  muted: { fontSize: 13, color: colors.muted },
  time: { fontSize: 10, color: colors.muted },
  sectionTitle: { marginTop: 8, fontSize: 14, fontWeight: "700", color: colors.ink },
  connection: { flexDirection: "row", justifyContent: "space-between", borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14 },
  error: { fontSize: 13, color: colors.coral },
});
