import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FREE_MEMORY_RETENTION_DAYS,
  hasProAccess,
  type AgentMemoryItem,
} from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

export function MemorySettings() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const pro = profile ? hasProAccess(profile) : false;

  const memories = useQuery({
    queryKey: ["memories", search],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) return [] as AgentMemoryItem[];
      const token = await user.getIdToken();
      const response = await fetch(
        `${API_URL}/v1/agent/memories?q=${encodeURIComponent(search)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const body = (await response.json().catch(() => ({}))) as {
        memories?: AgentMemoryItem[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Could not load memories.");
      return body.memories ?? [];
    },
  });

  async function remove(path: string) {
    if (!user) return;
    setDeleting(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`${API_URL}${path}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not delete memory.");
      }
      await queryClient.invalidateQueries({ queryKey: ["memories"] });
      await queryClient.invalidateQueries({ queryKey: ["agent-memories"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete memory.");
    } finally {
      setDeleting(false);
    }
  }

  function confirmDeleteAll() {
    Alert.alert(
      "Delete all memories?",
      "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: () => void remove("/v1/agent/memories"),
        },
      ],
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.title}>Memory</Text>
          <Text style={styles.description}>
            {pro
              ? "Pro keeps your memories without a time limit."
              : `Free keeps the last ${FREE_MEMORY_RETENTION_DAYS} days.`}
          </Text>
        </View>
        <Pressable
          disabled={deleting || !memories.data?.length}
          onPress={confirmDeleteAll}
        >
          <Text style={[styles.delete, (deleting || !memories.data?.length) && styles.disabled]}>
            Delete all
          </Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          value={searchInput}
          onChangeText={setSearchInput}
          onSubmitEditing={() => setSearch(searchInput.trim())}
          placeholder="Search people, promises, or dates"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          style={styles.input}
        />
        <Pressable onPress={() => setSearch(searchInput.trim())} style={styles.searchButton}>
          <Text style={styles.searchButtonText}>Search</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {memories.isError ? (
        <Text style={styles.error}>
          {memories.error instanceof Error ? memories.error.message : "Could not load memories."}
        </Text>
      ) : null}
      {memories.isLoading ? (
        <ActivityIndicator color={colors.teal} style={styles.loading} />
      ) : memories.data?.length ? (
        memories.data.map((memory) => (
          <View key={memory.id} style={styles.memory}>
            <View style={styles.memoryCopy}>
              <Text style={styles.summary}>{memory.summary}</Text>
              <Text style={styles.meta}>
                {memory.source === "voice_memo" ? "Voice memo" : "Command"}
                {" · "}
                {new Date(memory.createdAt).toLocaleDateString()}
              </Text>
              {memory.people.length ? (
                <Text style={styles.meta}>People: {memory.people.join(", ")}</Text>
              ) : null}
            </View>
            <Pressable
              disabled={deleting}
              onPress={() => void remove(`/v1/agent/memories/${memory.id}`)}
            >
              <Text style={[styles.delete, deleting && styles.disabled]}>Delete</Text>
            </Pressable>
          </View>
        ))
      ) : (
        <Text style={styles.empty}>
          {search ? "No matching memories." : "Your voice memos and commands will appear here."}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 16,
  },
  headingRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headingCopy: { flex: 1 },
  title: { fontSize: 18, fontWeight: "700", color: colors.ink },
  description: { marginTop: 4, fontSize: 14, lineHeight: 20, color: colors.muted },
  searchRow: { marginTop: 16, flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 13,
    color: colors.ink,
  },
  searchButton: {
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.ink,
    paddingHorizontal: 14,
  },
  searchButtonText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  loading: { marginTop: 20 },
  memory: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    padding: 12,
  },
  memoryCopy: { flex: 1 },
  summary: { fontSize: 14, fontWeight: "600", lineHeight: 20, color: colors.ink },
  meta: { marginTop: 4, fontSize: 12, color: colors.muted },
  empty: {
    marginTop: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    padding: 14,
    fontSize: 14,
    color: colors.muted,
  },
  delete: { fontSize: 12, fontWeight: "700", color: colors.coral },
  error: { marginTop: 12, fontSize: 13, color: colors.coral },
  disabled: { opacity: 0.4 },
});
