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
import { AppState, type AppStateStatus } from "react-native";
import { clipsMatch, type ClipSightingView } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import {
  getBleAvailability,
  startNearbyClipScan,
  type NearbyClipSighting,
} from "@/lib/ble";
import { postClipSighting } from "@/lib/sightings";

type ClipScanContextValue = {
  scanning: boolean;
  availabilityMessage: string | null;
  liveSightings: NearbyClipSighting[];
  lastReports: ClipSightingView[];
  scanError: string | null;
};

const ClipScanContext = createContext<ClipScanContextValue | null>(null);

const POST_MIN_INTERVAL_MS = 1500;

export function ClipScanProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [scanning, setScanning] = useState(false);
  const [availabilityMessage, setAvailabilityMessage] = useState<string | null>(
    null,
  );
  const [liveSightings, setLiveSightings] = useState<NearbyClipSighting[]>([]);
  const [lastReports, setLastReports] = useState<ClipSightingView[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  const lastPostedAt = useRef<Map<string, number>>(new Map());
  const ownClipId = profile?.deviceId ?? null;

  useEffect(() => {
    const sub = AppState.addEventListener("change", setAppState);
    return () => sub.remove();
  }, []);

  const mergeReport = useCallback((report: ClipSightingView) => {
    setLastReports((prev) => {
      const without = prev.filter(
        (r) => r.remoteClipId !== report.remoteClipId,
      );
      return [report, ...without].slice(0, 40);
    });
  }, []);

  useEffect(() => {
    if (!user || appState !== "active") {
      setScanning(false);
      setLiveSightings([]);
      return;
    }

    let cancelled = false;
    let handle: { stop: () => void } | null = null;

    async function begin() {
      const availability = await getBleAvailability();
      if (cancelled) return;

      if (availability.status !== "ready") {
        setAvailabilityMessage(availability.reason);
        setScanning(false);
        return;
      }

      setAvailabilityMessage(null);
      setScanError(null);
      setScanning(true);

      handle = startNearbyClipScan(
        (sightings) => {
          if (cancelled) return;

          const filtered = sightings.filter(
            (s) => !clipsMatch(s.clipId, ownClipId),
          );
          setLiveSightings(filtered);

          const now = Date.now();
          for (const sighting of filtered) {
            const last = lastPostedAt.current.get(sighting.clipId) ?? 0;
            if (now - last < POST_MIN_INTERVAL_MS) continue;
            lastPostedAt.current.set(sighting.clipId, now);

            void postClipSighting({
              remoteClipId: sighting.clipId,
              rssi: Math.round(sighting.smoothedRssi),
              timestamp: sighting.lastSeenAtMs,
            })
              .then((report) => {
                if (!cancelled) mergeReport(report);
              })
              .catch((error) => {
                if (cancelled) return;
                const message =
                  error instanceof Error ? error.message : "POST failed";
                // Own-clip / auth blips shouldn't spam the UI.
                if (!message.includes("own clip")) {
                  setScanError(message);
                }
              });
          }
        },
        (message) => {
          if (!cancelled) setScanError(message);
        },
      );

      if (cancelled) {
        handle.stop();
        handle = null;
      }
    }

    void begin();

    return () => {
      cancelled = true;
      handle?.stop();
      setScanning(false);
    };
  }, [user, appState, ownClipId, mergeReport]);

  const value = useMemo(
    () => ({
      scanning,
      availabilityMessage,
      liveSightings,
      lastReports,
      scanError,
    }),
    [scanning, availabilityMessage, liveSightings, lastReports, scanError],
  );

  return (
    <ClipScanContext.Provider value={value}>{children}</ClipScanContext.Provider>
  );
}

export function useClipScan() {
  const ctx = useContext(ClipScanContext);
  if (!ctx) throw new Error("useClipScan must be used within ClipScanProvider");
  return ctx;
}
