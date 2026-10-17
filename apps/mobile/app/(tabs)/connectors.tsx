import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import {
  CONNECTOR_CATALOG,
  type ConnectorId,
  disconnectGoogleCalendar,
  fetchGoogleCalendarStatus,
  readConnectorSetup,
  startGoogleCalendarConnect,
  writeConnectorSetup,
} from "@/lib/connectors";
import { colors } from "@/lib/theme";

export default function ConnectorsScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<ConnectorId[]>([]);

  useEffect(() => {
    if (!user) return;
    void readConnectorSetup(user.uid).then((prefs) => setFavorites(prefs.favorites));
  }, [user]);

  const googleQuery = useQuery({
    queryKey: ["google-calendar", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) return { configured: false, connected: false, email: null };
      return fetchGoogleCalendarStatus(await user.getIdToken());
    },
  });

  const google = googleQuery.data;
  const googleItems = CONNECTOR_CATALOG.filter((item) => item.googleBundle);
  const otherItems = CONNECTOR_CATALOG.filter((item) => !item.googleBundle);

  async function toggleFavorite(id: ConnectorId) {
    if (!user) return;
    const prefs = await readConnectorSetup(user.uid);
    const next = favorites.includes(id)
      ? favorites.filter((item) => item !== id)
      : [...favorites, id];
    await writeConnectorSetup(user.uid, {
      favorites: next,
      dismissedAt: prefs.dismissedAt ?? Date.now(),
    });
    setFavorites(next);
  }

  async function connectGoogle() {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      const url = await startGoogleCalendarConnect(await user.getIdToken());
      await Linking.openURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google connect");
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnectGoogle() {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectGoogleCalendar(await user.getIdToken());
      await queryClient.invalidateQueries({ queryKey: ["google-calendar"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={googleQuery.isRefetching}
          onRefresh={() => void googleQuery.refetch()}
          tintColor={colors.teal}
        />
      }
    >
      <Text style={styles.eyebrow}>Nearby</Text>
      <Text style={styles.title}>Connectors</Text>
      <Text style={styles.subtitle}>
        Pick what Nearby may use. A spoken request in Talk runs the tool.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.cardTitle}>Google</Text>
          {google?.connected ? (
            <Text style={styles.badge}>Connected</Text>
          ) : null}
        </View>
        <Text style={styles.copy}>
          One connect for Calendar, Tasks, and Gmail. Google opens in the
          browser and finishes on the website. Come back here and pull to
          refresh if the status is still waiting.
        </Text>
        {google?.connected && google.email ? (
          <Text style={styles.email}>{google.email}</Text>
        ) : null}
        {google?.configured === false ? (
          <Text style={styles.error}>
            Add Google OAuth keys on the API to enable this.
          </Text>
        ) : null}

        {googleItems.map((item) => {
          const isFavorite = favorites.includes(item.id);
          return (
            <View key={item.id} style={styles.item}>
              <View style={styles.itemCopy}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemCan}>{item.canDo}</Text>
              </View>
              <Pressable
                onPress={() => void toggleFavorite(item.id)}
                style={[styles.favorite, isFavorite && styles.favoriteOn]}
              >
                <Text style={[styles.favoriteText, isFavorite && styles.favoriteTextOn]}>
                  {isFavorite ? "Favorite" : "Add favorite"}
                </Text>
              </Pressable>
            </View>
          );
        })}

        {google?.connected ? (
          <Pressable
            disabled={busy}
            onPress={() => void onDisconnectGoogle()}
            style={styles.disconnect}
          >
            <Text style={styles.disconnectText}>Disconnect Google</Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={busy || google?.configured === false}
            onPress={() => void connectGoogle()}
            style={[styles.connect, (busy || google?.configured === false) && styles.disabled]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.connectText}>Connect Google</Text>
            )}
          </Pressable>
        )}
      </View>

      {otherItems.map((item) => (
        <View key={item.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <Text style={styles.builtIn}>Built in</Text>
          </View>
          <Text style={styles.copy}>{item.canDo}</Text>
          <Text style={styles.on}>On</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 40, gap: 12 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.teal,
  },
  title: { fontSize: 32, fontWeight: "700", color: colors.ink },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.muted },
  error: { color: colors.coral, fontSize: 14 },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 16,
    gap: 10,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  badge: {
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: colors.tealSoft,
    color: colors.teal,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  copy: { fontSize: 14, lineHeight: 20, color: colors.muted },
  email: { fontSize: 12, color: colors.muted },
  item: {
    borderRadius: 16,
    backgroundColor: colors.surface,
    padding: 12,
    gap: 8,
  },
  itemCopy: { gap: 2 },
  itemName: { fontSize: 14, fontWeight: "600", color: colors.ink },
  itemCan: { fontSize: 12, color: colors.muted },
  favorite: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  favoriteOn: { backgroundColor: colors.tealSoft },
  favoriteText: { fontSize: 12, fontWeight: "600", color: colors.muted },
  favoriteTextOn: { color: colors.teal },
  connect: {
    borderRadius: 16,
    backgroundColor: colors.ink,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  connectText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  disconnect: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  disconnectText: { color: colors.ink, fontWeight: "700", fontSize: 14 },
  disabled: { opacity: 0.6 },
  builtIn: {
    borderRadius: 999,
    backgroundColor: colors.surface,
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  on: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: colors.tealSoft,
    color: colors.teal,
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
