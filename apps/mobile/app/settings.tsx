import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { BrandMark } from "@/components/BrandMark";
import { MemorySettings } from "@/components/MemorySettings";
import { colors } from "@/lib/theme";
import { PhoneSetup } from "@/components/PhoneSetup";

export default function SettingsScreen() {
  const router = useRouter();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headingRow}>
        <View>
          <BrandMark style={styles.eyebrow} />
          <Text style={styles.title}>Settings</Text>
        </View>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back to profile</Text>
        </Pressable>
      </View>
      <PhoneSetup />
      <MemorySettings />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 40, gap: 24 },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.teal,
  },
  title: { marginTop: 4, fontSize: 28, fontWeight: "700", color: colors.ink },
  back: { fontSize: 13, fontWeight: "700", color: colors.teal },
});
