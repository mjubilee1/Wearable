import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentMemoryItem, AgentTurnResponse } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function postTurn(body: Record<string, unknown>) {
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
    setBusy(true);
    setError(null);
    try {
      const result = await postTurn({ text: next });
      setReply(result.reply);
      setText("");
      speak(result.reply);
      await queryClient.invalidateQueries({ queryKey: ["agent-memories"] });
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

  const memories = memoriesQuery.data ?? [];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Talk</Text>
      <Text style={styles.subtitle}>Say or type a request.</Text>

      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Say or type a request"
        placeholderTextColor={colors.muted}
        style={styles.input}
        onSubmitEditing={() => void ask(text)}
        returnKeyType="send"
      />
      <Pressable
        disabled={busy || !text.trim()}
        onPress={() => void ask(text)}
        style={[styles.ask, (busy || !text.trim()) && styles.disabled]}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.askText}>Ask</Text>
        )}
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!busy && !reply ? (
        <View style={styles.examples}>
          <Text style={styles.tryLabel}>Try one</Text>
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

      {busy || reply ? (
        <View style={styles.card}>
          {busy ? (
            <ActivityIndicator color={colors.teal} />
          ) : (
            <Text style={styles.reply}>{reply}</Text>
          )}
        </View>
      ) : null}

      <VoiceMemoPanel />
      <PendantCard />
      {memories.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Memory</Text>
          {memories.map((item) => (
            <View key={item.id} style={styles.memory}>
              <Text style={styles.memoryText}>{item.text}</Text>
              <Pressable onPress={() => void forget(item.id)}>
                <Text style={styles.delete}>Delete</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 40, gap: 12 },
  title: { fontSize: 32, fontWeight: "700", color: colors.ink },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.muted },
  card: {
    marginTop: 8,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 16,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.teal,
  },
  reply: {
    fontSize: 18,
    fontWeight: "500",
    lineHeight: 24,
    color: colors.ink,
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
  error: { color: colors.coral, fontSize: 14 },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: colors.ink,
  },
  ask: {
    borderRadius: 16,
    backgroundColor: colors.teal,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  askText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  disabled: { opacity: 0.6 },
  memory: {
    marginTop: 10,
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
