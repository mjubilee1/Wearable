import { useEffect, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  INTEREST_OPTIONS,
  LOOKING_FOR_OPTIONS,
  PROFILE_PROMPT_BANK,
  VIBE_OPTIONS,
  type ProfilePrompt,
} from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { uploadProfilePhoto } from "@/lib/storage";
import { updateUserProfile } from "@/lib/users";
import { colors } from "@/lib/theme";

export default function ProfileScreen() {
  const { profile, signOut, refreshProfile } = useAuth();
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [role, setRole] = useState("");
  const [bio, setBio] = useState("");
  const [lookingFor, setLookingFor] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [vibes, setVibes] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<ProfilePrompt[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setAge(String(profile.age));
    setRole(profile.role);
    setBio(profile.bio ?? "");
    setLookingFor(profile.lookingFor ?? "");
    setInterests(profile.interests);
    setVibes(profile.vibes ?? []);
    setPrompts(profile.prompts ?? []);
    setPhotoUrl(profile.photoUrl ?? null);
    setDeviceId(profile.deviceId ?? "");
  }, [profile]);

  if (!profile) {
    return (
      <View style={styles.loading}>
        <Text style={styles.muted}>Loading profile…</Text>
      </View>
    );
  }

  function toggleInterest(interest: string) {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest].slice(0, 5),
    );
  }

  function toggleVibe(vibe: string) {
    setVibes((current) =>
      current.includes(vibe)
        ? current.filter((item) => item !== vibe)
        : [...current, vibe].slice(0, 3),
    );
  }

  function addPrompt() {
    if (prompts.length >= 3) return;
    const used = new Set(prompts.map((p) => p.question));
    const nextQ =
      PROFILE_PROMPT_BANK.find((q) => !used.has(q)) ?? PROFILE_PROMPT_BANK[0];
    setPrompts((current) => [
      ...current,
      { id: `local-${Date.now()}`, question: nextQ, answer: "" },
    ]);
  }

  async function onPickPhoto() {
    if (!profile) return;
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setUploading(true);
    try {
      const url = await uploadProfilePhoto(
        profile.id,
        asset.uri,
        asset.mimeType ?? "image/jpeg",
      );
      setPhotoUrl(url);
      await updateUserProfile(profile.id, { photoUrl: url });
      await refreshProfile();
      setMessage("Photo updated.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not upload photo. Check Storage rules.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function onSave() {
    if (!profile) return;
    setError(null);
    setMessage(null);

    const parsedAge = Number(age);
    if (!Number.isFinite(parsedAge) || parsedAge < 18 || parsedAge > 99) {
      setError("Enter a valid age (18–99).");
      return;
    }

    const cleanedPrompts = prompts
      .map((p) => ({
        ...p,
        question: p.question.trim(),
        answer: p.answer.trim(),
      }))
      .filter((p) => p.question && p.answer);

    setSaving(true);
    try {
      await updateUserProfile(profile.id, {
        name,
        age: parsedAge,
        role,
        interests,
        bio,
        lookingFor,
        vibes,
        prompts: cleanedPrompts,
        photoUrl,
        deviceId: deviceId.trim().toUpperCase() || null,
      });
      await refreshProfile();
      setMessage("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile");
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
        <Text style={styles.eyebrow}>Nearby</Text>
        <Text style={styles.title}>Your profile</Text>
        <Text style={styles.subtitle}>
          Share only what you want. Photo, bio, and prompts are voluntary —
          they help walk-by matches feel human.
        </Text>

        <View style={styles.photoRow}>
          <Pressable onPress={onPickPhoto} style={styles.photoBtn}>
            {photoUrl ? (
              <Image source={{ uri: photoUrl }} style={styles.photo} />
            ) : (
              <View
                style={[
                  styles.photo,
                  {
                    backgroundColor: `hsl(${profile.avatarHue}, 55%, 45%)`,
                    alignItems: "center",
                    justifyContent: "center",
                  },
                ]}
              >
                <Text style={styles.initials}>{profile.initials}</Text>
              </View>
            )}
            <Text style={styles.photoEdit}>
              {uploading ? "…" : "Edit"}
            </Text>
          </Pressable>
          <View>
            <Text style={styles.photoName}>{profile.name}</Text>
            <Text style={styles.muted}>{profile.email}</Text>
          </View>
        </View>

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
              style={styles.input}
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Bio (optional)</Text>
          <TextInput
            value={bio}
            onChangeText={(v) => setBio(v.slice(0, 280))}
            multiline
            numberOfLines={3}
            placeholder="A few lines about you — keep it light."
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.textarea]}
          />
          <Text style={styles.hint}>{bio.length}/280</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Looking for (optional)</Text>
          <View style={styles.chips}>
            <Pressable
              onPress={() => setLookingFor("")}
              style={[styles.chip, !lookingFor && styles.chipActive]}
            >
              <Text
                style={[styles.chipText, !lookingFor && styles.chipTextActive]}
              >
                Skip for now
              </Text>
            </Pressable>
            {LOOKING_FOR_OPTIONS.map((option) => {
              const active = lookingFor === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => setLookingFor(option)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text
                    style={[styles.chipText, active && styles.chipTextActive]}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Interests</Text>
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

        <View style={styles.field}>
          <Text style={styles.label}>Vibes (up to 3)</Text>
          <View style={styles.chips}>
            {VIBE_OPTIONS.map((vibe) => {
              const active = vibes.includes(vibe);
              return (
                <Pressable
                  key={vibe}
                  onPress={() => toggleVibe(vibe)}
                  style={[styles.chip, active && styles.chipInk]}
                >
                  <Text
                    style={[styles.chipText, active && styles.chipTextActive]}
                  >
                    {vibe}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.field}>
          <View style={styles.promptHeader}>
            <Text style={styles.label}>Prompts (optional)</Text>
            <Pressable onPress={addPrompt} disabled={prompts.length >= 3}>
              <Text
                style={[
                  styles.addPrompt,
                  prompts.length >= 3 && styles.disabled,
                ]}
              >
                Add prompt
              </Text>
            </Pressable>
          </View>
          {prompts.map((prompt, index) => (
            <View key={prompt.id} style={styles.promptCard}>
              <View style={styles.chips}>
                {PROFILE_PROMPT_BANK.map((q) => {
                  const active = prompt.question === q;
                  return (
                    <Pressable
                      key={q}
                      onPress={() =>
                        setPrompts((current) =>
                          current.map((row, i) =>
                            i === index ? { ...row, question: q } : row,
                          ),
                        )
                      }
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          active && styles.chipTextActive,
                        ]}
                      >
                        {q}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={prompt.answer}
                onChangeText={(v) =>
                  setPrompts((current) =>
                    current.map((row, i) =>
                      i === index
                        ? { ...row, answer: v.slice(0, 160) }
                        : row,
                    ),
                  )
                }
                multiline
                placeholder="Your answer…"
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.textarea]}
              />
              <Pressable
                onPress={() =>
                  setPrompts((current) =>
                    current.filter((_, i) => i !== index),
                  )
                }
              >
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>
            Wearable ID (optional, e.g. A1B2 from NB-A1B2)
          </Text>
          <TextInput
            value={deviceId}
            onChangeText={(v) => setDeviceId(v.toUpperCase())}
            maxLength={4}
            placeholder="A1B2"
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
            style={[styles.input, styles.mono]}
          />
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
            {saving ? "Saving…" : "Save profile"}
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
    marginBottom: 20,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 8,
  },
  photoBtn: { position: "relative" },
  photo: { height: 80, width: 80, borderRadius: 16 },
  photoEdit: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    color: "#fff",
    textAlign: "center",
    fontSize: 10,
    fontWeight: "600",
    paddingVertical: 4,
    overflow: "hidden",
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  initials: { fontSize: 22, fontWeight: "700", color: "#fff" },
  photoName: { fontSize: 16, fontWeight: "600", color: colors.ink },
  muted: { fontSize: 14, color: colors.muted },
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
  textarea: { minHeight: 80, textAlignVertical: "top" },
  mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  hint: { fontSize: 11, color: colors.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 999,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colors.teal },
  chipInk: { backgroundColor: colors.ink },
  chipText: { fontSize: 12, fontWeight: "500", color: colors.muted },
  chipTextActive: { color: "#fff" },
  promptHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  addPrompt: { fontSize: 12, fontWeight: "600", color: colors.teal },
  promptCard: {
    marginTop: 8,
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  remove: { fontSize: 11, fontWeight: "500", color: colors.muted },
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
  disabled: { opacity: 0.4 },
});
