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
import { groupChatMessages, messageClock, type Message } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import {
  blockConversation,
  getConversations,
  getMessages,
  postMessage,
  reportConversation,
} from "@/lib/phone-messaging";
import { colors } from "@/lib/theme";

type Row =
  | { kind: "day"; id: string; label: string }
  | { kind: "bubble"; id: string; message: Message; mine: boolean; last: boolean };

export default function ChatScreen() {
  const { conversationId: rawId } = useLocalSearchParams<{ conversationId: string }>();
  const conversationId = String(rawId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList<Row>>(null);
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
    mutationFn: async (text: string) => postMessage(await token(), conversationId, text),
    onMutate: async (text) => {
      setContent("");
      await queryClient.cancelQueries({ queryKey: ["messages", conversationId] });
      const previous = queryClient.getQueryData<Message[]>(["messages", conversationId]);
      const optimistic: Message = {
        id: `pending-${Date.now()}`,
        conversationId,
        senderId: user?.uid ?? "",
        recipientId: "",
        content: text,
        messageType: "TEXT",
        deliveryStatus: "SENT",
        createdAt: Date.now(),
      };
      queryClient.setQueryData<Message[]>(["messages", conversationId], [
        ...(previous ?? []),
        optimistic,
      ]);
      return { previous, text };
    },
    onError: (_error, _text, context) => {
      if (context?.text) setContent(context.text);
      if (context?.previous) {
        queryClient.setQueryData(["messages", conversationId], context.previous);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      await queryClient.invalidateQueries({ queryKey: ["conversations", user?.uid] });
    },
  });
  const other = conversations.data?.find((row) => row.id === conversationId)?.other;
  const rows: Row[] = groupChatMessages(messages.data ?? []).flatMap((group) => {
    const day: Row = { kind: "day", id: `day-${group.day}`, label: group.day };
    const bubbles = group.clusters.flatMap((cluster) =>
      cluster.messages.map((message, index) => ({
        kind: "bubble" as const,
        id: message.id,
        message,
        mine: message.senderId === user?.uid,
        last: index === cluster.messages.length - 1,
      })),
    );
    return [day, ...bubbles];
  });

  useEffect(() => {
    if (rows.length) listRef.current?.scrollToEnd({ animated: true });
  }, [rows.length]);

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

  function openActions() {
    Alert.alert(other?.name ?? "Conversation", undefined, [
      { text: "Report", onPress: confirmReport },
      { text: "Block", style: "destructive", onPress: confirmBlock },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <View style={[styles.avatar, { backgroundColor: `hsl(${other?.avatarHue ?? 168}, 55%, 42%)` }]}>
          <Text style={styles.avatarText}>{other?.initials ?? "•"}</Text>
        </View>
        <View style={styles.heading}>
          <Text numberOfLines={1} style={styles.name}>{other?.name ?? "Conversation"}</Text>
          <Text style={styles.muted}>Message</Text>
        </View>
        <Pressable onPress={openActions} hitSlop={8}>
          <Text style={styles.more}>···</Text>
        </Pressable>
      </View>
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messages}
        ListEmptyComponent={
          <Text style={messages.error ? styles.error : styles.empty}>
            {messages.error?.message ??
              (messages.isLoading ? "Loading messages…" : "Say hello to start the conversation.")}
          </Text>
        }
        renderItem={({ item }) => {
          if (item.kind === "day") {
            return <Text style={styles.day}>{item.label}</Text>;
          }
          const pending = item.message.id.startsWith("pending-");
          return (
            <View style={[styles.bubbleRow, item.mine ? styles.mineRow : styles.theirRow, pending && styles.pending]}>
              <View
                style={[
                  styles.bubble,
                  item.mine ? styles.mineBubble : styles.theirBubble,
                  item.last
                    ? item.mine
                      ? styles.mineTail
                      : styles.theirTail
                    : null,
                ]}
              >
                <Text style={item.mine ? styles.mineText : styles.theirText}>{item.message.content}</Text>
                {item.last ? (
                  <Text style={item.mine ? styles.mineTime : styles.theirTime}>
                    {pending ? "Sending…" : messageClock(item.message.createdAt)}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        }}
      />
      {send.error ? <Text style={styles.sendError}>{send.error.message}</Text> : null}
      <View style={styles.composer}>
        <TextInput
          value={content}
          onChangeText={setContent}
          maxLength={2_000}
          placeholder="Message"
          placeholderTextColor={colors.muted}
          style={styles.input}
          multiline
        />
        <Pressable
          disabled={!content.trim() || send.isPending}
          onPress={() => send.mutate(content.trim())}
          style={[styles.send, (!content.trim() || send.isPending) && styles.disabled]}
        >
          <Text style={styles.sendText}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingTop: 52,
    paddingHorizontal: 12,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  back: { fontSize: 28, fontWeight: "600", color: colors.teal, lineHeight: 30 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  heading: { flex: 1 },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
  muted: { fontSize: 12, color: colors.muted },
  more: { fontSize: 20, color: colors.muted, fontWeight: "700" },
  messages: { flexGrow: 1, padding: 12, gap: 4, justifyContent: "flex-end" },
  day: {
    alignSelf: "center",
    marginVertical: 8,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.muted,
  },
  bubbleRow: { flexDirection: "row", marginBottom: 2 },
  mineRow: { justifyContent: "flex-end" },
  theirRow: { justifyContent: "flex-start" },
  pending: { opacity: 0.7 },
  bubble: { maxWidth: "80%", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  mineBubble: { backgroundColor: colors.teal },
  theirBubble: { backgroundColor: colors.card },
  mineTail: { borderBottomRightRadius: 6 },
  theirTail: { borderBottomLeftRadius: 6 },
  mineText: { fontSize: 16, color: "#fff" },
  theirText: { fontSize: 16, color: colors.ink },
  mineTime: { marginTop: 3, fontSize: 10, color: "rgba(255,255,255,0.7)" },
  theirTime: { marginTop: 3, fontSize: 10, color: colors.muted },
  empty: { textAlign: "center", marginTop: 40, fontSize: 14, color: colors.muted },
  error: { textAlign: "center", marginTop: 40, fontSize: 14, color: colors.coral },
  sendError: { backgroundColor: colors.coralSoft, paddingHorizontal: 14, paddingVertical: 6, color: colors.coral },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.ink,
    fontSize: 16,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { fontSize: 18, fontWeight: "700", color: "#fff" },
  disabled: { opacity: 0.4 },
});
