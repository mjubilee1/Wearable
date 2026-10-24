"use client";

import { useCallback, useEffect, useState } from "react";
import type { GeoPoint } from "@nearby/shared";
import { browserLocationService } from "@/lib/device-location";

const PILOT_LOCATION: GeoPoint = {
  latitude: Number(process.env.NEXT_PUBLIC_PILOT_LATITUDE ?? 38.9216),
  longitude: Number(process.env.NEXT_PUBLIC_PILOT_LONGITUDE ?? -77.0425),
};

export function useSpatialLocation() {
  const [location, setLocation] = useState<GeoPoint>(PILOT_LOCATION);
  const [usingDevice, setUsingDevice] = useState(false);
  const [label, setLabel] = useState("Adams Morgan · DC");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await browserLocationService.permissionState();
      if (cancelled) return;
      if (state !== "granted") {
        setReady(true);
        return;
      }
      try {
        const current = await browserLocationService.getCurrentLocation({
          requestPermission: false,
        });
        if (cancelled) return;
        setLocation({
          latitude: current.latitude,
          longitude: current.longitude,
          ...(current.accuracyMeters !== null
            ? { accuracyMeters: current.accuracyMeters }
            : {}),
        });
        setUsingDevice(true);
        setLabel("Around you");
      } catch {
        // Keep the labeled example center.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const requestDeviceLocation = useCallback(async () => {
    const current = await browserLocationService.getCurrentLocation({
      requestPermission: true,
    });
    const next = {
      latitude: current.latitude,
      longitude: current.longitude,
      ...(current.accuracyMeters !== null
        ? { accuracyMeters: current.accuracyMeters }
        : {}),
    };
    setLocation(next);
    setUsingDevice(true);
    setLabel("Around you");
    return next;
  }, []);

  const setManual = useCallback((next: GeoPoint, nextLabel: string) => {
    setLocation(next);
    setUsingDevice(false);
    setLabel(nextLabel);
  }, []);

  return {
    location,
    usingDevice,
    label,
    ready,
    pilot: PILOT_LOCATION,
    requestDeviceLocation,
    setManual,
    setLocation,
    setUsingDevice,
    setLabel,
  };
}
