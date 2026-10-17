import { useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Message } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import {
  blockConversation,
  getConversations,
  getMessages,
  postMessage,
  reportConversation,
} from "@/lib/phone-messaging";
import { colors } from "@/lib/theme";

export default function ChatScreen() {
  const { conversationId: rawId } = useLocalSearchParams<{ conversationId: string }>();
  const conversationId = String(rawId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList<Message>>(null);
  const { user } = useAuth();
  const [content, setContent] = useState("");
  const token = () => user!.getIdToken();
  const conversations = useQuery({
    queryKey: ["conversations", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => getConversations(await token()).then((r) => r.conversations),
  });
  const messages = useQuery({
    queryKey: ["messages", conversationId],
    enabled: Boolean(user && conversationId),
    refetchInterval: 3_000,
    queryFn: async () => getMessages(await token(), conversationId).then((r) => r.messages),
  });
  const send = useMutation({
    mutationFn: async () => postMessage(await token(), conversationId, content),
    onSuccess: async () => {
      setContent("");
      await queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      await queryClient.invalidateQueries({ queryKey: ["conversations", user?.uid] });
    },
  });
  const other = conversations.data?.find((row) => row.id === conversationId)?.other;

  useEffect(() => {
    if (messages.data?.length) listRef.current?.scrollToEnd({ animated: true });
  }, [messages.data?.length]);

  function confirmBlock() {
    Alert.alert("Block this person?", "They will no longer be able to message you.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: async () => {
          await blockConversation(await token(), conversationId);
          router.replace("/messages");
        },
      },
    ]);
  }

  function confirmReport() {
    Alert.alert("Report this person?", "Nearby will review the conversation context.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Report",
        style: "destructive",
        onPress: async () => {
          await reportConversation(await token(), conversationId, "Inappropriate behavior");
          Alert.alert("Report received");
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}><Text style={styles.link}>Back</Text></Pressable>
        <View style={styles.heading}><Text style={styles.name}>{other?.name ?? "Conversation"}</Text><Text style={styles.muted}>Nearby message</Text></View>
        <View style={styles.actions}>
          <Pressable onPress={confirmReport}><Text style={styles.smallAction}>Report</Text></Pressable>
          <Pressable onPress={confirmBlock}><Text style={styles.block}>Block</Text></Pressable>
        </View>
      </View>
      <FlatList
        ref={listRef}
        data={messages.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messages}
        ListEmptyComponent={<Text style={messages.error ? styles.error : styles.empty}>{messages.error?.message ?? (messages.isLoading ? "Loading messages…" : "Say hello to start the conversation.")}</Text>}
        renderItem={({ item }) => {
          const mine = item.senderId === user?.uid;
          return (
            <View style={[styles.bubbleRow, mine ? styles.mineRow : styles.theirRow]}>
              <View style={[styles.bubble, mine ? styles.mineBubble : styles.theirBubble]}>
                <Text style={mine ? styles.mineText : styles.theirText}>{item.content}</Text>
                <Text style={mine ? styles.mineTime : styles.theirTime}>{new Date(item.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
              </View>
            </View>
          );
        }}
      />
      {send.error ? <Text style={styles.sendError}>{send.error.message}</Text> : null}
      <View style={styles.composer}>
        <TextInput value={content} onChangeText={setContent} maxLength={2_000} placeholder="Message" placeholderTextColor={colors.muted} style={styles.input} />
        <Pressable disabled={!content.trim() || send.isPending} onPress={() => send.mutate()} style={[styles.send, (!content.trim() || send.isPending) && styles.disabled]}><Text style={styles.sendText}>Send</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { paddingTop: 52, paddingHorizontal: 14, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  link: { fontSize: 13, fontWeight: "700", color: colors.teal },
  heading: { flex: 1 },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink },
  muted: { fontSize: 11, color: colors.muted },
  actions: { flexDirection: "row", gap: 10 },
  smallAction: { fontSize: 11, fontWeight: "700", color: colors.muted },
  block: { fontSize: 11, fontWeight: "700", color: colors.coral },
  messages: { flexGrow: 1, padding: 14, gap: 8, justifyContent: "flex-end" },
  bubbleRow: { flexDirection: "row" },
  mineRow: { justifyContent: "flex-end" },
  theirRow: { justifyContent: "flex-start" },
  bubble: { maxWidth: "80%", borderRadius: 22, paddingHorizontal: 14, paddingVertical: 9 },
  mineBubble: { backgroundColor: colors.teal },
  theirBubble: { backgroundColor: colors.card },
  mineText: { fontSize: 14, color: "#fff" },
  theirText: { fontSize: 14, color: colors.ink },
  mineTime: { marginTop: 3, fontSize: 9, color: "rgba(255,255,255,0.7)" },
  theirTime: { marginTop: 3, fontSize: 9, color: colors.muted },
  empty: { textAlign: "center", fontSize: 13, color: colors.muted },
  error: { textAlign: "center", fontSize: 13, color: colors.coral },
  sendError: { backgroundColor: colors.coralSoft, paddingHorizontal: 14, paddingVertical: 6, color: colors.coral },
  composer: { flexDirection: "row", gap: 8, padding: 12, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  input: { flex: 1, borderRadius: 24, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 11, color: colors.ink },
  send: { borderRadius: 24, backgroundColor: colors.teal, paddingHorizontal: 18, justifyContent: "center" },
  sendText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  disabled: { opacity: 0.5 },
});
