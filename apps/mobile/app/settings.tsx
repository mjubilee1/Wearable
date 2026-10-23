import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { MemorySettings } from "@/components/MemorySettings";
import { SensingNetworkSettings } from "@/components/SensingNetworkSettings";
import { VoiceReplySettings } from "@/components/VoiceReplySettings";
import { colors } from "@/lib/theme";

export default function SettingsScreen() {
  const router = useRouter();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={() => router.back()} hitSlop={8}>
        <Text style={styles.back}>← Profile</Text>
      </Pressable>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.subtitle}>
        Sensing, memory, and how Nearby Hello uses your contributions.
      </Text>
      <View style={styles.sections}>
        <VoiceReplySettings />
        <MemorySettings />
        <SensingNetworkSettings />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 40 },
  back: { fontSize: 14, color: colors.muted },
  title: {
    marginTop: 12,
    fontSize: 28,
    fontWeight: "700",
    color: colors.ink,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  sections: { marginTop: 24, gap: 24 },
});
