import type { ReactNode } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import type { PublicProfilePreview } from "@nearby/shared";
import { colors } from "@/lib/theme";

type PublicProfileCardProps = {
  profile: PublicProfilePreview;
  message?: string;
  footer?: ReactNode;
};

function Avatar({ profile }: { profile: PublicProfilePreview }) {
  if (profile.photoUrl) {
    return <Image source={{ uri: profile.photoUrl }} style={styles.avatar} />;
  }

  return (
    <View
      style={[
        styles.avatar,
        { backgroundColor: `hsl(${profile.avatarHue}, 55%, 45%)` },
      ]}
    >
      <Text style={styles.initials}>{profile.initials}</Text>
    </View>
  );
}

export function PublicProfileCard({
  profile,
  message,
  footer,
}: PublicProfileCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Avatar profile={profile} />
        <View style={styles.meta}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {profile.name}
            </Text>
            <Text style={styles.age}>{profile.age}</Text>
          </View>
          <Text style={styles.role} numberOfLines={1}>
            {profile.role}
          </Text>
          {profile.lookingFor ? (
            <Text style={styles.looking}>
              Open to {profile.lookingFor.toLowerCase()}
            </Text>
          ) : null}
        </View>
      </View>

      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

      {(profile.interests.length > 0 || (profile.vibes?.length ?? 0) > 0) && (
        <View style={styles.chips}>
          {profile.vibes?.map((vibe) => (
            <View key={`v-${vibe}`} style={styles.vibeChip}>
              <Text style={styles.vibeText}>{vibe}</Text>
            </View>
          ))}
          {profile.interests.map((interest) => (
            <View key={interest} style={styles.chip}>
              <Text style={styles.chipText}>{interest}</Text>
            </View>
          ))}
        </View>
      )}

      {profile.prompts && profile.prompts.length > 0 ? (
        <View style={styles.prompts}>
          {profile.prompts.slice(0, 2).map((prompt) => (
            <View key={prompt.id} style={styles.prompt}>
              <Text style={styles.promptQ}>{prompt.question}</Text>
              <Text style={styles.promptA}>{prompt.answer}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {message ? (
        <View style={styles.message}>
          <Text style={styles.messageLabel}>Their hello</Text>
          <Text style={styles.messageBody}>“{message}”</Text>
        </View>
      ) : null}

      {footer ? <View style={styles.footer}>{footer}</View> : null}
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
  header: { flexDirection: "row", gap: 14 },
  avatar: {
    height: 56,
    width: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { fontSize: 18, fontWeight: "700", color: "#fff" },
  meta: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  name: { flexShrink: 1, fontSize: 18, fontWeight: "700", color: colors.ink },
  age: { fontSize: 14, fontWeight: "500", color: colors.muted },
  role: { marginTop: 2, fontSize: 14, color: colors.muted },
  looking: { marginTop: 4, fontSize: 12, fontWeight: "500", color: colors.teal },
  bio: { marginTop: 12, fontSize: 14, lineHeight: 20, color: colors.ink },
  chips: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  vibeChip: {
    borderRadius: 999,
    backgroundColor: colors.tealSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  vibeText: { fontSize: 12, fontWeight: "500", color: colors.teal },
  chip: {
    borderRadius: 999,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { fontSize: 12, fontWeight: "500", color: colors.muted },
  prompts: { marginTop: 12, gap: 8 },
  prompt: {
    borderRadius: 16,
    backgroundColor: "rgba(243,244,246,0.8)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  promptQ: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.muted,
  },
  promptA: { marginTop: 2, fontSize: 14, color: colors.ink },
  message: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(13,148,136,0.2)",
    backgroundColor: "rgba(204,251,241,0.4)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  messageLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.teal,
  },
  messageBody: { marginTop: 4, fontSize: 14, lineHeight: 20, color: colors.ink },
  footer: { marginTop: 16 },
});
