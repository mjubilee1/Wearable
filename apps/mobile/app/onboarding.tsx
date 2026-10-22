import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { BrandMark } from "@/components/BrandMark";
import { colors } from "@/lib/theme";

export default function OnboardingScreen() {
  const router = useRouter();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <BrandMark style={styles.eyebrow} />
      <Text style={styles.title}>Set up Nearby</Text>
      <Text style={styles.subtitle}>Your account is ready. Open Nearby Hello when you want to look around.</Text>
      <Pressable onPress={() => router.replace("/(tabs)/nearby")} style={styles.primary}>
        <Text style={styles.primaryText}>Continue</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 40, gap: 18 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1.8, textTransform: "uppercase", color: colors.teal },
  title: { fontSize: 28, fontWeight: "700", color: colors.ink },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.muted },
  primary: {
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: colors.teal,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
