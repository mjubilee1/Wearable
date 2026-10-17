import AsyncStorage from "@react-native-async-storage/async-storage";

export type ConnectorId =
  | "google_calendar"
  | "google_tasks"
  | "gmail"
  | "notes";

export type ConnectorCatalogItem = {
  id: ConnectorId;
  name: string;
  canDo: string;
  googleBundle?: boolean;
  locked?: boolean;
};

export const CONNECTOR_CATALOG: ConnectorCatalogItem[] = [
  {
    id: "google_calendar",
    name: "Google Calendar",
    canDo: "Calendar: read your day, and reschedule after you Confirm.",
    googleBundle: true,
  },
  {
    id: "google_tasks",
    name: "Google Tasks",
    canDo: "Tasks: add a task when you ask.",
    googleBundle: true,
  },
  {
    id: "gmail",
    name: "Gmail",
    canDo: "Gmail: summarize unread mail, and save drafts (never send).",
    googleBundle: true,
  },
  {
    id: "notes",
    name: "Notes",
    canDo: "Notes: save a note when you ask.",
    locked: true,
  },
];

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

type SetupPrefs = {
  favorites: ConnectorId[];
  dismissedAt: number | null;
};

function storageKey(uid: string) {
  return `nearby-connector-setup:${uid}`;
}

export async function readConnectorSetup(uid: string): Promise<SetupPrefs> {
  const raw = await AsyncStorage.getItem(storageKey(uid));
  if (!raw) return { favorites: [], dismissedAt: null };
  try {
    const parsed = JSON.parse(raw) as SetupPrefs;
    const favorites = (parsed.favorites ?? []).filter((id) =>
      CONNECTOR_CATALOG.some((item) => item.id === id),
    );
    return { favorites, dismissedAt: parsed.dismissedAt ?? null };
  } catch {
    return { favorites: [], dismissedAt: null };
  }
}

export async function writeConnectorSetup(uid: string, prefs: SetupPrefs) {
  await AsyncStorage.setItem(storageKey(uid), JSON.stringify(prefs));
}

export type GoogleCalendarStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
};

export async function fetchGoogleCalendarStatus(
  token: string,
): Promise<GoogleCalendarStatus> {
  const res = await fetch(`${API_URL}/v1/connectors/google/calendar`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Could not load Google status");
  return (await res.json()) as GoogleCalendarStatus;
}

export async function startGoogleCalendarConnect(token: string): Promise<string> {
  const res = await fetch(`${API_URL}/v1/connectors/google/calendar/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!res.ok || !body.url) {
    throw new Error(body.error ?? "Google connect isn't configured yet");
  }
  return body.url;
}

export async function disconnectGoogleCalendar(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/v1/connectors/google/calendar`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Could not disconnect");
}
