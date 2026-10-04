import type { ClipSightingPost, ClipSightingView } from "@nearby/shared";
import { auth } from "@/lib/firebase";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

async function authHeader(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  return `Bearer ${token}`;
}

export async function postClipSighting(
  body: ClipSightingPost,
): Promise<ClipSightingView> {
  const res = await fetch(`${API_URL}/v1/ble/sightings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: await authHeader(),
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as ClipSightingView & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? `Sighting failed (${res.status})`);
  }
  return {
    remoteClipId: data.remoteClipId,
    rssi: data.rssi,
    timestamp: data.timestamp,
    close: data.close,
    green: data.green,
  };
}

export async function fetchClipSightings(): Promise<ClipSightingView[]> {
  const res = await fetch(`${API_URL}/v1/ble/sightings`, {
    headers: {
      Authorization: await authHeader(),
    },
  });
  const data = (await res.json().catch(() => ({}))) as {
    reports?: ClipSightingView[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? `Could not load sightings (${res.status})`);
  }
  return data.reports ?? [];
}
