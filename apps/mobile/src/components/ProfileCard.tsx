import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  nearbyCaption,
  type ConnectionRequestStatus,
  type MatchProfile,
} from "@nearby/shared";
import { CompatibilityScore } from "@/components/CompatibilityScore";
import { colors } from "@/lib/theme";

type ProfileCardProps = {
  profile: MatchProfile;
  selected?: boolean;
  displayScore?: number;
  connectionStatus?: ConnectionRequestStatus | "none";
  onSelect?: () => void;
  onFacilitate?: () => void;
  onSayHello?: () => void;
  facilitateLoading?: boolean;
};

function statusLabel(status: ConnectionRequestStatus | "none" | undefined) {
  if (status === "pending") return "Hello sent";
  if (status === "accepted") return "Connected";
  if (status === "declined") return "Hello sent";
  return null;
}

export function ProfileCard({
  profile,
  selected = false,
  displayScore,
  connectionStatus = "none",
  onSelect,
  onFacilitate,
  onSayHello,
  facilitateLoading,
}: ProfileCardProps) {
  const score = displayScore ?? profile.score;
  const badge = statusLabel(connectionStatus);
  const revealed = connectionStatus === "accepted";
  const canHello =
    connectionStatus === "none" ||
    connectionStatus === "cancelled" ||
    connectionStatus === "expired";

  return (
    <View style={[styles.card, selected && styles.cardSelected]}>
      <Pressable onPress={onSelect}>
        <View style={styles.header}>
          {revealed && profile.photoUrl ? (
            <Image source={{ uri: profile.photoUrl }} style={styles.avatar} />
          ) : (
            <View
              style={[
                styles.avatar,
                {
                  backgroundColor: revealed
                    ? `hsl(${profile.avatarHue}, 55%, 45%)`
                    : "#22c55e",
                },
              ]}
            >
              {revealed ? (
                <Text style={styles.initials}>{profile.initials}</Text>
              ) : null}
            </View>
          )}

          <View style={styles.meta}>
            {revealed ? (
              <>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {profile.name}
                  </Text>
                  <Text style={styles.age}>{profile.age}</Text>
                </View>
                <Text style={styles.role} numberOfLines={1}>
                  {profile.role}
                </Text>
                {profile.bio ? (
                  <Text style={styles.bio} numberOfLines={2}>
                    {profile.bio}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.name}>Someone nearby</Text>
                <Text style={styles.role}>Name stays hidden until you both say hello</Text>
              </>
            )}
          </View>

          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>

        {revealed ? (
        <View style={styles.chips}>
          {profile.interests.map((interest) => (
            <View
              key={interest}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text
                style={[styles.chipText, selected && styles.chipTextSelected]}
              >
                {interest}
              </Text>
            </View>
          ))}
        </View>
        ) : null}

        <CompatibilityScore
          score={score}
          caption={revealed ? profile.vibeCaption : nearbyCaption(score)}
        />
      </Pressable>

      {selected ? (
        <View style={styles.actions}>
          {onFacilitate ? (
            <Pressable
              onPress={onFacilitate}
              disabled={facilitateLoading}
              style={[styles.btn, styles.btnSoft, facilitateLoading && styles.disabled]}
            >
              <Text style={styles.btnSoftText}>
                {facilitateLoading ? "Thinking…" : "Help me say hi"}
              </Text>
            </Pressable>
          ) : null}
          {canHello && onSayHello ? (
            <Pressable onPress={onSayHello} style={[styles.btn, styles.btnPrimary]}>
              <Text style={styles.btnPrimaryText}>Send a hello</Text>
            </Pressable>
          ) : null}
          {!canHello && connectionStatus === "pending" ? (
            <Text style={styles.wait}>
              Waiting for them to review your profile
            </Text>
          ) : null}
          {connectionStatus === "accepted" ? (
            <Text style={styles.connected}>
              You’re connected — see Connections
            </Text>
          ) : null}
        </View>
      ) : null}
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
  cardSelected: {
    borderColor: "rgba(13,148,136,0.3)",
    shadowColor: colors.teal,
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
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
  bio: { marginTop: 4, fontSize: 12, color: "rgba(17,24,39,0.8)" },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: colors.tealSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: "600", color: colors.teal },
  chips: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    borderRadius: 999,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipSelected: { backgroundColor: colors.tealSoft },
  chipText: { fontSize: 12, fontWeight: "500", color: colors.muted },
  chipTextSelected: { color: colors.teal },
  actions: { marginTop: 12, gap: 8 },
  btn: {
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnSoft: {
    borderWidth: 1,
    borderColor: "rgba(13,148,136,0.25)",
    backgroundColor: "rgba(204,251,241,0.6)",
  },
  btnSoftText: { fontSize: 12, fontWeight: "600", color: colors.teal },
  btnPrimary: { backgroundColor: colors.teal },
  btnPrimaryText: { fontSize: 12, fontWeight: "600", color: "#fff" },
  wait: { textAlign: "center", fontSize: 12, color: colors.muted },
  connected: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: "500",
    color: colors.teal,
  },
  disabled: { opacity: 0.6 },
});
