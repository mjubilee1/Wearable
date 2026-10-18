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
  NativeModules,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { BleManager, State, type Device, type Subscription } from "react-native-ble-plx";
import { pendantCodeFromName, pendantDisplayName } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { readDeviceLocation } from "@/lib/device-location";
import { colors } from "@/lib/theme";
import { speak, stop } from "@/lib/speech";
import { updateUserProfile } from "@/lib/users";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const SERVICE = "4e421000-0000-1000-8000-00805f9b34fb";
const GAP_SERVICE = "00001800-0000-1000-8000-00805f9b34fb";
const GAP_NAME = "00002a00-0000-1000-8000-00805f9b34fb";
const AUDIO = "4e421001-0000-1000-8000-00805f9b34fb";
const EVENT = "4e421003-0000-1000-8000-00805f9b34fb";
const REPLY = "4e421004-0000-1000-8000-00805f9b34fb";
const REPLY_MAX_BYTES = 96;
const TIME_SERVICE = "4e421010-0000-1000-8000-00805f9b34fb";
const TIME_CHAR = "4e421011-0000-1000-8000-00805f9b34fb";

export type FoundPendant = {
  id: string;
  code: string;
  name: string;
};

export type PendantChat = {
  request: string | null;
  reply: string | null;
  busy: boolean;
  error: string | null;
};

type PendantContextValue = {
  status: string;
  scanning: boolean;
  found: FoundPendant[];
  pairedCode: string | null;
  chat: PendantChat | null;
  find: () => Promise<void>;
  pair: (pendant: FoundPendant) => Promise<void>;
  forget: () => Promise<void>;
  sendReplyText: (text: string) => Promise<void>;
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

async function writeNearbyTime(device: Device): Promise<void> {
  const unix = Math.floor(Date.now() / 1000);
  const offset = -new Date().getTimezoneOffset() * 60;
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, unix, true);
  view.setInt32(4, offset, true);
  await device.writeCharacteristicWithResponseForService(
    TIME_SERVICE,
    TIME_CHAR,
    encodeBase64(bytes),
  );
}

function bluetoothReady(): boolean {
  return Platform.OS !== "web" && NativeModules.BlePlx != null;
}

function waitForBluetooth(ble: BleManager): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let subscription: Subscription | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.remove();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(
        new Error(
          "Bluetooth didn't start. Turn it on, then try again. The iPhone simulator has no Bluetooth.",
        ),
      );
    }, 8000);
    subscription = ble.onStateChange((state) => {
      if (state === State.PoweredOn) finish();
      else if (state === State.PoweredOff) {
        finish(new Error("Bluetooth is off. Turn it on and try again."));
      } else if (state === State.Unauthorized) {
        finish(new Error("Allow Bluetooth for Nearby in Settings, then try again."));
      } else if (state === State.Unsupported) {
        finish(new Error("This device has no Bluetooth. Use a physical iPhone."));
      }
    }, true);
  });
}

function pendantStatus(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (
    !bluetoothReady() ||
    message.includes("createClient") ||
    message.includes("BlePlx")
  ) {
    return "Open Nearby on your iPhone to connect. This browser cannot use Bluetooth.";
  }
  return message || fallback;
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

function clipUtf8(text: string, maxBytes: number): Uint8Array {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact || maxBytes < 1) return new Uint8Array();
  const bytes = new TextEncoder().encode(compact);
  if (bytes.length <= maxBytes) return bytes;
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return bytes.slice(0, end);
}

export function PendantProvider({ children }: { children: ReactNode }) {
  const { user, profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const userRef = useRef(user);
  userRef.current = user;
  const managerRef = useRef<BleManager | null>(null);
  const subsRef = useRef<Subscription[]>([]);
  const pcmRef = useRef<number[]>([]);
  const collectingRef = useRef(false);
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendingRef = useRef(false);
  const deviceRef = useRef<Device | null>(null);
  const replyLimitRef = useRef(20);
  const [status, setStatus] = useState("Pendant not added");
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<FoundPendant[]>([]);
  const [chat, setChat] = useState<PendantChat | null>(null);

  const pairedCode = profile?.pendantId ?? null;
  const pairedCodeRef = useRef(pairedCode);
  pairedCodeRef.current = pairedCode;

  const connectedStatus = useCallback(() => {
    const code = pairedCodeRef.current;
    return code ? `Connected to ${pendantDisplayName(code)}` : "Pendant not added";
  }, []);

  const manager = useCallback(() => {
    if (!bluetoothReady()) {
      throw new Error("Bluetooth is only available in the iPhone app.");
    }
    if (!managerRef.current) managerRef.current = new BleManager();
    return managerRef.current;
  }, []);

  const sendReplyText = useCallback(async (text: string) => {
    const device = deviceRef.current;
    if (!device) return;
    const payload = clipUtf8(text, replyLimitRef.current);
    if (payload.length === 0) return;
    try {
      await device.writeCharacteristicWithResponseForService(
        SERVICE,
        REPLY,
        encodeBase64(payload),
      );
    } catch (error) {
      console.warn("Pendant display did not accept the reply", error);
    }
  }, []);

  const finishTurn = useCallback(async () => {
    const signedIn = userRef.current;
    if (sendingRef.current || !signedIn) return;
    const bytes = Uint8Array.from(pcmRef.current);
    pcmRef.current = [];
    collectingRef.current = false;
    if (quietTimerRef.current) {
      clearTimeout(quietTimerRef.current);
      quietTimerRef.current = null;
    }
    if (bytes.length < 1600) {
      setChat(null);
      setStatus(connectedStatus());
      return;
    }
    sendingRef.current = true;
    setChat({ request: null, reply: null, busy: true, error: null });
    setStatus("Sending what you said…");
    const publish = async (request: string | null, reply: string) => {
      setChat({ request, reply, busy: false, error: null });
      setStatus(connectedStatus());
      void speak(reply);
      void sendReplyText(reply);
      await queryClient.invalidateQueries({ queryKey: ["agent-history"] });
      await queryClient.invalidateQueries({ queryKey: ["agent-memories"] });
    };
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
        | { reply?: string; error?: string; code?: string; text?: string }
        | null;
      if (res.status === 409 && payload?.code === "location_required" && payload.text) {
        setChat({ request: payload.text, reply: null, busy: true, error: null });
        setStatus("Nearby needs your location for that.");
        const location = await readDeviceLocation();
        const retry = await fetch(`${API_URL}/v1/agent`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: payload.text,
            timeZone,
            ...(location ? { location } : {}),
          }),
        });
        const answered = (await retry.json().catch(() => null)) as
          | { reply?: string; error?: string }
          | null;
        if (!retry.ok || !answered?.reply) {
          throw new Error(answered?.error ?? "The assistant didn't answer");
        }
        await publish(payload.text, answered.reply);
        return;
      }
      if (!res.ok || !payload?.reply) {
        throw new Error(payload?.error ?? "The assistant didn't answer");
      }
      await publish(payload.text ?? null, payload.reply);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send that turn";
      setChat({ request: null, reply: null, busy: false, error: message });
      setStatus(message);
    } finally {
      sendingRef.current = false;
    }
  }, [connectedStatus, queryClient, sendReplyText]);

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
      await waitForBluetooth(ble);
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
    const negotiated = await connected.requestMTU(247).catch(() => connected);
    const mtu = negotiated.mtu > 3 ? negotiated.mtu : 23;
    replyLimitRef.current = Math.min(REPLY_MAX_BYTES, mtu - 3);
    deviceRef.current = negotiated;
    await writeNearbyTime(negotiated).catch((error: unknown) => {
      console.warn("Pendant clock sync failed", error);
    });
    setStatus(`Connected to ${pendantDisplayName(code)}`);
    const audioSub = negotiated.monitorCharacteristicForService(
      SERVICE,
      AUDIO,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        noteAudio(decodeBase64(characteristic.value));
      },
    );
    const eventSub = negotiated.monitorCharacteristicForService(
      SERVICE,
      EVENT,
      (error) => {
        if (error) return;
        void stop();
        pcmRef.current = [];
        collectingRef.current = true;
        setChat({ request: null, reply: null, busy: true, error: null });
        setStatus("Heard you");
        if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
        quietTimerRef.current = setTimeout(() => {
          void finishTurn();
        }, 8000);
      },
    );
    const disconnectSub = bleDisconnect(negotiated, code);
    subsRef.current = [audioSub, eventSub, disconnectSub];
  }
  listenRef.current = listen;

  function bleDisconnect(device: Device, code: string): Subscription {
    return manager().onDeviceDisconnected(device.id, () => {
      if (deviceRef.current?.id === device.id) deviceRef.current = null;
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
    if (!pairedCode || !user || !bluetoothReady()) return;
    let cancelled = false;
    void connectPaired(pairedCode).catch((error: unknown) => {
      if (!cancelled) {
        setStatus(pendantStatus(error, "Could not connect"));
      }
    });
    return () => {
      cancelled = true;
      deviceRef.current = null;
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
      await waitForBluetooth(ble);
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
          await waitForBluetooth(ble);
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
    deviceRef.current = null;
    subsRef.current.forEach((sub) => sub.remove());
    await updateUserProfile(profile.id, { pendantId: null });
    await refreshProfile();
    setStatus("Pendant removed from this account.");
  }, [manager, profile, refreshProfile]);

  const value = useMemo(
    () => ({ status, scanning, found, pairedCode, chat, find, pair, forget, sendReplyText }),
    [status, scanning, found, pairedCode, chat, find, pair, forget, sendReplyText],
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
  if (!bluetoothReady()) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>Pendant</Text>
        <Text style={styles.status}>
          {pairedCode
            ? `${pendantDisplayName(pairedCode)} is saved on this account. Open the Nearby app on your iPhone to connect.`
            : "No pendant yet. On your iPhone, open Talk, tap More, then Add."}
        </Text>
        {pairedCode ? (
          <Pressable onPress={() => void forget()} style={styles.secondary}>
            <Text style={styles.secondaryText}>Remove from account</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
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
