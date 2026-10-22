import { useEffect, useState } from "react";
import {
  NETWORK_CONSENT_VERSION,
  createForegroundSensingController,
  type SensingController,
} from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import {
  registerObservationNode,
  submitNodeObservations,
} from "@/lib/spatial-api";
import {
  createMobileLocationAdapter,
  createMobileMotionAdapter,
} from "./adapters";

const PREFS_KEY = "nearby.sensing.prefs";
const listeners = new Set<() => void>();

export type SensingPrefs = {
  installationId: string;
  status: "off" | "ACTIVE" | "PAUSED" | "REVOKED";
  location: boolean;
  motion: boolean;
};

function createId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const nibble = char === "x" ? value : (value & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

async function storage() {
  const AsyncStorage = (await import("@react-native-async-storage/async-storage"))
    .default;
  return AsyncStorage;
}

export async function readSensingPrefs(): Promise<SensingPrefs> {
  const fallback: SensingPrefs = {
    installationId: createId(),
    status: "off",
    location: false,
    motion: false,
  };
  try {
    const raw = await (await storage()).getItem(PREFS_KEY);
    if (!raw) {
      await (await storage()).setItem(PREFS_KEY, JSON.stringify(fallback));
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<SensingPrefs>;
    return {
      installationId:
        typeof parsed.installationId === "string"
          ? parsed.installationId
          : fallback.installationId,
      status:
        parsed.status === "ACTIVE" ||
        parsed.status === "PAUSED" ||
        parsed.status === "REVOKED"
          ? parsed.status
          : "off",
      location: parsed.location === true,
      motion: parsed.motion === true,
    };
  } catch {
    return fallback;
  }
}

export async function writeSensingPrefs(prefs: SensingPrefs): Promise<void> {
  await (await storage()).setItem(PREFS_KEY, JSON.stringify(prefs));
  for (const listener of listeners) listener();
}

export function subscribeSensing(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let holders = 0;
let controller: SensingController | null = null;
let starting: Promise<void> | null = null;

async function shutdown(): Promise<void> {
  const current = controller;
  controller = null;
  if (current) await current.stop();
}

export async function retainForegroundSensing(token: string): Promise<() => void> {
  const prefs = await readSensingPrefs();
  if (prefs.status !== "ACTIVE" || !prefs.location) return () => {};
  holders += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) void shutdown();
  };
  if (!controller && !starting) {
    const next = createForegroundSensingController({
      nodeType: "MOBILE",
      installationId: prefs.installationId,
      consent: { location: true, motion: prefs.motion },
      claimedCapabilities: [
        "location_foreground",
        "motion_estimate",
        "bluetooth_proximity",
        "wifi_presence",
        "background_location",
      ],
      transport: {
        async register(body) {
          return registerObservationNode(token, body);
        },
        async submit(body) {
          const result = await submitNodeObservations(token, body);
          return {
            nodeStatus:
              result.nodeStatus === "PAUSED" || result.nodeStatus === "REVOKED"
                ? result.nodeStatus
                : "ACTIVE",
            results: result.results,
          };
        },
      },
      location: createMobileLocationAdapter(),
      motion: prefs.motion ? createMobileMotionAdapter() : undefined,
    });
    starting = next
      .start()
      .then((result) => {
        if (result.running && holders > 0) controller = next;
        else void next.stop();
      })
      .finally(() => {
        starting = null;
      });
  }
  await starting;
  if (!controller) release();
  return release;
}

export function useForegroundSensing(): void {
  const { user } = useAuth();
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeSensing(() => setVersion((value) => value + 1)), []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    let release: (() => void) | undefined;
    void (async () => {
      const token = await user.getIdToken();
      if (!active) return;
      release = await retainForegroundSensing(token);
      if (!active) release();
    })();
    return () => {
      active = false;
      release?.();
    };
  }, [user, version]);
}

export const SENSING_CONSENT_VERSION = NETWORK_CONSENT_VERSION;
