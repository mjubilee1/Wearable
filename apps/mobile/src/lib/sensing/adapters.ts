import type {
  ForegroundLocationAdapter,
  ForegroundMotionAdapter,
  LocationSample,
  SpatialSensorAdapter,
} from "@nearby/shared";
import { unsupportedProximityAdapter } from "@nearby/shared";

export function createMobileLocationAdapter(): ForegroundLocationAdapter {
  let subscription: { remove: () => void } | null = null;
  let latest: LocationSample | null = null;

  return {
    sensorType: "location",
    async isSupported() {
      try {
        const Location = await import("expo-location");
        return Location.hasServicesEnabledAsync();
      } catch {
        return false;
      }
    },
    async requestPermission() {
      const Location = await import("expo-location");
      const current = await Location.getForegroundPermissionsAsync();
      const permission =
        current.status === Location.PermissionStatus.GRANTED
          ? current
          : await Location.requestForegroundPermissionsAsync();
      if (permission.status !== Location.PermissionStatus.GRANTED) return false;
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      latest = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy ?? 100,
      };
      return true;
    },
    async start() {
      if (subscription) return;
      const Location = await import("expo-location");
      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 75,
          timeInterval: 60_000,
        },
        (position) => {
          latest = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy ?? 100,
          };
        },
      );
    },
    async stop() {
      subscription?.remove();
      subscription = null;
    },
    async readSample() {
      return latest;
    },
  };
}

type AccelerometerModule = {
  isAvailableAsync: () => Promise<boolean>;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  setUpdateInterval: (intervalMs: number) => void;
  addListener: (
    listener: (value: { x: number; y: number; z: number }) => void,
  ) => { remove: () => void };
};

async function loadAccelerometer(): Promise<AccelerometerModule | null> {
  try {
    const specifier = ["expo", "sensors"].join("-");
    const module = (await import(specifier)) as {
      Accelerometer?: AccelerometerModule;
    };
    return module.Accelerometer ?? null;
  } catch {
    return null;
  }
}

export function createMobileMotionAdapter(): ForegroundMotionAdapter {
  let permitted = false;
  return {
    sensorType: "motion",
    async isSupported() {
      const accelerometer = await loadAccelerometer();
      if (!accelerometer) return false;
      return accelerometer.isAvailableAsync();
    },
    async requestPermission() {
      const accelerometer = await loadAccelerometer();
      if (!accelerometer) return false;
      const permission = await accelerometer.requestPermissionsAsync();
      permitted = permission.granted;
      return permitted;
    },
    async start() {},
    async stop() {},
    async readEstimate() {
      if (!permitted) return null;
      const accelerometer = await loadAccelerometer();
      if (!accelerometer) return null;
      accelerometer.setUpdateInterval(200);
      const magnitudes: number[] = [];
      const subscription = accelerometer.addListener((value) => {
        magnitudes.push(Math.sqrt(value.x ** 2 + value.y ** 2 + value.z ** 2));
      });
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      subscription.remove();
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

export function createMobileBluetoothAdapter(): SpatialSensorAdapter {
  return unsupportedProximityAdapter("bluetooth");
}

export function createMobileWifiAdapter(): SpatialSensorAdapter {
  return unsupportedProximityAdapter("wifi");
}
