import { StyleSheet, Text, View } from "react-native";
import {
  trustLabelCopy,
  trustLabelHint,
  type TrustLabel,
} from "@nearby/shared";
import { colors } from "@/lib/theme";

export function TrustBadge({
  label,
  showHint = false,
}: {
  label: TrustLabel;
  showHint?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <Text
        style={[
          styles.label,
          label === "verified" ? styles.verified : styles.muted,
        ]}
      >
        {trustLabelCopy(label)}
      </Text>
      {showHint ? (
        <Text style={styles.hint}>{trustLabelHint(label)}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  label: { fontSize: 12, fontWeight: "600" },
  verified: { color: colors.ink },
  muted: { color: colors.muted },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 16 },
});
