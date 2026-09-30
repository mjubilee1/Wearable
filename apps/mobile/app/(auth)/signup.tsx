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
import { INTEREST_OPTIONS } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";

export default function SignupScreen() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [age, setAge] = useState("27");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleInterest(interest: string) {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest].slice(0, 5),
    );
  }

  async function onSubmit() {
    setError(null);
    const parsedAge = Number(age);
    if (!Number.isFinite(parsedAge) || parsedAge < 18 || parsedAge > 99) {
      setError("Enter a valid age (18–99).");
      return;
    }
    if (interests.length < 1) {
      setError("Pick at least one interest.");
      return;
    }

    setSubmitting(true);
    try {
      await signUp({
        email: email.trim(),
        password,
        name,
        age: parsedAge,
        role,
        interests,
      });
      router.replace("/(tabs)");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
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
        <Text style={styles.title}>Create your profile</Text>
        <Text style={styles.subtitle}>
          Your vibes power the wearable score light.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <TextInput value={name} onChangeText={setName} style={styles.input} />
        </View>

        <View style={styles.row}>
          <View style={[styles.field, styles.half]}>
            <Text style={styles.label}>Age</Text>
            <TextInput
              keyboardType="number-pad"
              value={age}
              onChangeText={setAge}
              style={styles.input}
            />
          </View>
          <View style={[styles.field, styles.half]}>
            <Text style={styles.label}>Role</Text>
            <TextInput
              value={role}
              onChangeText={setRole}
              placeholder="Designer"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
          </View>
        </View>

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
          <Text style={styles.label}>Password</Text>
          <TextInput
            secureTextEntry
            autoComplete="new-password"
            value={password}
            onChangeText={setPassword}
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Interests (up to 5)</Text>
          <View style={styles.chips}>
            {INTEREST_OPTIONS.map((interest) => {
              const active = interests.includes(interest);
              return (
                <Pressable
                  key={interest}
                  onPress={() => toggleInterest(interest)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text
                    style={[styles.chipText, active && styles.chipTextActive]}
                  >
                    {interest}
                  </Text>
                </Pressable>
              );
            })}
          </View>
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
            {submitting ? "Creating…" : "Create account"}
          </Text>
        </Pressable>

        <Text style={styles.footer}>
          Already have an account?{" "}
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
  container: { paddingHorizontal: 20, paddingVertical: 40 },
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
  row: { flexDirection: "row", gap: 12 },
  half: { flex: 1 },
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 999,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colors.teal },
  chipText: { fontSize: 12, fontWeight: "500", color: colors.muted },
  chipTextActive: { color: "#fff" },
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
