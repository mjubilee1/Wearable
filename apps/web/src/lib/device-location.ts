import type {
  GeoPoint,
  LocationIntelligenceService,
  LocationPermissionState,
  SpatialLocation,
} from "@nearby/shared";
import { isLocationAccuracyUsable } from "@nearby/shared";

const ASKED_KEY = "nearby-location-asked";

let inflight: Promise<GeoPoint | null> | null = null;

function alreadyAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // Private browsing can block storage. The browser still remembers the grant.
  }
}

/** Starts the browser location prompt immediately. Call from the user gesture. */
export function readDeviceLocation(): Promise<GeoPoint | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  if (inflight) return inflight;
  inflight = new Promise<GeoPoint | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Ask once, on the first tap, so a grant covers later turns. */
export function offerDeviceLocationOnce(): void {
  if (typeof window === "undefined" || alreadyAsked()) return;
  markAsked();
  void readDeviceLocation();
}

/**
 * A normal turn does not ask again after the one-time prompt.
 * A turn that needs where you are asks again only if that prompt was declined.
 */
export function locationForTurn(needsLocation: boolean): Promise<GeoPoint | null> {
  if (!needsLocation) {
    offerDeviceLocationOnce();
    return Promise.resolve(null);
  }
  markAsked();
  return readDeviceLocation();
}

const activeWatchIds = new Set<number>();

async function webPermissionState(): Promise<LocationPermissionState> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return "unavailable";
  }
  if (!navigator.permissions?.query) return "unknown";
  try {
    const result = await navigator.permissions.query({
      name: "geolocation",
    });
    return result.state === "granted"
      ? "granted"
      : result.state === "denied"
        ? "denied"
        : "unknown";
  } catch {
    return "unknown";
  }
}

function spatialLocation(position: GeolocationPosition): SpatialLocation {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: Number.isFinite(position.coords.accuracy)
      ? position.coords.accuracy
      : null,
    timestamp: new Date(position.timestamp).toISOString(),
  };
}

function currentSpatialLocation(): Promise<SpatialLocation> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(spatialLocation(position)),
      (error) => reject(new Error(error.message || "Location is unavailable.")),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });
}

export const browserLocationService: LocationIntelligenceService = {
  permissionState: webPermissionState,
  async requestPermission() {
    if ((await webPermissionState()) === "unavailable") return false;
    try {
      await currentSpatialLocation();
      return true;
    } catch {
      return false;
    }
  },
  async getCurrentLocation(options = {}) {
    const state = await webPermissionState();
    if (state === "unavailable") throw new Error("Location is unavailable.");
    if (state !== "granted" && options.requestPermission === false) {
      throw new Error("Location permission has not been granted.");
    }
    const location = await currentSpatialLocation();
    const maximumAccuracy = Number(
      process.env.NEXT_PUBLIC_LOCATION_MAX_ACCURACY_METERS ?? 500,
    );
    if (!isLocationAccuracyUsable(location.accuracyMeters, maximumAccuracy)) {
      throw new Error(
        "Location accuracy is too low for nearby discovery. Search manually or try again.",
      );
    }
    return location;
  },
  async watchLocation(callback) {
    if ((await webPermissionState()) !== "granted") {
      throw new Error("Location permission has not been granted.");
    }
    const threshold = Number(
      process.env.NEXT_PUBLIC_LOCATION_DISTANCE_THRESHOLD_METERS ?? 100,
    );
    const maximumAccuracy = Number(
      process.env.NEXT_PUBLIC_LOCATION_MAX_ACCURACY_METERS ?? 500,
    );
    let previous: SpatialLocation | null = null;
    const id = navigator.geolocation.watchPosition(
      (position) => {
        const next = spatialLocation(position);
        if (!isLocationAccuracyUsable(next.accuracyMeters, maximumAccuracy)) {
          return;
        }
        if (previous) {
          const latitudeMeters =
            (next.latitude - previous.latitude) * 111_320;
          const longitudeMeters =
            (next.longitude - previous.longitude) *
            111_320 *
            Math.cos((next.latitude * Math.PI) / 180);
          if (Math.hypot(latitudeMeters, longitudeMeters) < threshold) return;
        }
        previous = next;
        callback(next);
      },
      () => undefined,
      { enableHighAccuracy: false, timeout: 20_000, maximumAge: 60_000 },
    );
    activeWatchIds.add(id);
    return () => {
      navigator.geolocation.clearWatch(id);
      activeWatchIds.delete(id);
    };
  },
  stopTracking() {
    for (const id of activeWatchIds) navigator.geolocation.clearWatch(id);
    activeWatchIds.clear();
  },
};
