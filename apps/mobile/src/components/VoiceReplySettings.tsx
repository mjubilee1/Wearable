import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import {
  getVoiceSettings,
  setVoiceRate,
  setVoiceRepliesEnabled,
  VOICE_RATES,
  type VoiceRate,
  type VoiceSettings,
} from "@/lib/speech";
import { colors } from "@/lib/theme";

export function VoiceReplySettings() {
  const [settings, setSettings] = useState<VoiceSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getVoiceSettings().then((next) => {
      if (!cancelled) setSettings(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.title}>Voice replies</Text>
          <Text style={styles.description}>
            Speak each reply out loud. Headphones play it when they're connected;
            otherwise it uses the phone speaker.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Voice replies"
          disabled={!settings}
          value={settings?.enabled ?? true}
          onValueChange={(enabled) => {
            setSettings((current) => (current ? { ...current, enabled } : current));
            void setVoiceRepliesEnabled(enabled);
          }}
          trackColor={{ false: "#d1d5db", true: colors.teal }}
          thumbColor="#ffffff"
        />
      </View>
      <Text style={styles.speedLabel}>Speed</Text>
      <View style={styles.speedRow}>
        {VOICE_RATES.map((rate) => {
          const selected = (settings?.rate ?? 1) === rate;
          return (
            <Pressable
              key={rate}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              disabled={!settings}
              onPress={() => {
                setSettings((current) => (current ? { ...current, rate } : current));
                void setVoiceRate(rate as VoiceRate);
              }}
              style={[styles.speed, selected && styles.speedOn]}
            >
              <Text style={[styles.speedText, selected && styles.speedTextOn]}>
                {rate.toFixed(1)}×
              </Text>
            </Pressable>
          );
        })}
      </View>
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
  headingRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headingCopy: { flex: 1 },
  title: { fontSize: 18, fontWeight: "700", color: colors.ink },
  description: { marginTop: 4, fontSize: 14, lineHeight: 20, color: colors.muted },
  speedLabel: {
    marginTop: 16,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: colors.muted,
  },
  speedRow: { marginTop: 8, flexDirection: "row", gap: 8 },
  speed: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  speedOn: { borderColor: colors.teal, backgroundColor: colors.tealSoft },
  speedText: { fontSize: 14, fontWeight: "700", color: colors.ink },
  speedTextOn: { color: colors.teal },
});
