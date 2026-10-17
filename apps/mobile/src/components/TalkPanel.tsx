import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEVICE_LOCATION_OFF,
  turnNeedsDeviceLocation,
  type AgentHistoryItem,
  type AgentMemoryItem,
  type AgentTurnResponse,
  type AgentUsageStatus,
  type DeviceLocation,
} from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { locationForTurn, offerDeviceLocationOnce } from "@/lib/device-location";
import { colors } from "@/lib/theme";
import { PendantCard } from "@/components/PendantSession";
import { VoiceMemoPanel } from "@/components/VoiceMemoPanel";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

const EXAMPLES = [
  "What's on my calendar today?",
  "Remind me to follow up with the Johnsons Friday",
  "Summarize unread emails from title and escrow",
];

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

function speak(text: string) {
  try {
    const Speech = require("expo-speech") as typeof import("expo-speech");
    Speech.stop();
    Speech.speak(text, { rate: 1, language: "en-US" });
  } catch (error) {
    console.warn("Spoken reply unavailable until the next dev build", error);
  }
}

export function TalkPanel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const threadRef = useRef<ScrollView>(null);

  useEffect(() => {
    void offerDeviceLocationOnce();
  }, []);

  const historyQuery = useQuery({
    queryKey: ["agent-history", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) {
        return { history: [] as AgentHistoryItem[], usage: null as AgentUsageStatus | null };
      }
      const token = await user.getIdToken();
      const res = await fetch(
        `${API_URL}/v1/agent/history?timeZone=${encodeURIComponent(deviceTimeZone())}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error("Could not load history");
      const body = (await res.json()) as {
        history: AgentHistoryItem[];
        usage: AgentUsageStatus;
      };
      return { history: body.history ?? [], usage: body.usage ?? null };
    },
  });

  const memoriesQuery = useQuery({
    queryKey: ["agent-memories", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) return [] as AgentMemoryItem[];
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/v1/agent/memories`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Could not load memories");
      const body = (await res.json()) as { memories: AgentMemoryItem[] };
      return body.memories ?? [];
    },
  });

  async function postTurn(body: Record<string, unknown> & { location?: DeviceLocation }) {
    if (!user) throw new Error("Sign in first");
    const token = await user.getIdToken();
    const res = await fetch(`${API_URL}/v1/agent`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, timeZone: deviceTimeZone() }),
    });
    const payload = (await res.json().catch(() => null)) as
      | (AgentTurnResponse & { error?: string })
      | null;
    if (!res.ok) {
      throw new Error(payload?.error ?? "The assistant didn't answer");
    }
    if (!payload?.reply) throw new Error("Empty reply");
    return payload;
  }

  async function ask(spoken: string) {
    const next = spoken.trim();
    if (!next || busy) return;
    const needsLocation = turnNeedsDeviceLocation(next);
    setLastRequest(next);
    setBusy(true);
    setError(null);
    setReply(null);
    setLocationNote(null);
    try {
      const location = await locationForTurn(needsLocation);
      if (needsLocation && !location) setLocationNote(DEVICE_LOCATION_OFF);
      const result = await postTurn({
        text: next,
        ...(location ? { location } : {}),
      });
      setReply(result.reply);
      setText("");
      speak(result.reply);
      await queryClient.invalidateQueries({ queryKey: ["agent-memories"] });
      await queryClient.invalidateQueries({ queryKey: ["agent-history"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not ask");
    } finally {
      setBusy(false);
    }
  }

  async function forget(id: string) {
    if (!user) return;
    const token = await user.getIdToken();
    const res = await fetch(`${API_URL}/v1/agent/memories/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setError("Could not delete that memory");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["agent-memories"] });
  }

  async function clearHistory() {
    if (!user) return;
    Alert.alert("Clear your Talk history?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          void (async () => {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/v1/agent/history`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
              setError("Could not clear history.");
              return;
            }
            setReply(null);
            setLastRequest(null);
            await queryClient.invalidateQueries({ queryKey: ["agent-history"] });
          })();
        },
      },
    ]);
  }

  const memories = [...(memoriesQuery.data ?? [])].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  const history = [...(historyQuery.data?.history ?? [])].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  const newest = history[history.length - 1];
  const turnSaved = Boolean(
    reply &&
      lastRequest &&
      newest &&
      newest.reply === reply &&
      newest.request === lastRequest,
  );
  const showLive = !turnSaved && Boolean(busy || reply);
  const usage = historyQuery.data?.usage;
  const showExamples = history.length === 0 && !showLive;

  useEffect(() => {
    threadRef.current?.scrollToEnd({ animated: true });
  }, [history.length, reply, busy, error, memoryOpen]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Talk</Text>
        </View>
        {usage?.plan === "pro" ? (
          <Text style={styles.pro}>Pro</Text>
        ) : usage && usage.remaining !== null ? (
          <Text style={styles.remaining}>{usage.remaining} left today</Text>
        ) : null}
      </View>

      <ScrollView
        ref={threadRef}
        style={styles.thread}
        contentContainerStyle={[
          styles.threadContent,
          showExamples ? styles.threadEmpty : null,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {showExamples ? (
          <View style={styles.examples}>
            <Text style={styles.headline}>Say or type a request.</Text>
            {EXAMPLES.map((example) => (
              <Pressable
                key={example}
                disabled={busy}
                onPress={() => void ask(example)}
                style={styles.example}
              >
                <Text style={styles.exampleText}>{example}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {history.map((item) => (
          <View key={item.id} style={styles.turn}>
            <View style={styles.mineRow}>
              <View style={styles.mineBubble}>
                <Text style={styles.mineText}>{item.request}</Text>
              </View>
            </View>
            <View style={styles.theirRow}>
              <View style={styles.theirBubble}>
                <Text style={styles.theirText}>{item.reply}</Text>
                {item.receipt ? (
                  <Text style={styles.receipt}>Done: {item.receipt.action}</Text>
                ) : null}
                {item.status === "cancelled" ? (
                  <Text style={styles.cancelled}>Cancelled</Text>
                ) : null}
                <Text style={styles.time}>
                  {new Date(item.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
            </View>
          </View>
        ))}

        {showLive ? (
          <View style={styles.turn}>
            {lastRequest ? (
              <View style={styles.mineRow}>
                <View style={styles.mineBubble}>
                  <Text style={styles.mineText}>{lastRequest}</Text>
                </View>
              </View>
            ) : null}
            <View style={styles.theirRow}>
              <View style={styles.theirBubble}>
                {busy ? (
                  <ActivityIndicator color={colors.teal} />
                ) : (
                  <Text style={styles.theirText}>{reply}</Text>
                )}
              </View>
            </View>
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      {memoryOpen ? (
        <View style={styles.library}>
          <View style={styles.libraryHeader}>
            <Text style={styles.cardLabel}>Memory</Text>
            <Pressable onPress={() => setMemoryOpen(false)}>
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          {memories.length > 0 ? (
            memories.map((item) => (
              <View key={item.id} style={styles.memory}>
                <Text style={styles.memoryText}>{item.text}</Text>
                <Pressable onPress={() => void forget(item.id)}>
                  <Text style={styles.delete}>Delete</Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.note}>Nothing saved yet.</Text>
          )}
        </View>
      ) : null}

      <View style={styles.footer}>
        {menuOpen ? (
          <View style={styles.morePanel}>
            <VoiceMemoPanel />
            <PendantCard />
            {history.length > 0 ? (
              <Pressable onPress={() => void clearHistory()}>
                <Text style={styles.clear}>Clear history</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {locationNote ? <Text style={styles.note}>{locationNote}</Text> : null}
        <View style={styles.composerCard}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Say or type a request"
            placeholderTextColor={colors.muted}
            style={styles.input}
            onSubmitEditing={() => void ask(text)}
            returnKeyType="send"
          />
          <View style={styles.composerTools}>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                setMemoryOpen((open) => !open);
              }}
            >
              <Text style={[styles.libraryLink, memoryOpen && styles.libraryLinkOn]}>
                Memory{memories.length ? ` ${memories.length}` : ""}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMemoryOpen(false);
                setMenuOpen((open) => !open);
              }}
            >
              <Text style={[styles.libraryLink, menuOpen && styles.libraryLinkOn]}>More</Text>
            </Pressable>
            <Pressable
              disabled={busy || !text.trim()}
              onPress={() => void ask(text)}
              style={[styles.ask, (busy || !text.trim()) && styles.disabled]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.askText}>↑</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  header: {
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerText: { flex: 1 },
  title: { fontSize: 15, fontWeight: "600", color: colors.ink },
  pro: {
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: colors.tealSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.teal,
  },
  remaining: { paddingTop: 8, fontSize: 12, color: colors.muted },
  thread: { flex: 1 },
  threadContent: {
    flexGrow: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 18,
  },
  threadEmpty: { justifyContent: "center" },
  headline: {
    marginBottom: 8,
    textAlign: "center",
    fontSize: 28,
    fontWeight: "500",
    color: colors.ink,
  },
  turn: { gap: 8 },
  mineRow: { flexDirection: "row", justifyContent: "flex-end" },
  theirRow: { flexDirection: "row", justifyContent: "flex-start" },
  mineBubble: {
    maxWidth: "78%",
    borderRadius: 22,
    backgroundColor: "rgba(17,24,39,0.06)",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  theirBubble: {
    maxWidth: "100%",
    paddingRight: 12,
  },
  mineText: { fontSize: 16, lineHeight: 22, color: colors.ink },
  theirText: { fontSize: 16, lineHeight: 24, color: colors.ink },
  receipt: { marginTop: 6, fontSize: 13, color: colors.ink },
  cancelled: {
    marginTop: 6,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.coral,
  },
  time: { marginTop: 4, fontSize: 10, color: colors.muted },
  cardLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.teal,
  },
  examples: { gap: 8 },
  tryLabel: { fontSize: 12, color: colors.muted },
  example: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  exampleText: { fontSize: 14, color: colors.ink },
  note: { color: colors.muted, fontSize: 14 },
  error: { color: colors.coral, fontSize: 14 },
  footer: {
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 12,
    backgroundColor: colors.page,
  },
  morePanel: {
    gap: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
  },
  composerCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 8,
  },
  composerTools: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
  },
  libraryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  libraryLink: { fontSize: 12, fontWeight: "700", color: colors.muted },
  libraryLinkOn: { color: colors.teal },
  clear: { fontSize: 12, fontWeight: "700", color: colors.coral },
  library: {
    maxHeight: 220,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  libraryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  close: { fontSize: 12, fontWeight: "700", color: colors.muted },
  input: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
  },
  ask: {
    marginLeft: "auto",
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
  },
  askText: { color: "#fff", fontWeight: "700", fontSize: 18 },
  disabled: { opacity: 0.6 },
  memory: {
    borderRadius: 16,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  memoryText: { flex: 1, fontSize: 14, color: colors.ink },
  delete: { fontSize: 12, fontWeight: "700", color: colors.coral },
});
