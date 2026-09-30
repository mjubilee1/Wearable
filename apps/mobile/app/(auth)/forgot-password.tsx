import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";

export default function ForgotPasswordScreen() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send reset email",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>Nearby</Text>
        <Text style={styles.title}>Reset password</Text>
        <Text style={styles.subtitle}>
          Enter your email and we’ll send a reset link.
        </Text>

        {sent ? (
          <View style={styles.sentBlock}>
            <View style={styles.successBox}>
              <Text style={styles.successText}>
                If an account exists for {email.trim()}, a reset email is on the
                way. Check your inbox and spam folder.
              </Text>
            </View>
            <Link href="/(auth)/login" asChild>
              <Pressable style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>Back to sign in</Text>
              </Pressable>
            </Link>
          </View>
        ) : (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                style={styles.input}
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={onSubmit}
              disabled={submitting}
              style={[styles.primaryBtn, submitting && styles.disabled]}
            >
              <Text style={styles.primaryBtnText}>
                {submitting ? "Sending…" : "Send reset link"}
              </Text>
            </Pressable>
          </>
        )}

        <Text style={styles.footer}>
          Remembered it?{" "}
          <Link href="/(auth)/login" style={styles.footerLink}>
            Sign in
          </Link>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.page },
  container: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.teal,
  },
  title: {
    marginTop: 8,
    fontSize: 30,
    fontWeight: "700",
    color: colors.ink,
  },
  subtitle: { marginTop: 8, fontSize: 14, color: colors.muted },
  sentBlock: { marginTop: 32, gap: 16 },
  successBox: {
    borderRadius: 16,
    backgroundColor: colors.tealSoft,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  successText: { fontSize: 14, color: colors.teal, lineHeight: 20 },
  field: { marginTop: 32, gap: 6 },
  label: { fontSize: 12, fontWeight: "600", color: colors.ink },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    color: colors.ink,
  },
  errorBox: {
    marginTop: 16,
    borderRadius: 16,
    backgroundColor: colors.coralSoft,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: { fontSize: 14, color: colors.coral },
  primaryBtn: {
    marginTop: 20,
    borderRadius: 16,
    backgroundColor: colors.teal,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { fontSize: 14, fontWeight: "600", color: "#fff" },
  disabled: { opacity: 0.6 },
  footer: {
    marginTop: 24,
    textAlign: "center",
    fontSize: 14,
    color: colors.muted,
  },
  footerLink: { fontWeight: "600", color: colors.teal },
});
