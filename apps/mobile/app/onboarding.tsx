import { ScrollView, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { PhoneSetup } from "@/components/PhoneSetup";
import { colors } from "@/lib/theme";

export default function OnboardingScreen() {
  const router = useRouter();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>Nearby</Text>
      <Text style={styles.title}>Set up Nearby</Text>
      <Text style={styles.subtitle}>Choose the private number linked to your account.</Text>
      <PhoneSetup onComplete={() => router.replace("/(tabs)/activity")} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 40, gap: 18 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1.8, textTransform: "uppercase", color: colors.teal },
  title: { fontSize: 28, fontWeight: "700", color: colors.ink },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.muted },
});
