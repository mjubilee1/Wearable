import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  DEFAULT_PLACE_RADIUS_METERS,
  intentForPlaceCategory,
  intentTitle,
  type NearbySpatialPlace,
  type PlaceSearchResult,
} from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { getNearbyPlaces, searchSpatialLocations } from "@/lib/spatial-api";
import { useSpatialLocation } from "@/lib/use-spatial-location";
import { colors } from "@/lib/theme";

function project(
  place: NearbySpatialPlace,
  center: { latitude: number; longitude: number },
  radiusMeters: number,
): { x: number; y: number } {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng =
    111_320 * Math.cos((center.latitude * Math.PI) / 180);
  const dx =
    ((place.longitude - center.longitude) * metersPerDegreeLng) / radiusMeters;
  const dy =
    ((place.latitude - center.latitude) * metersPerDegreeLat) / radiusMeters;
  return {
    x: 50 + dx * 42,
    y: 50 - dy * 42,
  };
}

export function ExploreMap() {
  const { user } = useAuth();
  const router = useRouter();
  const spatial = useSpatialLocation();
  const [places, setPlaces] = useState<NearbySpatialPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !spatial.ready) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      const response = await getNearbyPlaces(token, spatial.location, {
        radiusMeters: DEFAULT_PLACE_RADIUS_METERS,
        limit: 40,
      });
      setPlaces(response.places);
      if (response.cacheStatus === "stale") {
        setMessage("Showing saved places while the map service is down.");
      }
    } catch (caught) {
      setPlaces([]);
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Could not load nearby places.",
      );
    } finally {
      setBusy(false);
    }
  }, [spatial.location, spatial.ready, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runSearch() {
    if (!user || search.trim().length < 2) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      setResults(await searchSpatialLocations(token, search));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  const pins = useMemo(
    () =>
      places.map((place) => ({
        place,
        point: project(place, spatial.location, DEFAULT_PLACE_RADIUS_METERS),
      })),
    [places, spatial.location],
  );

  const selected = places.find((place) => place.id === selectedId) ?? null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Explore your surroundings</Text>
        <Text style={styles.lead}>
          Nearby places and observations on a local map. Pins are relative—not
          a live traffic or occupancy layer.
        </Text>
        <Text style={styles.meta}>
          {spatial.label}
          {busy ? " · Loading…" : ` · ${places.length} places`}
        </Text>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => void runSearch()}
          placeholder="Search a neighborhood or place"
          placeholderTextColor={colors.muted}
          style={styles.input}
          returnKeyType="search"
        />
        <Pressable
          style={[styles.chip, (busy || search.trim().length < 2) && styles.disabled]}
          disabled={busy || search.trim().length < 2}
          onPress={() => void runSearch()}
        >
          <Text style={styles.chipText}>Search</Text>
        </Pressable>
        <Pressable
          style={[styles.chip, busy && styles.disabled]}
          disabled={busy}
          onPress={() =>
            void spatial.requestDeviceLocation().then(() => load())
          }
        >
          <Text style={styles.chipText}>Use my location</Text>
        </Pressable>
      </View>

      {results.length ? (
        <View style={styles.results}>
          {results.map((result) => (
            <Pressable
              key={result.id}
              style={styles.resultRow}
              onPress={() => {
                spatial.setManual(
                  { latitude: result.latitude, longitude: result.longitude },
                  result.label,
                );
                setResults([]);
                setSearch("");
              }}
            >
              <Text style={styles.resultText}>{result.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.map} accessibilityLabel="Interactive discovery map">
        <View style={styles.axisH} />
        <View style={styles.axisV} />
        <View style={styles.you}>
          <Text style={styles.youText}>You</Text>
        </View>
        {pins.map(({ place, point }) => {
          const active = place.id === selectedId;
          const clampedX = Math.min(94, Math.max(6, point.x));
          const clampedY = Math.min(94, Math.max(6, point.y));
          return (
            <Pressable
              key={place.id}
              accessibilityLabel={place.name}
              onPress={() => setSelectedId(place.id)}
              style={[
                styles.pin,
                active ? styles.pinActive : styles.pinIdle,
                { left: `${clampedX}%`, top: `${clampedY}%` },
              ]}
            />
          );
        })}
        <Text style={styles.mapHint}>
          Relative positions within ~1 mile. OpenStreetMap place identity only.
        </Text>
      </View>

      {message ? <Text style={styles.meta}>{message}</Text> : null}

      {selected ? (
        <View style={styles.preview}>
          <Text style={styles.intent}>
            {intentTitle(intentForPlaceCategory(selected.category))}
          </Text>
          <Text style={styles.previewTitle}>{selected.name}</Text>
          <Text style={styles.meta}>
            {selected.category.replaceAll("_", " ")}
          </Text>
          <Pressable
            onPress={() =>
              router.push(`/places/${encodeURIComponent(selected.id)}`)
            }
          >
            <Text style={styles.openLink}>Open place intelligence</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.meta}>
          Tap a pin to preview a place, then open its intelligence profile.
        </Text>
      )}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 40,
    gap: 16,
  },
  header: { gap: 8, marginBottom: 4 },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: -0.4,
  },
  lead: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  meta: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  searchRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: {
    flexGrow: 1,
    minWidth: 160,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(17,24,39,0.15)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    fontSize: 14,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(17,24,39,0.15)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chipText: { color: colors.ink, fontSize: 14 },
  disabled: { opacity: 0.5 },
  results: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(17,24,39,0.1)",
  },
  resultRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(17,24,39,0.1)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  resultText: { color: colors.ink, fontSize: 14 },
  map: {
    aspectRatio: 1,
    width: "100%",
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(17,24,39,0.1)",
    backgroundColor: "#eef2f0",
    position: "relative",
  },
  axisH: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(17,24,39,0.2)",
  },
  axisV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "50%",
    width: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(17,24,39,0.2)",
  },
  you: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 32,
    height: 32,
    marginLeft: -16,
    marginTop: -16,
    borderRadius: 16,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  youText: { color: "white", fontSize: 10, fontWeight: "700" },
  pin: {
    position: "absolute",
    marginLeft: -5,
    marginTop: -5,
    borderRadius: 999,
    zIndex: 10,
  },
  pinIdle: {
    width: 10,
    height: 10,
    backgroundColor: colors.teal,
  },
  pinActive: {
    width: 12,
    height: 12,
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: "white",
    zIndex: 20,
  },
  mapHint: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    color: colors.muted,
    fontSize: 12,
  },
  preview: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(17,24,39,0.1)",
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 6,
  },
  intent: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  previewTitle: { color: colors.ink, fontSize: 18, fontWeight: "600" },
  openLink: {
    marginTop: 6,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
