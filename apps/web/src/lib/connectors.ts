export type ConnectorId =
  | "google"
  | "google_calendar"
  | "google_tasks"
  | "gmail"
  | "notes"
  | "reminders";

export type ConnectorCatalogItem = {
  id: ConnectorId;
  name: string;
  blurb: string;
  kind: "oauth" | "built_in";
  /** Same Google OAuth session as Calendar / Tasks / Gmail. */
  googleBundle?: boolean;
};

export const CONNECTOR_CATALOG: ConnectorCatalogItem[] = [
  {
    id: "google_calendar",
    name: "Google Calendar",
    blurb: "Read today's events when you ask in Talk.",
    kind: "oauth",
    googleBundle: true,
  },
  {
    id: "google_tasks",
    name: "Google Tasks",
    blurb: "Reminders you speak get added to your default Tasks list.",
    kind: "oauth",
    googleBundle: true,
  },
  {
    id: "gmail",
    name: "Gmail",
    blurb: "Hear a short unread digest when you ask.",
    kind: "oauth",
    googleBundle: true,
  },
  {
    id: "notes",
    name: "Notes",
    blurb: "Save a short note in Nearby when you ask.",
    kind: "built_in",
  },
];

const LEGACY_FAVORITE_MAP: Record<string, ConnectorId> = {
  google: "google_calendar",
  reminders: "google_tasks",
};

function normalizeFavoriteId(id: string): ConnectorId | null {
  const mapped = LEGACY_FAVORITE_MAP[id] ?? id;
  return CONNECTOR_CATALOG.some((item) => item.id === mapped)
    ? (mapped as ConnectorId)
    : null;
}

type SetupPrefs = {
  favorites: ConnectorId[];
  dismissedAt: number | null;
};

function storageKey(uid: string) {
  return `nearby-connector-setup:${uid}`;
}

export function readConnectorSetup(uid: string): SetupPrefs {
  if (typeof window === "undefined") {
    return { favorites: [], dismissedAt: null };
  }
  try {
    const raw = window.localStorage.getItem(storageKey(uid));
    if (!raw) return { favorites: [], dismissedAt: null };
    const parsed = JSON.parse(raw) as SetupPrefs;
    const favorites = Array.isArray(parsed.favorites)
      ? parsed.favorites
          .map((id) => (typeof id === "string" ? normalizeFavoriteId(id) : null))
          .filter((id): id is ConnectorId => id !== null)
      : [];
    return {
      favorites: Array.from(new Set(favorites)),
      dismissedAt:
        typeof parsed.dismissedAt === "number" ? parsed.dismissedAt : null,
    };
  } catch {
    return { favorites: [], dismissedAt: null };
  }
}

export function writeConnectorSetup(uid: string, prefs: SetupPrefs) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(uid), JSON.stringify(prefs));
}

export function shouldPromptConnectorSetup(uid: string): boolean {
  const prefs = readConnectorSetup(uid);
  return prefs.dismissedAt == null && prefs.favorites.length === 0;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
