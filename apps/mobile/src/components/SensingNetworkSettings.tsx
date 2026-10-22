import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { NETWORK_CONSENT_VERSION, platformSensingNotes } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";
import {
  listObservationNodes,
  pauseObservationNode,
  registerObservationNode,
  revokeObservationNode,
} from "@/lib/spatial-api";
import {
  readSensingPrefs,
  writeSensingPrefs,
  type SensingPrefs,
} from "@/lib/sensing/session";

export function SensingNetworkSettings() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<SensingPrefs | null>(null);
  const [motion, setMotion] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const notes = platformSensingNotes("MOBILE");

  useEffect(() => {
    void readSensingPrefs().then((stored) => {
      setPrefs(stored);
      setMotion(stored.motion);
    });
  }, []);

  async function participate() {
    if (!user || !prefs) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      const result = await registerObservationNode(token, {
        nodeType: "MOBILE",
        installationId: prefs.installationId,
        claimedCapabilities: [
          "location_foreground",
          "motion_estimate",
          "bluetooth_proximity",
          "wifi_presence",
          "background_location",
        ],
        consent: {
          version: NETWORK_CONSENT_VERSION,
          location: true,
          motion,
        },
      });
      const next: SensingPrefs = {
        ...prefs,
        status: result.node.status,
        location: true,
        motion,
      };
      await writeSensingPrefs(next);
      setPrefs(next);
      setMessage(
        "Foreground sensing is on while Nearby Hello is open. You can pause or revoke it anytime.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not enable sensing.");
    } finally {
      setBusy(false);
    }
  }

  async function update(action: "pause" | "revoke") {
    if (!user || !prefs) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      const existing = await listObservationNodes(token);
      for (const node of existing.nodes) {
        if (action === "pause" && node.status === "ACTIVE") {
          await pauseObservationNode(token, node.id);
        }
        if (action === "revoke" && node.status !== "REVOKED") {
          await revokeObservationNode(token, node.id);
        }
      }
      const next: SensingPrefs = {
        ...prefs,
        status: action === "pause" ? "PAUSED" : "REVOKED",
        location: action !== "revoke",
        motion: action === "revoke" ? false : prefs.motion,
      };
      await writeSensingPrefs(next);
      setPrefs(next);
      setMessage(
        action === "pause"
          ? "Sensing is paused. Nearby Hello will not collect new observations."
          : "Consent is revoked. Collection has stopped.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update sensing.");
    } finally {
      setBusy(false);
    }
  }

  const status =
    prefs?.status === "ACTIVE"
      ? "Participating"
      : prefs?.status === "PAUSED"
        ? "Paused"
        : prefs?.status === "REVOKED"
          ? "Revoked"
          : "Off";

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Sensing network</Text>
      <Text style={styles.body}>
        Optional. Nearby Hello works without it. While the app is open, this
        phone can contribute minimized location observations. Collection stays
        in the foreground and does not scan nearby devices.
      </Text>
      <Text style={styles.meta}>Status: {status}</Text>
      <View style={styles.row}>
        <Text style={styles.body}>Share a motion estimate from this device.</Text>
        <Switch
          value={motion}
          onValueChange={setMotion}
          trackColor={{ true: colors.teal, false: colors.surface }}
        />
      </View>
      <Pressable
        disabled={busy}
        onPress={() => void participate()}
        style={[styles.primary, busy && styles.disabled]}
      >
        <Text style={styles.primaryText}>Participate</Text>
      </Pressable>
      <View style={styles.actions}>
        <Pressable disabled={busy} onPress={() => void update("pause")} style={styles.secondary}>
          <Text style={styles.secondaryText}>Pause</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={() => void update("revoke")} style={styles.secondary}>
          <Text style={styles.secondaryText}>Revoke consent</Text>
        </Pressable>
      </View>
      {message ? <Text style={styles.meta}>{message}</Text> : null}
      {notes.notes.map((note) => (
        <Text key={note} style={styles.note}>
          {note}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  title: { fontSize: 18, fontWeight: "700", color: colors.ink },
  body: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.ink },
  meta: { fontSize: 14, lineHeight: 20, color: colors.muted },
  note: { fontSize: 12, lineHeight: 18, color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  actions: { flexDirection: "row", gap: 12 },
  primary: {
    alignSelf: "flex-start",
    backgroundColor: colors.teal,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryText: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  secondary: {
    borderColor: "rgba(17,24,39,0.15)",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  secondaryText: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.6 },
});
