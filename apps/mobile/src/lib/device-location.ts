import type {
  GeoPoint,
  LocationIntelligenceService,
  LocationPermissionState,
  SpatialLocation,
} from "@nearby/shared";
import { isLocationAccuracyUsable } from "@nearby/shared";

const ASKED_KEY = "nearby-location-asked";

let inflight: Promise<GeoPoint | null> | null = null;

async function alreadyAsked(): Promise<boolean> {
  const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
  return (await AsyncStorage.getItem(ASKED_KEY)) === "1";
}

async function markAsked(): Promise<void> {
  const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
  await AsyncStorage.setItem(ASKED_KEY, "1");
}

/** Shows the system location prompt when it is still allowed, then reads one GPS fix. */
export function readDeviceLocation(): Promise<GeoPoint | null> {
  if (inflight) return inflight;
  inflight = readFix().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function readFix(): Promise<GeoPoint | null> {
  try {
    const Location = await import("expo-location");
    const current = await Location.getForegroundPermissionsAsync();
    const permission =
      current.status === Location.PermissionStatus.GRANTED
        ? current
        : await Location.requestForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) return null;
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy ?? undefined,
    };
  } catch (error) {
    console.warn("Location permission needs a rebuilt app", error);
    return null;
  }
}

/** Ask once when Talk opens, so a grant covers later turns. */
export async function offerDeviceLocationOnce(): Promise<void> {
  if (await alreadyAsked()) return;
  await markAsked();
  await readDeviceLocation();
}

/** Ask again only when this turn needs where you are and location is still off. */
export async function locationForTurn(needsLocation: boolean): Promise<GeoPoint | null> {
  if (!needsLocation) {
    await offerDeviceLocationOnce();
    return null;
  }
  await markAsked();
  return readDeviceLocation();
}

const activeSubscriptions = new Set<{ remove(): void }>();

async function mobilePermissionState(): Promise<LocationPermissionState> {
  try {
    const Location = await import("expo-location");
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status === Location.PermissionStatus.GRANTED) return "granted";
    return permission.canAskAgain ? "denied" : "restricted";
  } catch {
    return "unavailable";
  }
}

function asSpatialLocation(position: {
  coords: { latitude: number; longitude: number; accuracy: number | null };
  timestamp: number;
}): SpatialLocation {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy,
    timestamp: new Date(position.timestamp).toISOString(),
  };
}

export const mobileLocationService: LocationIntelligenceService = {
  permissionState: mobilePermissionState,
  async requestPermission() {
    try {
      const Location = await import("expo-location");
      const permission = await Location.requestForegroundPermissionsAsync();
      return permission.status === Location.PermissionStatus.GRANTED;
    } catch {
      return false;
    }
  },
  async getCurrentLocation(options = {}) {
    const Location = await import("expo-location");
    let permission = await Location.getForegroundPermissionsAsync();
    if (
      permission.status !== Location.PermissionStatus.GRANTED &&
      options.requestPermission !== false
    ) {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    if (permission.status !== Location.PermissionStatus.GRANTED) {
      throw new Error(
        permission.canAskAgain
          ? "Location permission was denied."
          : "Location permission is restricted in system settings.",
      );
    }
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const location = asSpatialLocation(position);
    const maximumAccuracy = Number(
      process.env.EXPO_PUBLIC_LOCATION_MAX_ACCURACY_METERS ?? 500,
    );
    if (!isLocationAccuracyUsable(location.accuracyMeters, maximumAccuracy)) {
      throw new Error(
        "Location accuracy is too low for nearby discovery. Search manually or try again.",
      );
    }
    return location;
  },
  async watchLocation(callback) {
    const Location = await import("expo-location");
    if ((await mobilePermissionState()) !== "granted") {
      throw new Error("Location permission has not been granted.");
    }
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: Number(
          process.env.EXPO_PUBLIC_LOCATION_DISTANCE_THRESHOLD_METERS ?? 100,
        ),
        timeInterval: 30_000,
      },
      (position) => {
        const maximumAccuracy = Number(
          process.env.EXPO_PUBLIC_LOCATION_MAX_ACCURACY_METERS ?? 500,
        );
        if (
          !isLocationAccuracyUsable(
            position.coords.accuracy,
            maximumAccuracy,
          )
        ) {
          return;
        }
        callback(asSpatialLocation(position));
      },
    );
    activeSubscriptions.add(subscription);
    return () => {
      subscription.remove();
      activeSubscriptions.delete(subscription);
    };
  },
  stopTracking() {
    for (const subscription of activeSubscriptions) subscription.remove();
    activeSubscriptions.clear();
  },
};
