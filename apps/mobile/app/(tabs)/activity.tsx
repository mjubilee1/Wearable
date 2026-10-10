import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { CLIP_RSSI_CLOSE_DBM, isClipCloseEnough } from "@nearby/shared";
import { useClipScan } from "@/lib/clip-scan-context";
import { colors } from "@/lib/theme";

function statusLabel(close: boolean, green: boolean): string {
  if (green) return "Green · close + similar";
  if (close) return "Close · not similar yet";
  return "Not close";
}

function statusColor(close: boolean, green: boolean): string {
  if (green) return "#22c55e";
  if (close) return colors.amberGlow;
  return colors.muted;
}

export default function ActivityScreen() {
  const {
    scanning,
    availabilityMessage,
    liveSightings,
    lastReports,
    scanError,
  } = useClipScan();

  const rows =
    lastReports.length > 0
      ? lastReports
      : liveSightings.map((s) => ({
          remoteClipId: s.clipId,
          rssi: Math.round(s.smoothedRssi),
          timestamp: s.lastSeenAtMs,
          close: isClipCloseEnough(s.smoothedRssi),
          green: false,
        }));

  return (
    <View style={styles.screen}>
      <FlatList
        data={rows}
        keyExtractor={(item) => `${item.remoteClipId}-${item.timestamp}`}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.eyebrow}>Nearby</Text>
            <Text style={styles.title}>Clip radar</Text>
            <Text style={styles.subtitle}>
              Phone-only BLE scan. Manufacturer clips only — no names, no
              profiles. Green means RSSI ≥ {CLIP_RSSI_CLOSE_DBM} dBm and shared
              interests.
            </Text>

            <View style={styles.statusCard}>
              <View style={styles.statusRow}>
                {scanning ? (
                  <ActivityIndicator color={colors.teal} size="small" />
                ) : (
                  <View style={styles.idleDot} />
                )}
                <Text style={styles.statusText}>
                  {scanning ? "Scanning" : "Scan idle"}
                </Text>
              </View>
              {availabilityMessage ? (
                <Text style={styles.hint}>{availabilityMessage}</Text>
              ) : null}
              {scanError ? (
                <Text style={styles.errorText}>{scanError}</Text>
              ) : null}
            </View>

            <Text style={styles.sectionLabel}>Heard clips</Text>
            {rows.length === 0 ? (
              <Text style={styles.hint}>
                Power a XIAO nRF52840 with Stage 1 firmware. Ads must start with
                FF FF N B…
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View
              style={[
                styles.signalDot,
                { backgroundColor: statusColor(item.close, item.green) },
              ]}
            />
            <View style={styles.rowCopy}>
              <Text style={styles.clipId}>{item.remoteClipId}</Text>
              <Text style={styles.meta}>
                {item.rssi} dBm · {statusLabel(item.close, item.green)}
              </Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 40 },
  header: { gap: 8, marginBottom: 12 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.teal,
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.ink },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.muted },
  statusCard: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    gap: 8,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  idleDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.muted,
  },
  statusText: { fontSize: 13, fontWeight: "600", color: colors.ink },
  hint: { fontSize: 12, lineHeight: 18, color: colors.muted },
  errorText: { fontSize: 12, color: colors.coral },
  sectionLabel: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.muted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  signalDot: { width: 12, height: 12, borderRadius: 999 },
  rowCopy: { flex: 1, minWidth: 0 },
  clipId: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
    letterSpacing: 0.5,
  },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
