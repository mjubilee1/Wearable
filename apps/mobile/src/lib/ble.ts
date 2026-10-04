/**
 * Nearby clip BLE discovery (mobile-only, Expo dev build).
 *
 * Stage 1 firmware advertises manufacturer data:
 *   FF FF | 'N' 'B' | id0 id1 id2 id3
 *
 * Scan-only — no connect, no pair, no GATT. Ignore every other advert.
 */

import {
  CLIP_RSSI_EMA_ALPHA,
  clipIdFromManufacturerBytes,
  normalizeDeviceId,
} from "@nearby/shared";
import { Platform } from "react-native";

export type NearbyClipSighting = {
  /** Full 8-char hex clip id from manufacturer payload. */
  clipId: string;
  rssi: number;
  smoothedRssi: number;
  lastSeenAtMs: number;
};

export type BleAvailability =
  | { status: "ready" }
  | { status: "unavailable"; reason: string }
  | { status: "poweredOff"; reason: string }
  | { status: "unauthorized"; reason: string };

type BleManagerLike = {
  state: () => Promise<string>;
  startDeviceScan: (
    uuids: string[] | null,
    options: { allowDuplicates?: boolean } | null,
    listener: (
      error: { message?: string } | null,
      device: ScannedDevice | null,
    ) => void,
  ) => void;
  stopDeviceScan: () => void;
  destroy: () => void;
};

type ScannedDevice = {
  id: string;
  name: string | null;
  localName: string | null;
  rssi: number | null;
  manufacturerData: string | null;
};

type BlePlxModule = {
  BleManager: new () => BleManagerLike;
};

let cachedModule: BlePlxModule | null | undefined;

function loadBlePlx(): BlePlxModule | null {
  if (cachedModule !== undefined) return cachedModule;
  if (Platform.OS === "web") {
    cachedModule = null;
    return null;
  }
  try {
    // Native-only; missing in Expo Go / web.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require("react-native-ble-plx") as BlePlxModule;
    return cachedModule;
  } catch {
    cachedModule = null;
    return null;
  }
}

export function isBleNativeAvailable(): boolean {
  return loadBlePlx() !== null;
}

function decodeBase64(data: string): Uint8Array | null {
  try {
    const globalAtob = (globalThis as { atob?: (v: string) => string }).atob;
    if (typeof globalAtob === "function") {
      const binary = globalAtob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
  } catch {
    // fall through
  }

  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const cleaned = data.replace(/=+$/, "");
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of cleaned) {
    const value = alphabet.indexOf(ch);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(output);
}

/** Manufacturer prefix only — ignore name-only / other BLE ads. */
export function clipIdFromAdvertisement(device: {
  manufacturerData?: string | null;
}): string | null {
  if (!device.manufacturerData) return null;
  const bytes = decodeBase64(device.manufacturerData);
  if (!bytes) return null;
  return clipIdFromManufacturerBytes(bytes);
}

/**
 * Link-ring helper: prefer manufacturer 8-char id; fall back to NB-XXXX name.
 */
export function deviceIdFromAdvertisement(device: {
  name?: string | null;
  localName?: string | null;
  manufacturerData?: string | null;
}): string | null {
  const fromMfg = clipIdFromAdvertisement(device);
  if (fromMfg) return fromMfg;
  return (
    normalizeDeviceId(device.localName ?? "") ??
    normalizeDeviceId(device.name ?? "")
  );
}

export async function getBleAvailability(): Promise<BleAvailability> {
  const mod = loadBlePlx();
  if (!mod) {
    return {
      status: "unavailable",
      reason:
        "Bluetooth scan needs a Nearby development build (not Expo Go). You can still enter your clip ID manually.",
    };
  }

  const manager = new mod.BleManager();
  try {
    const state = await manager.state();
    if (state === "PoweredOn") return { status: "ready" };
    if (state === "Unauthorized") {
      return {
        status: "unauthorized",
        reason:
          "Bluetooth permission is off. Enable it in Settings to find Nearby clips.",
      };
    }
    if (state === "PoweredOff") {
      return {
        status: "poweredOff",
        reason: "Turn on Bluetooth to find Nearby clips.",
      };
    }
    return {
      status: "unavailable",
      reason: `Bluetooth is ${state}. Try again in a moment.`,
    };
  } finally {
    manager.destroy();
  }
}

export type ClipScanHandle = {
  stop: () => void;
};

/**
 * Foreground scan for Nearby manufacturer ads only.
 * Applies RSSI EMA per clip id. No GATT connect.
 */
export function startNearbyClipScan(
  onUpdate: (sightings: NearbyClipSighting[]) => void,
  onError?: (message: string) => void,
): ClipScanHandle {
  const mod = loadBlePlx();
  if (!mod) {
    onError?.(
      "Bluetooth scan needs a Nearby development build (not Expo Go).",
    );
    return { stop: () => undefined };
  }

  const manager = new mod.BleManager();
  const byId = new Map<string, NearbyClipSighting>();

  const publish = () => {
    const list = Array.from(byId.values()).sort(
      (a, b) => b.smoothedRssi - a.smoothedRssi,
    );
    onUpdate(list);
  };

  const start = () => {
    manager.startDeviceScan(
      null,
      { allowDuplicates: true },
      (error, device) => {
        if (error) {
          onError?.(error.message ?? "Bluetooth scan failed");
          return;
        }
        if (!device) return;

        const clipId = clipIdFromAdvertisement(device);
        if (!clipId) return;

        const rssi = device.rssi;
        if (rssi === null || rssi === undefined) return;

        const prev = byId.get(clipId);
        const smoothedRssi = prev
          ? CLIP_RSSI_EMA_ALPHA * rssi +
            (1 - CLIP_RSSI_EMA_ALPHA) * prev.smoothedRssi
          : rssi;

        byId.set(clipId, {
          clipId,
          rssi,
          smoothedRssi,
          lastSeenAtMs: Date.now(),
        });
        publish();
      },
    );
  };

  void (async () => {
    try {
      const state = await manager.state();
      if (state !== "PoweredOn") {
        onError?.(
          state === "Unauthorized"
            ? "Bluetooth permission is off."
            : state === "PoweredOff"
              ? "Turn on Bluetooth to find clips."
              : `Bluetooth is ${state}.`,
        );
        return;
      }
      start();
    } catch (error) {
      onError?.(
        error instanceof Error ? error.message : "Could not start Bluetooth scan",
      );
    }
  })();

  return {
    stop: () => {
      try {
        manager.stopDeviceScan();
      } catch {
        // ignore
      }
      try {
        manager.destroy();
      } catch {
        // ignore
      }
    },
  };
}

/** @deprecated Use startNearbyClipScan */
export const startNearbyRingScan = (
  onUpdate: (
    sightings: {
      deviceId: string;
      localName: string | null;
      rssi: number | null;
      lastSeenAtMs: number;
    }[],
  ) => void,
  onError?: (message: string) => void,
) =>
  startNearbyClipScan((sightings) => {
    onUpdate(
      sightings.map((s) => ({
        deviceId: s.clipId,
        localName: null,
        rssi: s.smoothedRssi,
        lastSeenAtMs: s.lastSeenAtMs,
      })),
    );
  }, onError);
