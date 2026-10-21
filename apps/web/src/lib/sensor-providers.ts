import type {
  AmbientSoundProvider,
  LocationProvider,
  MotionSensorProvider,
  SensorReading,
} from "@nearby/shared";
import { readDeviceLocation } from "./device-location";

export const browserLocationProvider: LocationProvider = {
  supported: typeof navigator !== "undefined" && "geolocation" in navigator,
  async readCurrent() {
    const value = await readDeviceLocation();
    if (!value) return null;
    return {
      value,
      measuredAt: Date.now(),
      qualityScore: value.accuracyMeters
        ? Math.max(0.2, Math.min(1, 50 / value.accuracyMeters))
        : 0.6,
    };
  },
};

export const browserSoundProvider: AmbientSoundProvider = {
  supported:
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia),
  async readRelativeIntensity() {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
    });
    const AudioContextConstructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) {
      stream.getTracks().forEach((track) => track.stop());
      return null;
    }
    const context = new AudioContextConstructor();
    try {
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const levels: number[] = [];
      for (let index = 0; index < 80; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 125));
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, value) => sum + value * value, 0) /
            samples.length,
        );
        levels.push(
          Math.max(
            -100,
            Math.min(0, 20 * Math.log10(Math.max(rms, 0.00001))),
          ),
        );
      }
      return {
        value: levels.reduce((sum, value) => sum + value, 0) / levels.length,
        measuredAt: Date.now(),
        qualityScore: 0.65,
      };
    } finally {
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
    }
  },
};

type MotionPermissionEvent = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

async function requestMotionPermission(): Promise<boolean> {
  const constructor = DeviceMotionEvent as MotionPermissionEvent;
  if (!constructor.requestPermission) return true;
  return (await constructor.requestPermission()) === "granted";
}

export const browserMotionProvider: MotionSensorProvider = {
  supported: typeof window !== "undefined" && "DeviceMotionEvent" in window,
  async readMotionIntensity(): Promise<SensorReading<number> | null> {
    if (!(await requestMotionPermission())) return null;
    const magnitudes: number[] = [];
    return new Promise((resolve) => {
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
          qualityScore: Math.min(0.8, 0.45 + magnitudes.length / 200),
        });
      }, 10_000);
    });
  },
};
