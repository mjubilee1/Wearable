import { Accelerometer } from "expo-sensors";
import type {
  LocationProvider,
  MotionSensorProvider,
} from "@nearby/shared";
import { readDeviceLocation } from "./device-location";

export const mobileLocationProvider: LocationProvider = {
  supported: true,
  async readCurrent() {
    const value = await readDeviceLocation();
    if (!value) return null;
    return {
      value,
      measuredAt: Date.now(),
      qualityScore: value.accuracyMeters
        ? Math.max(0.2, Math.min(1, 50 / value.accuracyMeters))
        : 0.7,
    };
  },
};

export const mobileMotionProvider: MotionSensorProvider = {
  supported: true,
  async readMotionIntensity() {
    const permission = await Accelerometer.requestPermissionsAsync();
    if (!permission.granted) return null;
    const available = await Accelerometer.isAvailableAsync();
    if (!available) return null;
    Accelerometer.setUpdateInterval(100);
    const magnitudes: number[] = [];
    return new Promise((resolve) => {
      const subscription = Accelerometer.addListener(({ x, y, z }) => {
        magnitudes.push(Math.sqrt(x * x + y * y + z * z));
      });
      setTimeout(() => {
        subscription.remove();
        if (!magnitudes.length) {
          resolve(null);
          return;
        }
        const average =
          magnitudes.reduce((sum, value) => sum + value, 0) /
          magnitudes.length;
        const variation = Math.sqrt(
          magnitudes.reduce(
            (sum, value) => sum + (value - average) ** 2,
            0,
          ) / magnitudes.length,
        );
        resolve({
          value: Math.min(5, variation),
          measuredAt: Date.now(),
          qualityScore: Math.min(0.85, 0.55 + magnitudes.length / 100),
        });
      }, 10_000);
    });
  },
};
