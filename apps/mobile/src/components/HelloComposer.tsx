import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useEffect, useState } from "react";
import { INTRO_MESSAGE_MAX } from "@nearby/shared";
import { colors } from "@/lib/theme";

type HelloComposerProps = {
  name: string;
  initialMessage?: string;
  sending?: boolean;
  error?: string | null;
  onSend: (message: string) => void;
  onCancel: () => void;
};

export function HelloComposer({
  name,
  initialMessage = "",
  sending,
  error,
  onSend,
  onCancel,
}: HelloComposerProps) {
  const [message, setMessage] = useState(initialMessage);

  useEffect(() => {
    setMessage(initialMessage);
  }, [initialMessage]);

  const remaining = INTRO_MESSAGE_MAX - message.length;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.eyebrow}>Warm intro</Text>
          <Text style={styles.title}>Say hello to {name}</Text>
          <Text style={styles.body}>
            One short message. They’ll see your profile and choose whether to
            connect — no chat until they accept.
          </Text>

          <TextInput
            value={message}
            onChangeText={(v) => setMessage(v.slice(0, INTRO_MESSAGE_MAX))}
            multiline
            numberOfLines={4}
            placeholder="Hey — we seem to overlap on a few vibes. Want to connect?"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />

          <View style={styles.meta}>
            <Text style={styles.metaText}>No links or handles — keep it human.</Text>
            <Text
              style={[
                styles.metaText,
                remaining < 20 ? { color: colors.coral } : null,
              ]}
            >
              {remaining}
            </Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              disabled={sending}
              style={[styles.btn, styles.btnGhost]}
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onSend(message)}
              disabled={sending || !message.trim()}
              style={[
                styles.btn,
                styles.btnPrimary,
                (sending || !message.trim()) && styles.disabled,
              ]}
            >
              <Text style={styles.btnPrimaryText}>
                {sending ? "Sending…" : "Send hello"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.4)",
    justifyContent: "flex-end",
    padding: 16,
  },
  sheet: {
    borderRadius: 24,
    backgroundColor: colors.card,
    padding: 20,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.teal,
  },
  title: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: "700",
    color: colors.ink,
  },
  body: { marginTop: 8, fontSize: 14, lineHeight: 20, color: colors.muted },
  input: {
    marginTop: 16,
    minHeight: 100,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: "top",
  },
  meta: {
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  metaText: { fontSize: 12, color: colors.muted },
  error: { marginTop: 8, fontSize: 14, color: colors.coral },
  actions: { marginTop: 16, flexDirection: "row", gap: 8 },
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
  disabled: { opacity: 0.6 },
});
