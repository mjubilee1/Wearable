export type ConnectorId = "google_calendar" | "notes" | "reminders";

export type ConnectorCatalogItem = {
  id: ConnectorId;
  name: string;
  blurb: string;
  kind: "oauth" | "built_in";
};

export const CONNECTOR_CATALOG: ConnectorCatalogItem[] = [
  {
    id: "google_calendar",
    name: "Google Calendar",
    blurb: "Read today's events when you allow it in Talk.",
    kind: "oauth",
  },
  {
    id: "notes",
    name: "Notes",
    blurb: "Save a short note in Nearby after you allow it.",
    kind: "built_in",
  },
  {
    id: "reminders",
    name: "Reminders",
    blurb: "Set a reminder in Nearby after you allow it.",
    kind: "built_in",
  },
];

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
      ? parsed.favorites.filter((id): id is ConnectorId =>
          CONNECTOR_CATALOG.some((item) => item.id === id),
        )
      : [];
    return {
      favorites,
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
  if (!res.ok) throw new Error("Could not load calendar status");
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
    throw new Error(body.error ?? "Calendar connect isn't configured yet");
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
