import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type {
  GeoPoint,
  LocationPermissionState,
  NearbyPlacesResponse,
  PlaceSearchResult,
} from "@nearby/shared";
import { locationPermissionMessage } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";
import { mobileLocationService } from "@/lib/device-location";
import {
  getNearbyPlaces,
  searchSpatialLocations,
} from "@/lib/spatial-api";

const CATEGORIES = [
  ["", "All"],
  ["cafe", "Cafés"],
  ["restaurant", "Food"],
  ["bar", "Social"],
  ["park", "Parks"],
  ["library", "Libraries"],
] as const;

function distanceLabel(meters: number): string {
  if (meters < 1_000) return `${meters} m away`;
  return `${(meters / 1_000).toFixed(1)} km away`;
}

export function NearbyPlacesSection({
  initialLocation,
}: {
  initialLocation: GeoPoint;
}) {
  const { user } = useAuth();
  const [center, setCenter] = useState(initialLocation);
  const [permission, setPermission] =
    useState<LocationPermissionState>("unknown");
  const [category, setCategory] = useState("");
  const categoryRef = useRef("");
  const [response, setResponse] = useState<NearbyPlacesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [centerLabel, setCenterLabel] = useState("Washington, DC example area");

  const loadPlaces = useCallback(
    async (location: GeoPoint, nextCategory = categoryRef.current) => {
      if (!user) return;
      setBusy(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        setResponse(
          await getNearbyPlaces(token, location, {
            category: nextCategory || null,
            radiusMeters: 1_000,
            limit: 20,
          }),
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load nearby places.",
        );
      } finally {
        setBusy(false);
      }
    },
    [user],
  );

  useEffect(() => {
    setCenter(initialLocation);
    void loadPlaces(initialLocation);
  }, [initialLocation, loadPlaces]);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const state = await mobileLocationService.permissionState();
      if (cancelled) return;
      setPermission(state);
      if (state !== "granted") return;
      try {
        const current = await mobileLocationService.getCurrentLocation({
          requestPermission: false,
        });
        if (cancelled) return;
        const next = {
          latitude: current.latitude,
          longitude: current.longitude,
          ...(current.accuracyMeters !== null
            ? { accuracyMeters: current.accuracyMeters }
            : {}),
        };
        setCenter(next);
        setCenterLabel("your approximate location");
        await loadPlaces(next);
        stop = await mobileLocationService.watchLocation((changed) => {
          const watched = {
            latitude: changed.latitude,
            longitude: changed.longitude,
            ...(changed.accuracyMeters !== null
              ? { accuracyMeters: changed.accuracyMeters }
              : {}),
          };
          setCenter(watched);
          setCenterLabel("your approximate location");
          void loadPlaces(watched);
        });
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Location is unavailable.",
        );
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [loadPlaces]);

  const manualSearch = async () => {
    if (!user || search.trim().length < 2) return;
    setSearching(true);
    setSearchAttempted(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      setSearchResults(await searchSpatialLocations(token, search));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Location search failed.",
      );
    } finally {
      setSearching(false);
    }
  };

  const refreshPlaces = async () => {
    if ((await mobileLocationService.permissionState()) === "granted") {
      try {
        const current = await mobileLocationService.getCurrentLocation({
          requestPermission: false,
        });
        const next = {
          latitude: current.latitude,
          longitude: current.longitude,
          ...(current.accuracyMeters !== null
            ? { accuracyMeters: current.accuracyMeters }
            : {}),
        };
        setCenter(next);
        setCenterLabel("your approximate location");
        await loadPlaces(next);
        return;
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Location is unavailable.",
        );
      }
    }
    await loadPlaces(center);
  };

  const chooseSearchResult = (result: PlaceSearchResult) => {
    const next = {
      latitude: result.latitude,
      longitude: result.longitude,
    };
    setCenter(next);
    setCenterLabel(result.label);
    setSearchResults([]);
    setSearchAttempted(false);
    void loadPlaces(next);
  };

  const permissionText = locationPermissionMessage(permission);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Places nearby</Text>
          <Text style={styles.body}>
            Real place names and categories from OpenStreetMap around{" "}
            {centerLabel}. No ratings or live-condition claims.
          </Text>
        </View>
        <Pressable
          style={styles.refresh}
          disabled={busy}
          onPress={() => void refreshPlaces()}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.teal} />
          ) : (
            <Text style={styles.refreshText}>Refresh</Text>
          )}
        </Pressable>
      </View>

      {permissionText ? (
        <Text style={styles.permission}>{permissionText}</Text>
      ) : null}

      <View style={styles.searchRow}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => void manualSearch()}
          placeholder="Search a city, address, or place"
          placeholderTextColor={colors.muted}
          style={styles.input}
          returnKeyType="search"
        />
        <Pressable
          style={[
            styles.searchButton,
            (searching || search.trim().length < 2) && styles.disabled,
          ]}
          disabled={searching || search.trim().length < 2}
          onPress={() => void manualSearch()}
        >
          <Text style={styles.searchButtonText}>Search</Text>
        </Pressable>
      </View>
      {searchResults.length ? (
        <View style={styles.results}>
          {searchResults.map((result) => (
            <Pressable
              key={result.id}
              style={styles.result}
              onPress={() => chooseSearchResult(result)}
            >
              <Text style={styles.resultText}>{result.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {searchAttempted && !searching && !searchResults.length ? (
        <Text style={styles.noSearchResults}>No locations found.</Text>
      ) : null}

      <View style={styles.categories}>
        {CATEGORIES.map(([value, label]) => (
          <Pressable
            key={value || "all"}
            style={[styles.pill, category === value && styles.activePill]}
            onPress={() => {
              setCategory(value);
              categoryRef.current = value;
              void loadPlaces(center, value);
            }}
          >
            <Text
              style={[
                styles.pillText,
                category === value && styles.activePillText,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!busy && response && !response.places.length ? (
        <Text style={styles.empty}>
          No sourced places were found in this area for that category.
        </Text>
      ) : null}
      <View style={styles.placeList}>
        {(response?.places ?? []).map((place) => (
          <View key={place.id} style={styles.place}>
            <View style={styles.placeHeader}>
              <View style={styles.headerCopy}>
                <Text style={styles.placeName}>{place.name}</Text>
                <Text style={styles.category}>
                  {place.category.replaceAll("_", " ")}
                </Text>
              </View>
              <Text style={styles.distance}>
                {distanceLabel(place.distanceMeters)}
              </Text>
            </View>
            {place.address ? (
              <Text style={styles.address}>{place.address}</Text>
            ) : null}
          </View>
        ))}
      </View>
      {response ? (
        <Text style={styles.attribution}>
          {response.attribution} · refreshed{" "}
          {new Date(response.fetchedAt).toLocaleString()}
          {response.cacheStatus === "stale"
            ? " · cached data shown while the provider is unavailable"
            : ""}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  headerCopy: { flex: 1 },
  title: { color: colors.ink, fontSize: 17, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  refresh: {
    minWidth: 68,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 11,
  },
  refreshText: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  permission: {
    color: colors.muted,
    backgroundColor: colors.surface,
    borderRadius: 11,
    padding: 10,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 12,
  },
  searchRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    fontSize: 12,
  },
  searchButton: {
    backgroundColor: colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    paddingHorizontal: 13,
  },
  searchButtonText: { color: "white", fontSize: 12, fontWeight: "800" },
  disabled: { opacity: 0.45 },
  results: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginTop: 7,
  },
  result: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    padding: 10,
  },
  resultText: { color: colors.ink, fontSize: 12, lineHeight: 17 },
  noSearchResults: { color: colors.muted, fontSize: 11, marginTop: 7 },
  categories: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 14,
  },
  pill: {
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  activePill: { backgroundColor: colors.teal },
  pillText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  activePillText: { color: "white" },
  error: {
    color: colors.coral,
    backgroundColor: colors.coralSoft,
    borderRadius: 12,
    padding: 10,
    fontSize: 12,
    marginTop: 13,
  },
  empty: {
    color: colors.muted,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 12,
    marginTop: 13,
  },
  placeList: { gap: 9, marginTop: 14 },
  place: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 13,
  },
  placeHeader: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  placeName: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  category: {
    color: colors.muted,
    fontSize: 10,
    textTransform: "capitalize",
    marginTop: 3,
  },
  distance: { color: colors.teal, fontSize: 10, fontWeight: "800" },
  address: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 9 },
  attribution: {
    color: colors.muted,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 13,
  },
});
