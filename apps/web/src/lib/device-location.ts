import type { DeviceLocation } from "@nearby/shared";

const ASKED_KEY = "nearby-location-asked";

let inflight: Promise<DeviceLocation | null> | null = null;

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
export function readDeviceLocation(): Promise<DeviceLocation | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  if (inflight) return inflight;
  inflight = new Promise<DeviceLocation | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
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
export function locationForTurn(needsLocation: boolean): Promise<DeviceLocation | null> {
  if (!needsLocation) {
    offerDeviceLocationOnce();
    return Promise.resolve(null);
  }
  markAsked();
  return readDeviceLocation();
}
