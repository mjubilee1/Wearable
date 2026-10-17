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
import { BrandMark } from "@/components/BrandMark";
import { PendantCard } from "@/components/PendantSession";
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
        <BrandMark style={styles.eyebrow} />
        <Text style={styles.title}>Profile</Text>
        <Text style={styles.subtitle}>
          Your account. Connect calendar and other tools under Connectors.
        </Text>

        <Pressable
          onPress={() => router.push("/messages")}
          style={styles.settingsCard}
        >
          <View>
            <Text style={styles.settingsTitle}>Messages</Text>
            <Text style={styles.settingsCopy}>Chat privately with your connections</Text>
          </View>
          <Text style={styles.settingsOpen}>Open</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push("/connectors")}
          style={styles.settingsCard}
        >
          <View>
            <Text style={styles.settingsTitle}>Connectors</Text>
            <Text style={styles.settingsCopy}>Favorites and Google Calendar</Text>
          </View>
          <Text style={styles.settingsOpen}>Open</Text>
        </Pressable>

        <PendantCard />

        <Pressable
          onPress={() => router.push("/settings")}
          style={styles.settingsCard}
        >
          <View>
            <Text style={styles.settingsTitle}>Account settings</Text>
            <Text style={styles.settingsCopy}>
              Phone number, privacy, and saved memories
            </Text>
          </View>
          <Text style={styles.settingsOpen}>Open</Text>
        </Pressable>

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
            <Text style={styles.muted}>{profile.email}</Text>
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
  content: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 40 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.teal,
  },
  title: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: "700",
    color: colors.ink,
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 8,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  muted: { fontSize: 14, color: colors.muted },
  settingsCard: {
    marginTop: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  settingsTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  settingsCopy: { marginTop: 4, fontSize: 13, color: colors.muted },
  settingsOpen: { fontSize: 13, fontWeight: "700", color: colors.teal },
  field: { marginTop: 16, gap: 6 },
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
  email: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  errorBox: {
    marginTop: 16,
    borderRadius: 16,
    backgroundColor: colors.coralSoft,
    padding: 12,
  },
  errorText: { fontSize: 14, color: colors.coral },
  successBox: {
    marginTop: 16,
    borderRadius: 16,
    backgroundColor: colors.tealSoft,
    padding: 12,
  },
  successText: { fontSize: 14, color: colors.teal },
  primaryBtn: {
    marginTop: 20,
    borderRadius: 16,
    backgroundColor: colors.teal,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { fontSize: 14, fontWeight: "600", color: "#fff" },
  signOut: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 14,
    alignItems: "center",
  },
  signOutText: { fontSize: 14, fontWeight: "600", color: colors.ink },
  disabled: { opacity: 0.6 },
});
