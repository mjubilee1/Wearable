import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BleManager, type Device, type Subscription } from "react-native-ble-plx";
import { pendantCodeFromName, pendantDisplayName } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";
import { updateUserProfile } from "@/lib/users";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const SERVICE = "4e421000-0000-1000-8000-00805f9b34fb";
const GAP_SERVICE = "00001800-0000-1000-8000-00805f9b34fb";
const GAP_NAME = "00002a00-0000-1000-8000-00805f9b34fb";
const AUDIO = "4e421001-0000-1000-8000-00805f9b34fb";
const EVENT = "4e421003-0000-1000-8000-00805f9b34fb";

export type FoundPendant = {
  id: string;
  code: string;
  name: string;
};

type PendantContextValue = {
  status: string;
  scanning: boolean;
  found: FoundPendant[];
  pairedCode: string | null;
  find: () => Promise<void>;
  pair: (pendant: FoundPendant) => Promise<void>;
  forget: () => Promise<void>;
};

const PendantContext = createContext<PendantContextValue | null>(null);

function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(clean[i] ?? "A");
    const b = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(clean[i + 1] ?? "A");
    const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(clean[i + 2] ?? "A");
    const d = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(clean[i + 3] ?? "A");
    bytes.push((a << 2) | (b >> 4));
    if (clean[i + 2] && clean[i + 2] !== "=") bytes.push(((b & 15) << 4) | (c >> 2));
    if (clean[i + 3] && clean[i + 3] !== "=") bytes.push(((c & 3) << 6) | d);
  }
  return Uint8Array.from(bytes);
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = i + 1 < bytes.length ? (bytes[i + 1] ?? 0) : 0;
    const c = i + 2 < bytes.length ? (bytes[i + 2] ?? 0) : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }
  return out;
}

function wavBase64(pcm: Uint8Array): string {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const dataSize = pcm.length;
  header.set([0x52, 0x49, 0x46, 0x46]);
  view.setUint32(4, 36 + dataSize, true);
  header.set([0x57, 0x41, 0x56, 0x45], 8);
  header.set([0x66, 0x6d, 0x74, 0x20], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  header.set([0x64, 0x61, 0x74, 0x61], 36);
  view.setUint32(40, dataSize, true);
  const combined = new Uint8Array(header.length + pcm.length);
  combined.set(header);
  combined.set(pcm, header.length);
  return encodeBase64(combined);
}

async function ensureBluetoothPermission(): Promise<void> {
  if (Platform.OS !== "android") return;
  const results = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);
  const granted = Object.values(results).every(
    (value) => value === PermissionsAndroid.RESULTS.GRANTED,
  );
  if (!granted) throw new Error("Bluetooth permission is required to add a pendant.");
}

function speak(text: string) {
  try {
    const Speech = require("expo-speech") as typeof import("expo-speech");
    Speech.stop();
    Speech.speak(text, { rate: 1, language: "en-US" });
  } catch (error) {
    console.warn("Spoken reply unavailable until the next dev build", error);
  }
}

export function PendantProvider({ children }: { children: ReactNode }) {
  const { user, profile, refreshProfile } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;
  const managerRef = useRef<BleManager | null>(null);
  const subsRef = useRef<Subscription[]>([]);
  const pcmRef = useRef<number[]>([]);
  const collectingRef = useRef(false);
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendingRef = useRef(false);
  const [status, setStatus] = useState("Pendant not added");
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<FoundPendant[]>([]);

  const pairedCode = profile?.pendantId ?? null;

  const manager = useCallback(() => {
    if (!managerRef.current) managerRef.current = new BleManager();
    return managerRef.current;
  }, []);

  const finishTurn = useCallback(async () => {
    const signedIn = userRef.current;
    if (sendingRef.current || !signedIn) return;
    const bytes = Uint8Array.from(pcmRef.current);
    pcmRef.current = [];
    collectingRef.current = false;
    if (bytes.length < 1600) return;
    sendingRef.current = true;
    setStatus("Sending what you said…");
    try {
      const token = await signedIn.getIdToken();
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`${API_URL}/v1/agent/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ audioBase64: wavBase64(bytes), timeZone }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { reply?: string; error?: string }
        | null;
      if (!res.ok || !payload?.reply) {
        throw new Error(payload?.error ?? "The assistant didn't answer");
      }
      setStatus(payload.reply);
      speak(payload.reply);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not send that turn");
    } finally {
      sendingRef.current = false;
    }
  }, []);

  const noteAudio = useCallback(
    (chunk: Uint8Array) => {
      if (!collectingRef.current) return;
      pcmRef.current.push(...chunk);
      if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
      quietTimerRef.current = setTimeout(() => {
        void finishTurn();
      }, 1200);
    },
    [finishTurn],
  );

  const listenRef = useRef<(device: Device, code: string) => Promise<void>>(
    async () => {},
  );

  const connectPaired = useCallback(
    async (code: string) => {
      setStatus(`Looking for ${pendantDisplayName(code)}…`);
      await ensureBluetoothPermission();
      const ble = manager();
      ble.stopDeviceScan();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ble.stopDeviceScan();
          reject(new Error(`Couldn't find ${pendantDisplayName(code)}. Is it powered on?`));
        }, 12000);
        ble.startDeviceScan(null, null, (error, device) => {
          if (error) {
            clearTimeout(timer);
            ble.stopDeviceScan();
            reject(error);
            return;
          }
          const seen = pendantCodeFromName(device?.localName ?? device?.name);
          if (!device || seen !== code) return;
          clearTimeout(timer);
          ble.stopDeviceScan();
          void listenRef.current(device, code).then(resolve).catch(reject);
        });
      });
    },
    [manager],
  );

  async function listen(device: Device, code: string) {
    subsRef.current.forEach((sub) => sub.remove());
    subsRef.current = [];
    const connected = await device.connect();
    await connected.discoverAllServicesAndCharacteristics();
    await connected.requestMTU(247).catch(() => connected);
    setStatus(`Connected to ${pendantDisplayName(code)}`);
    const audioSub = connected.monitorCharacteristicForService(
      SERVICE,
      AUDIO,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        noteAudio(decodeBase64(characteristic.value));
      },
    );
    const eventSub = connected.monitorCharacteristicForService(
      SERVICE,
      EVENT,
      (error) => {
        if (error) return;
        pcmRef.current = [];
        collectingRef.current = true;
        setStatus("Heard you");
      },
    );
    const disconnectSub = bleDisconnect(connected, code);
    subsRef.current = [audioSub, eventSub, disconnectSub];
  }
  listenRef.current = listen;

  function bleDisconnect(device: Device, code: string): Subscription {
    return manager().onDeviceDisconnected(device.id, () => {
      setStatus(`${pendantDisplayName(code)} disconnected. Looking again…`);
      setTimeout(() => {
        void connectPaired(code).catch((error: unknown) => {
          setStatus(error instanceof Error ? error.message : "Pendant disconnected");
        });
      }, 1500);
      return;
    });
  }

  useEffect(() => {
    if (!pairedCode || !user) return;
    let cancelled = false;
    void connectPaired(pairedCode).catch((error: unknown) => {
      if (!cancelled) {
        setStatus(error instanceof Error ? error.message : "Could not connect");
      }
    });
    return () => {
      cancelled = true;
      manager().stopDeviceScan();
      subsRef.current.forEach((sub) => sub.remove());
    };
  }, [pairedCode, user, connectPaired, manager]);

  const find = useCallback(async () => {
    setScanning(true);
    setFound([]);
    setStatus("Searching for a pendant…");
    try {
      await ensureBluetoothPermission();
      const ble = manager();
      const seen = new Map<string, FoundPendant>();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          ble.stopDeviceScan();
          resolve();
        }, 12000);
        ble.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
          if (error) {
            clearTimeout(timer);
            ble.stopDeviceScan();
            resolve();
            return;
          }
          if (!device || seen.has(device.id)) return;
          const code = pendantCodeFromName(device.localName ?? device.name);
          const services = (device.serviceUUIDs ?? []).map((id) => id.toLowerCase());
          if (!code && !services.includes(SERVICE)) return;
          const next = {
            id: device.id,
            code: code ?? "",
            name: code ? pendantDisplayName(code) : "Nearby pendant",
          };
          seen.set(device.id, next);
          setFound([...seen.values()]);
        });
      });
      setStatus(seen.size ? "Tap your pendant." : "No pendant found. Keep it plugged in and try again.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Bluetooth search failed");
    } finally {
      setScanning(false);
    }
  }, [manager]);

  const pair = useCallback(
    async (pendant: FoundPendant) => {
      if (!profile) return;
      setStatus("Reading the pendant name…");
      try {
        let code = pendant.code;
        if (!code) {
          const ble = manager();
          const devices = await ble.connectedDevices([SERVICE]);
          const known = devices.find((item) => item.id === pendant.id);
          const connected = known?.id
            ? known
            : await ble.connectToDevice(pendant.id);
          await connected.discoverAllServicesAndCharacteristics();
          code =
            pendantCodeFromName(connected.localName ?? connected.name) ?? "";
          if (!code) {
            const characteristic = await connected.readCharacteristicForService(
              GAP_SERVICE,
              GAP_NAME,
            );
            const bytes = characteristic.value
              ? decodeBase64(characteristic.value)
              : new Uint8Array();
            code = pendantCodeFromName(String.fromCharCode(...bytes)) ?? "";
          }
          await connected.cancelConnection().catch(() => undefined);
        }
        if (!code) {
          setStatus("Found a pendant, but couldn't read its name. Keep it plugged in and try again.");
          return;
        }
        await updateUserProfile(profile.id, { pendantId: code });
        await refreshProfile();
        setFound([]);
        setStatus(`Saved ${pendantDisplayName(code)} on your account.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not add that pendant");
      }
    },
    [manager, profile, refreshProfile],
  );

  const forget = useCallback(async () => {
    if (!profile) return;
    manager().stopDeviceScan();
    subsRef.current.forEach((sub) => sub.remove());
    await updateUserProfile(profile.id, { pendantId: null });
    await refreshProfile();
    setStatus("Pendant removed from this account.");
  }, [manager, profile, refreshProfile]);

  const value = useMemo(
    () => ({ status, scanning, found, pairedCode, find, pair, forget }),
    [status, scanning, found, pairedCode, find, pair, forget],
  );

  return <PendantContext.Provider value={value}>{children}</PendantContext.Provider>;
}

export function usePendant(): PendantContextValue {
  const value = useContext(PendantContext);
  if (!value) throw new Error("usePendant must be used inside PendantProvider");
  return value;
}

export function PendantCard() {
  const { status, scanning, found, pairedCode, find, pair, forget } = usePendant();
  if (!pairedCode && !scanning && found.length === 0 && status === "Pendant not added") {
    return (
      <View style={styles.quiet}>
        <Text style={styles.quietLabel}>Pendant</Text>
        <Pressable onPress={() => void find()}>
          <Text style={styles.link}>Add</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Pendant</Text>
      <Text style={styles.status}>{status}</Text>
      {pairedCode ? (
        <Pressable onPress={() => void forget()} style={styles.secondary}>
          <Text style={styles.secondaryText}>Remove from account</Text>
        </Pressable>
      ) : (
        <>
          <Pressable
            disabled={scanning}
            onPress={() => void find()}
            style={[styles.primary, scanning && styles.disabled]}
          >
            {scanning ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryText}>Add pendant</Text>
            )}
          </Pressable>
          {found.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => void pair(item)}
              style={styles.found}
            >
              <Text style={styles.foundText}>{item.name}</Text>
            </Pressable>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  quiet: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  quietLabel: { fontSize: 14, color: colors.muted },
  link: { fontSize: 14, fontWeight: "700", color: colors.teal },
  card: {
    marginTop: 8,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 16,
    gap: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.teal,
  },
  status: { fontSize: 14, lineHeight: 20, color: colors.ink },
  primary: {
    borderRadius: 16,
    backgroundColor: colors.teal,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  secondary: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: colors.ink, fontWeight: "700", fontSize: 14 },
  found: {
    borderRadius: 16,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  foundText: { fontSize: 15, fontWeight: "700", color: colors.ink },
  disabled: { opacity: 0.6 },
});
