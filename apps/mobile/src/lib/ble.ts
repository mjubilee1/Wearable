/**
 * Nearby ring BLE discovery (mobile-only).
 *
 * Firmware advertises local name `NB-XXXX` plus manufacturer data
 * `FF FF | 'N' 'B' | id0..id3`. We scan for that and normalize to `XXXX`.
 *
 * Requires a native build with `react-native-ble-plx` (not Expo Go).
 * Falls back to "unavailable" so link-ring can still use manual entry.
 */

import { normalizeDeviceId } from "@nearby/shared";
import { Platform } from "react-native";

export type NearbyRingSighting = {
  /** Short wearable id, e.g. A1B2 */
  deviceId: string;
  /** Local name if present, e.g. NB-A1B2 */
  localName: string | null;
  rssi: number | null;
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
    listener: (error: { message?: string } | null, device: ScannedDevice | null) => void,
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

const NEARBY_COMPANY_ID_LE = [0xff, 0xff];
const NEARBY_MAGIC = [0x4e, 0x42]; // 'N' 'B'

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

  // Minimal base64 decode for RN when atob is missing.
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

/** Prefer local name; fall back to manufacturer payload used by Stage 1 firmware. */
export function deviceIdFromAdvertisement(device: {
  name?: string | null;
  localName?: string | null;
  manufacturerData?: string | null;
}): string | null {
  const fromName =
    normalizeDeviceId(device.localName ?? "") ??
    normalizeDeviceId(device.name ?? "");
  if (fromName) return fromName;

  if (!device.manufacturerData) return null;
  const bytes = decodeBase64(device.manufacturerData);
  if (!bytes || bytes.length < 8) return null;
  if (bytes[0] !== NEARBY_COMPANY_ID_LE[0] || bytes[1] !== NEARBY_COMPANY_ID_LE[1]) {
    return null;
  }
  if (bytes[2] !== NEARBY_MAGIC[0] || bytes[3] !== NEARBY_MAGIC[1]) return null;

  // Firmware short name uses the last two of the four id bytes.
  const short = `${bytes[6].toString(16).padStart(2, "0")}${bytes[7]
    .toString(16)
    .padStart(2, "0")}`.toUpperCase();
  return normalizeDeviceId(short);
}

export async function getBleAvailability(): Promise<BleAvailability> {
  const mod = loadBlePlx();
  if (!mod) {
    return {
      status: "unavailable",
      reason:
        "Bluetooth scan needs a Nearby development build (not Expo Go). You can still enter your ring ID manually.",
    };
  }

  const manager = new mod.BleManager();
  try {
    const state = await manager.state();
    if (state === "PoweredOn") return { status: "ready" };
    if (state === "Unauthorized") {
      return {
        status: "unauthorized",
        reason: "Bluetooth permission is off. Enable it in Settings to auto-find your ring.",
      };
    }
    if (state === "PoweredOff") {
      return {
        status: "poweredOff",
        reason: "Turn on Bluetooth to auto-find your Nearby ring.",
      };
    }
    return {
      status: "unavailable",
      reason: `Bluetooth is ${state}. Try again in a moment, or enter your ring ID manually.`,
    };
  } finally {
    manager.destroy();
  }
}

export type RingScanHandle = {
  stop: () => void;
};

/**
 * Continuously scan for Nearby rings. Calls `onUpdate` with the latest map
 * of deviceId → sighting (strongest / freshest RSSI wins).
 */
export function startNearbyRingScan(
  onUpdate: (sightings: NearbyRingSighting[]) => void,
  onError?: (message: string) => void,
): RingScanHandle {
  const mod = loadBlePlx();
  if (!mod) {
    onError?.(
      "Bluetooth scan needs a Nearby development build (not Expo Go).",
    );
    return { stop: () => undefined };
  }

  const manager = new mod.BleManager();
  const byId = new Map<string, NearbyRingSighting>();

  const publish = () => {
    const list = Array.from(byId.values()).sort((a, b) => {
      const rssiA = a.rssi ?? -999;
      const rssiB = b.rssi ?? -999;
      return rssiB - rssiA;
    });
    onUpdate(list);
  };

  const start = () => {
    manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
      if (error) {
        onError?.(error.message ?? "Bluetooth scan failed");
        return;
      }
      if (!device) return;

      const deviceId = deviceIdFromAdvertisement(device);
      if (!deviceId) return;

      const prev = byId.get(deviceId);
      const rssi = device.rssi ?? null;
      byId.set(deviceId, {
        deviceId,
        localName: device.localName ?? device.name ?? prev?.localName ?? null,
        rssi:
          rssi === null
            ? (prev?.rssi ?? null)
            : prev?.rssi === null || prev === undefined
              ? rssi
              : Math.max(prev.rssi, rssi),
        lastSeenAtMs: Date.now(),
      });
      publish();
    });
  };

  // Wait until the radio is ready, then scan.
  void (async () => {
    try {
      const state = await manager.state();
      if (state !== "PoweredOn") {
        onError?.(
          state === "Unauthorized"
            ? "Bluetooth permission is off."
            : state === "PoweredOff"
              ? "Turn on Bluetooth to find your ring."
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
