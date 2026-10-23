import { useEffect, useState } from "react";
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
import { useRouter } from "expo-router";
import { isEmailLikeName } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { updateUserProfile } from "@/lib/users";
import { colors } from "@/lib/theme";

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, signOut, refreshProfile } = useAuth();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(isEmailLikeName(profile.name, profile.email) ? "" : profile.name);
  }, [profile]);

  if (!profile) {
    return (
      <View style={styles.loading}>
        <Text style={styles.muted}>Loading profile…</Text>
      </View>
    );
  }

  async function onSave() {
    if (!profile) return;
    setError(null);
    setMessage(null);

    const trimmed = name.trim();
    if (!trimmed || isEmailLikeName(trimmed, profile.email)) {
      setError("Enter your first name, not your email.");
      return;
    }

    setSaving(true);
    try {
      await updateUserProfile(profile.id, { name: trimmed });
      await refreshProfile();
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Profile</Text>
        <Text style={styles.subtitle}>
          Your name and email for this account.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>First name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your first name"
            placeholderTextColor={colors.muted}
            autoComplete="given-name"
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <View style={styles.email}>
            <Text style={styles.emailText}>{profile.email}</Text>
          </View>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        {message ? (
          <View style={styles.successBox}>
            <Text style={styles.successText}>{message}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={onSave}
          disabled={saving}
          style={[styles.primaryBtn, saving && styles.disabled]}
        >
          <Text style={styles.primaryBtnText}>
            {saving ? "Saving…" : "Save"}
          </Text>
        </Pressable>

        <View style={styles.divider} />

        <Pressable
          onPress={() => router.push("/settings")}
          style={styles.settingsRow}
        >
          <View style={styles.settingsCopy}>
            <Text style={styles.settingsTitle}>Settings</Text>
            <Text style={styles.settingsHint}>
              Sensing, memory, and preferences
            </Text>
          </View>
          <Text style={styles.settingsChevron}>→</Text>
        </Pressable>

        <Pressable onPress={() => signOut()} style={styles.signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.page },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.page,
  },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.ink,
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 8,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  muted: { fontSize: 14, color: colors.muted },
  field: { marginTop: 16, gap: 6 },
  label: { fontSize: 13, color: colors.muted },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.ink,
  },
  email: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  emailText: { fontSize: 14, color: colors.ink },
  errorBox: {
    marginTop: 16,
    backgroundColor: colors.coralSoft,
    padding: 12,
  },
  errorText: { fontSize: 14, color: colors.coral },
  successBox: {
    marginTop: 16,
    backgroundColor: colors.tealSoft,
    padding: 12,
  },
  successText: { fontSize: 14, color: colors.teal },
  primaryBtn: {
    marginTop: 20,
    alignSelf: "flex-start",
    backgroundColor: colors.ink,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryBtnText: { fontSize: 14, fontWeight: "600", color: "#fff" },
  divider: {
    marginTop: 28,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  settingsRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 4,
  },
  settingsCopy: { flex: 1, gap: 2 },
  settingsTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  settingsHint: { fontSize: 13, color: colors.muted },
  settingsChevron: { fontSize: 16, color: colors.muted },
  signOut: {
    marginTop: 24,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  signOutText: { fontSize: 14, fontWeight: "600", color: colors.ink },
  disabled: { opacity: 0.6 },
});
