import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { INVITE_STORAGE_KEY, isInviteCode } from "@nearby/shared";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth-context";
import { acceptInvite } from "@/lib/phone-messaging";
import { colors } from "@/lib/theme";

export default function InviteScreen() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = typeof params.code === "string" ? params.code : "";
  const valid = isInviteCode(code);
  const { user } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<"ready" | "joining" | "joined" | "error">(
    valid ? "ready" : "error",
  );
  const [error, setError] = useState<string | null>(valid ? null : "That invite link is not valid.");

  useEffect(() => {
    if (!valid) return;
    void AsyncStorage.setItem(INVITE_STORAGE_KEY, code);
  }, [code, valid]);

  useEffect(() => {
    if (!valid || !user) return;
    let cancelled = false;
    setStatus("joining");
    void user
      .getIdToken()
      .then((token) => acceptInvite(token, code))
      .then(async () => {
        if (cancelled) return;
        await AsyncStorage.removeItem(INVITE_STORAGE_KEY);
        setStatus("joined");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Could not accept that invite");
      });
    return () => {
      cancelled = true;
    };
  }, [code, user, valid]);

  return (
    <View style={styles.screen}>
      <BrandMark label="nearby" style={styles.brand} />
      <Text style={styles.title}>
        {status === "joined"
          ? "You're connected"
          : valid
            ? "You've been invited to Nearby"
            : "That invite link is not valid"}
      </Text>
      {valid ? (
        <Text style={styles.muted}>
          {status === "joined"
            ? "You can message them in Nearby. The conversation stays in the app."
            : "Create an account to message them. The conversation stays in Nearby."}
        </Text>
      ) : null}
      {valid && error ? <Text style={styles.error}>{error}</Text> : null}
      {status === "joined" ? (
        <Pressable onPress={() => router.replace("/(tabs)/messages")} style={styles.primary}>
          <Text style={styles.primaryText}>Open messages</Text>
        </Pressable>
      ) : !valid ? null : user ? (
        <Text style={styles.muted}>{status === "joining" ? "Connecting…" : ""}</Text>
      ) : (
        <Pressable onPress={() => router.push("/(auth)/signup")} style={styles.primary}>
          <Text style={styles.primaryText}>Create an account</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", backgroundColor: colors.page, padding: 24 },
  brand: { fontSize: 28, fontStyle: "italic", color: colors.ink },
  title: { marginTop: 24, fontSize: 28, fontWeight: "700", color: colors.ink },
  muted: { marginTop: 8, fontSize: 14, lineHeight: 20, color: colors.muted },
  error: { marginTop: 16, fontSize: 14, color: colors.coral },
  primary: {
    marginTop: 28,
    borderRadius: 16,
    backgroundColor: colors.teal,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
