import { useEffect, useState } from "react";
import {
  Linking,
  Modal,
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
import {
  CONNECTOR_CATALOG,
  type ConnectorId,
  readConnectorSetup,
  startGoogleCalendarConnect,
  writeConnectorSetup,
} from "@/lib/connectors";
import { colors } from "@/lib/theme";
import { updateUserProfile } from "@/lib/users";

export function ConnectorSetupPrompt() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ConnectorId[]>([
    "google_calendar",
    "google_tasks",
    "gmail",
  ]);
  const [firstName, setFirstName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsName = Boolean(
    profile && isEmailLikeName(profile.name, profile.email || user?.email),
  );
  const choosable = CONNECTOR_CATALOG.filter((item) => !item.locked);
  const locked = CONNECTOR_CATALOG.filter((item) => item.locked);

  useEffect(() => {
    if (loading || !user) {
      setOpen(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const local = await readConnectorSetup(user.uid);
      if (cancelled) return;
      const profileDismissed =
        typeof profile?.connectorSetupDismissedAt === "number"
          ? profile.connectorSetupDismissedAt
          : null;
      if (profileDismissed != null || local.dismissedAt != null) {
        setOpen(false);
        if (profileDismissed != null && local.dismissedAt == null) {
          await writeConnectorSetup(user.uid, {
            favorites: local.favorites.length ? local.favorites : ["notes"],
            dismissedAt: profileDismissed,
          });
        }
        return;
      }
      setOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, profile, loading]);

  function toggle(id: ConnectorId) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  async function rememberDismiss(favorites: ConnectorId[]) {
    if (!user || !profile) return;
    const dismissedAt = Date.now();
    const withNotes = Array.from(new Set<ConnectorId>([...favorites, "notes"]));
    setOpen(false);
    await writeConnectorSetup(user.uid, { favorites: withNotes, dismissedAt });
    await updateUserProfile(profile.id, {
      connectorSetupDismissedAt: dismissedAt,
    }).catch(() => {});
    await refreshProfile();
  }

  async function saveName(required: boolean): Promise<boolean> {
    if (!profile || !needsName) return true;
    const trimmed = firstName.trim();
    if (!trimmed) {
      if (!required) return true;
      setError("Enter your first name.");
      return false;
    }
    if (isEmailLikeName(trimmed, profile.email || user?.email)) {
      setError("Use your first name, not your email.");
      return false;
    }
    await updateUserProfile(profile.id, { name: trimmed });
    await refreshProfile();
    return true;
  }

  async function close() {
    if (!user || busy) return;
    setError(null);
    try {
      await saveName(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your name");
      return;
    }
    await rememberDismiss(selected);
  }

  const wantsGoogle = selected.some((id) =>
    ["google_calendar", "google_tasks", "gmail"].includes(id),
  );

  async function saveAndContinue() {
    if (busy) return;
    setError(null);
    try {
      const saved = await saveName(true);
      if (!saved) return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your name");
      return;
    }
    await rememberDismiss(selected);
    if (wantsGoogle) router.push("/connectors");
  }

  async function saveAndConnectGoogle() {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveName(true);
      if (!saved) {
        setBusy(false);
        return;
      }
      const withGoogle = Array.from(
        new Set<ConnectorId>([
          ...selected,
          "google_calendar",
          "google_tasks",
          "gmail",
        ]),
      );
      await rememberDismiss(withGoogle);
      const url = await startGoogleCalendarConnect(await user.getIdToken());
      await Linking.openURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google connect");
      setBusy(false);
    }
  }

  return (
    <Modal visible={open && Boolean(user)} animationType="fade" transparent>
      <View style={styles.backdrop}>
        <ScrollView contentContainerStyle={styles.sheet} bounces={false}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>Welcome</Text>
              <Text style={styles.title}>Add your favorite connectors</Text>
            </View>
            <Pressable disabled={busy} onPress={() => void close()} style={styles.close}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <Text style={styles.copy}>
            Choose what Nearby should be ready to use. Google unlocks Calendar,
            Tasks, and Gmail in one connect.
          </Text>

          {needsName ? (
            <View style={styles.nameBlock}>
              <Text style={styles.nameLabel}>First name</Text>
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Your first name"
                placeholderTextColor={colors.muted}
                autoComplete="given-name"
                style={styles.input}
              />
              <Text style={styles.hint}>Nearby uses this when it greets you.</Text>
            </View>
          ) : null}

          {choosable.map((item) => {
            const on = selected.includes(item.id);
            return (
              <Pressable
                key={item.id}
                onPress={() => toggle(item.id)}
                style={[styles.option, on && styles.optionOn]}
              >
                <Text style={[styles.check, on && styles.checkOn]}>{on ? "✓" : ""}</Text>
                <View style={styles.optionCopy}>
                  <Text style={styles.optionName}>{item.name}</Text>
                  <Text style={styles.optionCan}>{item.canDo}</Text>
                </View>
              </Pressable>
            );
          })}
          {locked.map((item) => (
            <View key={item.id} style={[styles.option, styles.optionOn]}>
              <Text style={[styles.check, styles.checkOn]}>✓</Text>
              <View style={styles.optionCopy}>
                <Text style={styles.optionName}>{item.name}</Text>
                <Text style={styles.builtIn}>Built in</Text>
                <Text style={styles.optionCan}>{item.canDo}</Text>
              </View>
            </View>
          ))}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {wantsGoogle ? (
            <Pressable
              disabled={busy}
              onPress={() => void saveAndConnectGoogle()}
              style={[styles.primary, busy && styles.disabled]}
            >
              <Text style={styles.primaryText}>
                {busy ? "Opening Google…" : "Save & connect Google"}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            disabled={busy}
            onPress={() => void saveAndContinue()}
            style={[styles.ink, busy && styles.disabled]}
          >
            <Text style={styles.primaryText}>Save favorites</Text>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={() => void close()}
            style={styles.skip}
          >
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 10,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headerCopy: { flex: 1 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.teal,
  },
  title: { marginTop: 6, fontSize: 24, fontWeight: "700", color: colors.ink },
  close: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  closeText: { fontSize: 14, fontWeight: "600", color: colors.ink },
  copy: { fontSize: 14, lineHeight: 20, color: colors.muted },
  nameBlock: { gap: 6, marginTop: 8 },
  nameLabel: { fontSize: 12, fontWeight: "600", color: colors.ink },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.ink,
  },
  hint: { fontSize: 12, color: colors.muted },
  option: {
    flexDirection: "row",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    padding: 12,
  },
  optionOn: { borderColor: colors.teal, backgroundColor: colors.tealSoft },
  check: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    textAlign: "center",
    lineHeight: 18,
    fontSize: 12,
    fontWeight: "700",
    color: "transparent",
  },
  checkOn: {
    borderColor: colors.teal,
    backgroundColor: colors.teal,
    color: "#fff",
  },
  optionCopy: { flex: 1, gap: 2 },
  optionName: { fontSize: 14, fontWeight: "600", color: colors.ink },
  optionCan: { fontSize: 12, color: colors.muted },
  builtIn: {
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "#fff",
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  error: { color: colors.coral, fontSize: 14 },
  primary: {
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: colors.teal,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  ink: {
    borderRadius: 16,
    backgroundColor: colors.ink,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  skip: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  skipText: { color: colors.ink, fontWeight: "700", fontSize: 14 },
  disabled: { opacity: 0.6 },
});
