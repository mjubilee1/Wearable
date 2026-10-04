import type { ClipSightingView } from "@nearby/shared";
import { auth } from "@/lib/firebase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function authHeader(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  return `Bearer ${token}`;
}

/** Debug feed of BLE reports the phone already posted. No names. */
export async function fetchClipSightings(): Promise<ClipSightingView[]> {
  const res = await fetch(`${API_URL}/v1/ble/sightings`, {
    headers: {
      Authorization: await authHeader(),
    },
    cache: "no-store",
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
