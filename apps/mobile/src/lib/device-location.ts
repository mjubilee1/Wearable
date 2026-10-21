import type { GeoPoint } from "@nearby/shared";

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
