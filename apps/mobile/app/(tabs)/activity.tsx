import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/lib/theme";

export default function ActivityScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>Nearby</Text>
        <Text style={styles.title}>Activity</Text>
        <Text style={styles.subtitle}>
          Recent walk-bys and score moments.
        </Text>
        <View style={styles.card}>
          <Text style={styles.cardText}>Coming soon</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 16, paddingTop: 56, gap: 8 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.teal,
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.ink },
  subtitle: { fontSize: 14, color: colors.muted, marginBottom: 16 },
  card: {
    borderRadius: 16,
    backgroundColor: colors.card,
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  cardText: { fontSize: 14, color: colors.muted },
});
