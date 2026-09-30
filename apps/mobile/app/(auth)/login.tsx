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
import { Link, useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/(tabs)");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
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
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to see who’s around you.</Text>

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

        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Password</Text>
            <Link href="/(auth)/forgot-password" asChild>
              <Pressable>
                <Text style={styles.link}>Forgot password?</Text>
              </Pressable>
            </Link>
          </View>
          <TextInput
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
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
            {submitting ? "Signing in…" : "Sign in"}
          </Text>
        </Pressable>

        <Text style={styles.footer}>
          New here?{" "}
          <Link href="/(auth)/signup" style={styles.footerLink}>
            Create an account
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
  field: { marginTop: 16, gap: 6 },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: { fontSize: 12, fontWeight: "600", color: colors.ink },
  link: { fontSize: 12, fontWeight: "500", color: colors.teal },
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
