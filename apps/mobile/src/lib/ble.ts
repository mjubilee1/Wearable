/**
 * Nearby clip BLE discovery (mobile-only, Expo dev build).
 *
 * Manufacturer ads: FF FF | 'N' 'B' | id0 id1 id2 id3
 * Phone scans peers; writes LED color to the wearer's own clip over GATT.
 */

import {
  CLIP_LED_GREEN,
  CLIP_LED_OFF,
  CLIP_RSSI_EMA_ALPHA,
  NEARBY_LED_COLOR_CHAR_UUID,
  NEARBY_LED_SERVICE_UUID,
  clipIdFromManufacturerBytes,
  clipsMatch,
  normalizeDeviceId,
} from "@nearby/shared";
import { Platform } from "react-native";

export type NearbyClipSighting = {
  /** Full 8-char hex clip id from manufacturer payload. */
  clipId: string;
  /** Platform BLE peripheral id (for GATT connect). */
  peripheralId: string;
  rssi: number;
  smoothedRssi: number;
  lastSeenAtMs: number;
};

export type BleAvailability =
  | { status: "ready" }
  | { status: "unavailable"; reason: string }
  | { status: "poweredOff"; reason: string }
  | { status: "unauthorized"; reason: string };

type ConnectedDevice = {
  discoverAllServicesAndCharacteristics: () => Promise<ConnectedDevice>;
  writeCharacteristicWithResponseForService: (
    serviceUUID: string,
    characteristicUUID: string,
    base64Value: string,
  ) => Promise<unknown>;
  writeCharacteristicWithoutResponseForService: (
    serviceUUID: string,
    characteristicUUID: string,
    base64Value: string,
  ) => Promise<unknown>;
  cancelConnection: () => Promise<unknown>;
};

type BleManagerLike = {
  state: () => Promise<string>;
  onStateChange: (
    listener: (state: string) => void,
    emitCurrentState?: boolean,
  ) => { remove: () => void };
  startDeviceScan: (
    uuids: string[] | null,
    options: { allowDuplicates?: boolean } | null,
    listener: (
      error: { message?: string } | null,
      device: ScannedDevice | null,
    ) => void,
  ) => void;
  stopDeviceScan: () => void;
  connectToDevice: (
    deviceId: string,
    options?: { timeout?: number },
  ) => Promise<ConnectedDevice>;
  cancelDeviceConnection: (deviceId: string) => Promise<unknown>;
  destroy: () => void;
};

function isTerminalBleState(state: string): boolean {
  return (
    state === "PoweredOn" ||
    state === "PoweredOff" ||
    state === "Unauthorized" ||
    state === "Unsupported"
  );
}

/** iOS often reports Unknown/Resetting until CoreBluetooth finishes starting. */
async function waitForBlePoweredOn(
  manager: BleManagerLike,
  timeoutMs = 8000,
): Promise<string> {
  try {
    const current = await manager.state();
    if (isTerminalBleState(current)) return current;
  } catch {
    // fall through to subscription wait
  }

  return new Promise((resolve) => {
    let settled = false;
    let sub: { remove: () => void } | null = null;

    const finish = (state: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (sub) {
        try {
          sub.remove();
        } catch {
          // ignore
        }
        sub = null;
      }
      resolve(state);
    };

    const timer = setTimeout(() => {
      void manager
        .state()
        .then((state) => finish(state))
        .catch(() => finish("Unknown"));
    }, timeoutMs);

    try {
      sub = manager.onStateChange((state) => {
        if (isTerminalBleState(state)) finish(state);
      }, true);
    } catch {
      void manager
        .state()
        .then((state) => finish(state))
        .catch(() => finish("Unknown"));
    }
  });
}

type ScannedDevice = {
  id: string;
  name: string | null;
  localName: string | null;
  rssi: number | null;
  manufacturerData: string | null;
};

type BleManagerOptions = {
  restoreStateIdentifier?: string;
  restoreStateFunction?: (restoredState: unknown) => void;
};

type BlePlxModule = {
  BleManager: new (options?: BleManagerOptions) => BleManagerLike;
};

let cachedModule: BlePlxModule | null | undefined;
/** One manager for the app — destroy() races with onStateChange and throws BleError. */
let sharedManager: BleManagerLike | null = null;

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

function getSharedBleManager(): BleManagerLike | null {
  const mod = loadBlePlx();
  if (!mod) return null;
  if (!sharedManager) {
    sharedManager = new mod.BleManager({
      restoreStateIdentifier: "nearby-clip-central",
    });
  }
  return sharedManager;
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

function encodeByteBase64(value: number): string {
  const globalBtoa = (globalThis as { btoa?: (v: string) => string }).btoa;
  const ch = String.fromCharCode(value & 0xff);
  if (typeof globalBtoa === "function") return globalBtoa(ch);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const b = value & 0xff;
  return (
    alphabet[b >> 2] +
    alphabet[((b & 0x3) << 4)] +
    "=="
  );
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
  const manager = getSharedBleManager();
  if (!manager) {
    return {
      status: "unavailable",
      reason:
        "Bluetooth scan needs a Nearby development build (not Expo Go). You can still enter your clip ID manually.",
    };
  }

  try {
    const state = await waitForBlePoweredOn(manager);
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
  } catch (error) {
    return {
      status: "unavailable",
      reason:
        error instanceof Error
          ? error.message
          : "Bluetooth is not ready yet. Try again in a moment.",
    };
  }
}

export type ClipScanHandle = {
  stop: () => void;
  /** Write LED state to a clip (usually the wearer's own linked id). */
  writeClipLed: (clipId: string, green: boolean) => Promise<void>;
};

/**
 * Foreground scan for Nearby manufacturer ads.
 * Tracks peripheral ids so we can GATT-write the wearer's own clip.
 */
export function startNearbyClipScan(
  onUpdate: (sightings: NearbyClipSighting[]) => void,
  onError?: (message: string) => void,
): ClipScanHandle {
  const manager = getSharedBleManager();
  if (!manager) {
    onError?.(
      "Bluetooth scan needs a Nearby development build (not Expo Go).",
    );
    return {
      stop: () => undefined,
      writeClipLed: async () => undefined,
    };
  }

  const byId = new Map<string, NearbyClipSighting>();
  /** clipId → last seen BLE peripheral id (includes own clip). */
  const peripheralByClipId = new Map<string, string>();
  let scanning = false;
  /** True only while connecting. Scan callbacks must not land mid-connect. */
  let paused = false;
  let held: ConnectedDevice | null = null;
  let heldPeripheralId: string | null = null;
  let connectingId: string | null = null;
  let lastLedGreen: boolean | null = null;
  let lastLedWriteAtMs = 0;
  let lastError: string | null = null;
  let stopped = false;
  let writeChain: Promise<void> = Promise.resolve();
  /**
   * Firmware clears the ring 3s after the last write. Refresh faster than that,
   * but don't queue a write on every duplicate advert.
   */
  const LED_REFRESH_MS = 1000;

  const publish = () => {
    const list = Array.from(byId.values()).sort(
      (a, b) => b.smoothedRssi - a.smoothedRssi,
    );
    onUpdate(list);
  };

  const reportError = (message: string) => {
    if (lastError === message) return;
    lastError = message;
    onError?.(message);
  };

  const clearError = () => {
    if (!lastError) return;
    lastError = null;
    onError?.("");
  };

  const startScan = () => {
    if (stopped || paused) return;
    if (scanning) {
      try {
        manager.stopDeviceScan();
      } catch {
        // ignore — may not be scanning yet
      }
      scanning = false;
    }
    scanning = true;
    manager.startDeviceScan(
      null,
      // iOS drops background scans when duplicates are allowed.
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          // Ignore cancel noise when we stop to GATT-write.
          const message = error.message ?? "Bluetooth scan failed";
          if (!stopped && !/cancelled|canceled/i.test(message)) {
            onError?.(message);
          }
          return;
        }
        if (!device || paused || stopped) return;

        const clipId = clipIdFromAdvertisement(device);
        if (!clipId) return;

        peripheralByClipId.set(clipId, device.id);

        const rssi = device.rssi;
        if (rssi === null || rssi === undefined) return;

        const prev = byId.get(clipId);
        const smoothedRssi = prev
          ? CLIP_RSSI_EMA_ALPHA * rssi +
            (1 - CLIP_RSSI_EMA_ALPHA) * prev.smoothedRssi
          : rssi;

        byId.set(clipId, {
          clipId,
          peripheralId: device.id,
          rssi,
          smoothedRssi,
          lastSeenAtMs: Date.now(),
        });
        publish();
      },
    );
  };

  const stopScanOnly = () => {
    if (!scanning) return;
    try {
      manager.stopDeviceScan();
    } catch {
      // ignore
    }
    scanning = false;
  };

  const resolvePeripheralId = (clipId: string): string | null => {
    const direct = peripheralByClipId.get(clipId);
    if (direct) return direct;
    for (const [id, peripheralId] of peripheralByClipId) {
      if (clipsMatch(id, clipId)) return peripheralId;
    }
    const fromSighting = byId.get(clipId)?.peripheralId;
    if (fromSighting) return fromSighting;
    for (const sighting of byId.values()) {
      if (clipsMatch(sighting.clipId, clipId)) return sighting.peripheralId;
    }
    return null;
  };

  const delay = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  const isCancelledError = (error: unknown) =>
    error instanceof Error && /cancelled|canceled/i.test(error.message);

  const cancelHeld = async () => {
    const current = held;
    held = null;
    heldPeripheralId = null;
    if (!current) return;
    try {
      await current.cancelConnection();
    } catch {
      // ignore
    }
  };

  const ensureHeld = async (peripheralId: string): Promise<ConnectedDevice> => {
    if (held && heldPeripheralId === peripheralId) return held;

    await cancelHeld();
    // iOS cancels connect when it lands in the same turn as stopDeviceScan.
    await delay(300);
    if (stopped) throw new Error("Clip LED write stopped");

    connectingId = peripheralId;
    let device: ConnectedDevice | null = null;
    try {
      device = await manager.connectToDevice(peripheralId, { timeout: 8000 });
      if (stopped) {
        await device.cancelConnection().catch(() => undefined);
        throw new Error("Clip LED write stopped");
      }
      await device.discoverAllServicesAndCharacteristics();
      held = device;
      heldPeripheralId = peripheralId;
      return device;
    } catch (error) {
      if (device && held !== device) {
        try {
          await device.cancelConnection();
        } catch {
          // ignore
        }
      }
      throw error;
    } finally {
      connectingId = null;
    }
  };

  const writeClipLedOnce = async (clipId: string, green: boolean) => {
    if (stopped) return;
    const normalized = normalizeDeviceId(clipId);
    if (!normalized) return;

    const peripheralId = resolvePeripheralId(normalized);
    if (!peripheralId) {
      reportError(
        "Your linked clip isn't in Bluetooth range, so the ring stays off.",
      );
      return;
    }

    const now = Date.now();
    if (
      held &&
      heldPeripheralId === peripheralId &&
      lastLedGreen === green &&
      now - lastLedWriteAtMs < LED_REFRESH_MS
    ) {
      return;
    }

    paused = true;
    stopScanOnly();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (stopped) return;
        try {
          const device = await ensureHeld(peripheralId);
          if (stopped) return;
          const payload = encodeByteBase64(
            green ? CLIP_LED_GREEN : CLIP_LED_OFF,
          );
          try {
            await device.writeCharacteristicWithResponseForService(
              NEARBY_LED_SERVICE_UUID,
              NEARBY_LED_COLOR_CHAR_UUID,
              payload,
            );
          } catch (writeError) {
            if (isCancelledError(writeError) || stopped) throw writeError;
            await device.writeCharacteristicWithoutResponseForService(
              NEARBY_LED_SERVICE_UUID,
              NEARBY_LED_COLOR_CHAR_UUID,
              payload,
            );
          }
          lastLedGreen = green;
          lastLedWriteAtMs = Date.now();
          clearError();
          return;
        } catch (error) {
          await cancelHeld();
          if (stopped) return;
          const cancelled = isCancelledError(error);
          if (!cancelled || attempt === 2) {
            reportError(
              cancelled
                ? "Clip LED write was interrupted. Keep this app open beside your clip."
                : error instanceof Error
                  ? `Clip LED write failed: ${error.message}`
                  : "Clip LED write failed",
            );
            return;
          }
          await delay(400);
        }
      }
    } finally {
      paused = false;
      if (!stopped) startScan();
    }
  };

  const writeClipLed = (clipId: string, green: boolean) => {
    const run = writeChain.then(() => writeClipLedOnce(clipId, green));
    writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  void (async () => {
    try {
      const state = await waitForBlePoweredOn(manager);
      if (stopped) return;
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
      startScan();
    } catch (error) {
      if (stopped) return;
      onError?.(
        error instanceof Error ? error.message : "Could not start Bluetooth scan",
      );
    }
  })();

  return {
    stop: () => {
      stopped = true;
      paused = false;
      stopScanOnly();
      const pending = connectingId;
      connectingId = null;
      if (pending) {
        void manager.cancelDeviceConnection(pending).catch(() => undefined);
      }
      void cancelHeld();
      // Keep shared BleManager alive — destroy() throws BleError with active subs.
    },
    writeClipLed,
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
