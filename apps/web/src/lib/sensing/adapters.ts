import type {
  ForegroundLocationAdapter,
  ForegroundMotionAdapter,
  LocationSample,
  SpatialSensorAdapter,
} from "@nearby/shared";
import { unsupportedProximityAdapter } from "@nearby/shared";

type MotionPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export function createWebLocationAdapter(): ForegroundLocationAdapter {
  let watchId: number | null = null;
  let latest: LocationSample | null = null;

  function remember(position: GeolocationPosition) {
    latest = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy,
    };
  }

  return {
    sensorType: "location",
    async isSupported() {
      return typeof navigator !== "undefined" && "geolocation" in navigator;
    },
    async requestPermission() {
      if (!navigator.geolocation) return false;
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            remember(position);
            resolve(true);
          },
          () => resolve(false),
          { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
        );
      });
    },
    async start() {
      if (!navigator.geolocation || watchId != null) return;
      watchId = navigator.geolocation.watchPosition(
        remember,
        () => {},
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 20_000 },
      );
    },
    async stop() {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    },
    async readSample() {
      return latest;
    },
  };
}

export function createWebMotionAdapter(): ForegroundMotionAdapter {
  let permitted = false;
  return {
    sensorType: "motion",
    async isSupported() {
      return typeof window !== "undefined" && "DeviceMotionEvent" in window;
    },
    async requestPermission() {
      const constructor = DeviceMotionEvent as MotionPermission;
      if (!constructor.requestPermission) {
        permitted = true;
        return true;
      }
      try {
        permitted = (await constructor.requestPermission()) === "granted";
      } catch {
        permitted = false;
      }
      return permitted;
    },
    async start() {},
    async stop() {},
    async readEstimate() {
      if (!permitted) return null;
      const magnitudes: number[] = [];
      await new Promise<void>((resolve) => {
        const onMotion = (event: DeviceMotionEvent) => {
          const acceleration = event.accelerationIncludingGravity;
          if (!acceleration) return;
          magnitudes.push(
            Math.sqrt(
              (acceleration.x ?? 0) ** 2 +
                (acceleration.y ?? 0) ** 2 +
                (acceleration.z ?? 0) ** 2,
            ),
          );
        };
        window.addEventListener("devicemotion", onMotion);
        window.setTimeout(() => {
          window.removeEventListener("devicemotion", onMotion);
          resolve();
        }, 1_200);
      });
      if (magnitudes.length < 2) {
        return {
          accelerationVariance: null,
          displacementMeters: null,
          intervalMs: 1_200,
        };
      }
      const average =
        magnitudes.reduce((sum, value) => sum + value, 0) / magnitudes.length;
      const variance =
        magnitudes.reduce((sum, value) => sum + (value - average) ** 2, 0) /
        magnitudes.length;
      return {
        accelerationVariance: variance,
        displacementMeters: null,
        intervalMs: 1_200,
      };
    },
  };
}

export function createWebBluetoothAdapter(): SpatialSensorAdapter {
  return unsupportedProximityAdapter("bluetooth");
}

export function createWebWifiAdapter(): SpatialSensorAdapter {
  return unsupportedProximityAdapter("wifi");
}
