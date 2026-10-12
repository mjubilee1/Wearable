import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getFirebaseAdmin, isFirebaseConfigured } from "../firebase.js";

/** One Google connect unlocks Calendar, Tasks, and Gmail read. */
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

type GoogleTokens = {
  accessToken: string;
  refreshToken: string;
  expiryMs: number;
  email?: string;
};

type StoredConnector = GoogleTokens & {
  provider: "google_calendar";
  updatedAt: number;
};

const memoryByUid = new Map<string, StoredConnector>();

function clientId(): string {
  return process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
}

function clientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
}

function redirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    `${process.env.API_PUBLIC_URL?.trim() || `http://localhost:${process.env.PORT ?? 4000}`}/v1/connectors/google/calendar/callback`
  );
}

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL?.trim() || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

function stateSecret(): string {
  return (
    process.env.CONNECTOR_STATE_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    "nearby-dev-connector-state"
  );
}

export function isGoogleCalendarConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

function signState(payload: string): string {
  return createHmac("sha256", stateSecret()).update(payload).digest("base64url");
}

export function buildGoogleAuthUrl(uid: string): string {
  if (!isGoogleCalendarConfigured()) {
    throw new Error("Google Calendar is not configured on the API");
  }
  const body = Buffer.from(
    JSON.stringify({
      uid,
      exp: Date.now() + 10 * 60 * 1000,
      n: randomBytes(8).toString("hex"),
    }),
  ).toString("base64url");
  const state = `${body}.${signState(body)}`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

function parseState(state: string): { uid: string } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = signState(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as { uid?: string; exp?: number };
    if (typeof parsed.uid !== "string" || !parsed.uid) return null;
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return { uid: parsed.uid };
  } catch {
    return null;
  }
}

async function readConnector(uid: string): Promise<StoredConnector | null> {
  if (!isFirebaseConfigured()) return memoryByUid.get(uid) ?? null;
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("agentConnectors")
    .doc(uid)
    .get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (data.provider !== "google_calendar") return null;
  if (
    typeof data.accessToken !== "string" ||
    typeof data.refreshToken !== "string" ||
    typeof data.expiryMs !== "number"
  ) {
    return null;
  }
  return {
    provider: "google_calendar",
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiryMs: data.expiryMs,
    email: typeof data.email === "string" ? data.email : undefined,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
  };
}

async function writeConnector(uid: string, row: StoredConnector): Promise<void> {
  if (!isFirebaseConfigured()) {
    memoryByUid.set(uid, row);
    return;
  }
  await getFirebaseAdmin()
    .firestore()
    .collection("agentConnectors")
    .doc(uid)
    .set(row);
}

async function clearConnector(uid: string): Promise<void> {
  if (!isFirebaseConfigured()) {
    memoryByUid.delete(uid);
    return;
  }
  await getFirebaseAdmin()
    .firestore()
    .collection("agentConnectors")
    .doc(uid)
    .delete();
}

async function exchangeCode(code: string): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error ?? "Google token exchange failed");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    expiryMs: Date.now() + Math.max(30, Number(data.expires_in ?? 3600) - 60) * 1000,
  };
}

async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error ?? "Google token refresh failed");
  }
  return {
    accessToken: data.access_token,
    refreshToken,
    expiryMs: Date.now() + Math.max(30, Number(data.expires_in ?? 3600) - 60) * 1000,
  };
}

async function fetchGoogleEmail(accessToken: string): Promise<string | undefined> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return undefined;
  const data = (await res.json().catch(() => ({}))) as { email?: string };
  return typeof data.email === "string" ? data.email : undefined;
}

async function getValidAccessToken(uid: string): Promise<string | null> {
  const stored = await readConnector(uid);
  if (!stored?.refreshToken && !stored?.accessToken) return null;
  if (stored.expiryMs > Date.now() + 15_000) return stored.accessToken;
  if (!stored.refreshToken) return null;
  try {
    const next = await refreshAccessToken(stored.refreshToken);
    const row: StoredConnector = {
      provider: "google_calendar",
      accessToken: next.accessToken,
      refreshToken: stored.refreshToken,
      expiryMs: next.expiryMs,
      email: stored.email,
      updatedAt: Date.now(),
    };
    await writeConnector(uid, row);
    return row.accessToken;
  } catch {
    return null;
  }
}

export async function getGoogleCalendarStatus(uid: string): Promise<{
  configured: boolean;
  connected: boolean;
  email: string | null;
}> {
  const configured = isGoogleCalendarConfigured();
  if (!configured) {
    return { configured: false, connected: false, email: null };
  }
  const stored = await readConnector(uid);
  return {
    configured: true,
    connected: Boolean(stored?.refreshToken || stored?.accessToken),
    email: stored?.email ?? null,
  };
}

export async function handleGoogleCalendarCallback(input: {
  code: string | undefined;
  state: string | undefined;
  error: string | undefined;
}): Promise<string> {
  const done = (query: string) => `${appBaseUrl()}/connectors?${query}`;
  if (input.error) return done(`calendar=error&reason=${encodeURIComponent(input.error)}`);
  if (!input.code || !input.state) return done("calendar=error&reason=missing_code");
  const parsed = parseState(input.state);
  if (!parsed) return done("calendar=error&reason=bad_state");
  try {
    const tokens = await exchangeCode(input.code);
    if (!tokens.refreshToken) {
      const existing = await readConnector(parsed.uid);
      if (!existing?.refreshToken) {
        return done("calendar=error&reason=no_refresh_token");
      }
      tokens.refreshToken = existing.refreshToken;
    }
    const email = await fetchGoogleEmail(tokens.accessToken);
    await writeConnector(parsed.uid, {
      provider: "google_calendar",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiryMs: tokens.expiryMs,
      email,
      updatedAt: Date.now(),
    });
    return done("calendar=connected");
  } catch (error) {
    const reason =
      error instanceof Error ? error.message.slice(0, 80) : "exchange_failed";
    return done(`calendar=error&reason=${encodeURIComponent(reason)}`);
  }
}

export async function disconnectGoogleCalendar(uid: string): Promise<void> {
  await clearConnector(uid);
}

type CalendarEvent = {
  summary: string;
  startLabel: string;
};

function formatEventTime(raw: string | undefined, allDay: boolean): string {
  if (!raw) return "";
  if (allDay) return "all day";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function speakTodaysCalendar(uid: string): Promise<string> {
  if (!isGoogleCalendarConfigured()) {
    return "Calendar isn't set up on the server yet.";
  }
  const accessToken = await getValidAccessToken(uid);
  if (!accessToken) {
    return "Connect Google in Connectors first, then ask again.";
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", start.toISOString());
  url.searchParams.set("timeMax", end.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "8");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    return "Google access expired. Connect it again in Connectors.";
  }
  if (!res.ok) {
    console.error("[calendar] list failed", await res.text());
    return "I couldn't read your calendar just now.";
  }

  const data = (await res.json()) as {
    items?: Array<{
      summary?: string;
      start?: { dateTime?: string; date?: string };
    }>;
  };
  const events: CalendarEvent[] = (data.items ?? [])
    .map((item) => {
      const allDay = Boolean(item.start?.date && !item.start?.dateTime);
      const startRaw = item.start?.dateTime ?? item.start?.date;
      return {
        summary: (item.summary || "Busy").trim(),
        startLabel: formatEventTime(startRaw, allDay),
      };
    })
    .filter((item) => item.summary);

  if (events.length === 0) {
    return "You're free today. Nothing on the calendar.";
  }

  const spoken = events
    .slice(0, 5)
    .map((event) =>
      event.startLabel ? `${event.summary} at ${event.startLabel}` : event.summary,
    )
    .join(". ");

  if (events.length === 1) return `Today: ${spoken}.`;
  return `Today you have ${events.length} events. ${spoken}.`;
}

function taskDueRfc3339(when: string | undefined): string | undefined {
  if (!when?.trim()) return undefined;
  const raw = when.trim();
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }
  const lower = raw.toLowerCase();
  const base = new Date();
  base.setSeconds(0, 0);
  if (lower === "today") {
    base.setHours(18, 0, 0, 0);
    return base.toISOString();
  }
  if (lower === "tomorrow") {
    base.setDate(base.getDate() + 1);
    base.setHours(9, 0, 0, 0);
    return base.toISOString();
  }
  return undefined;
}

/** Push a reminder into the user's default Google Tasks list. */
export async function createGoogleTask(
  uid: string,
  title: string,
  when?: string,
): Promise<{ ok: true; spoken: string } | { ok: false; spoken: string }> {
  if (!isGoogleCalendarConfigured()) {
    return { ok: false, spoken: "Google isn't set up on the server yet." };
  }
  const accessToken = await getValidAccessToken(uid);
  if (!accessToken) {
    return {
      ok: false,
      spoken: "Connect Google in Connectors to save tasks there.",
    };
  }

  const body: { title: string; due?: string; notes?: string } = {
    title: title.slice(0, 200),
  };
  const due = taskDueRfc3339(when);
  if (due) body.due = due;
  if (when && !due) body.notes = `When: ${when}`;

  const res = await fetch(
    "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (res.status === 401) {
    return {
      ok: false,
      spoken: "Google access expired. Connect it again in Connectors.",
    };
  }
  if (!res.ok) {
    console.error("[tasks] create failed", await res.text());
    return { ok: false, spoken: "I couldn't add that to Google Tasks." };
  }
  if (when) {
    return {
      ok: true,
      spoken: `Added to Google Tasks for ${when}.`,
    };
  }
  return { ok: true, spoken: "Added to Google Tasks." };
}

function headerValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string {
  const hit = headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return (hit?.value ?? "").trim();
}

/** Speak a short digest of recent unread mail. */
export async function speakUnreadGmail(uid: string): Promise<string> {
  if (!isGoogleCalendarConfigured()) {
    return "Gmail isn't set up on the server yet.";
  }
  const accessToken = await getValidAccessToken(uid);
  if (!accessToken) {
    return "Connect Google in Connectors first, then ask again.";
  }

  const listUrl = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  listUrl.searchParams.set("q", "is:unread newer_than:7d");
  listUrl.searchParams.set("maxResults", "5");

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (listRes.status === 401) {
    return "Google access expired. Connect it again in Connectors.";
  }
  if (!listRes.ok) {
    console.error("[gmail] list failed", await listRes.text());
    return "I couldn't read Gmail just now.";
  }

  const listData = (await listRes.json()) as {
    messages?: Array<{ id?: string }>;
    resultSizeEstimate?: number;
  };
  const ids = (listData.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id))
    .slice(0, 5);

  if (ids.length === 0) {
    return "No unread mail in the last week.";
  }

  const snippets: string[] = [];
  for (const id of ids.slice(0, 3)) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!msgRes.ok) continue;
    const msg = (await msgRes.json()) as {
      payload?: { headers?: Array<{ name?: string; value?: string }> };
      snippet?: string;
    };
    const from = headerValue(msg.payload?.headers, "From")
      .replace(/<.*>/, "")
      .trim();
    const subject = headerValue(msg.payload?.headers, "Subject") || "No subject";
    const who = from || "someone";
    snippets.push(`${who}: ${subject}`);
  }

  if (snippets.length === 0) {
    return "You have unread mail, but I couldn't read the subjects.";
  }

  const estimate = listData.resultSizeEstimate ?? ids.length;
  const head =
    estimate > snippets.length
      ? `You have about ${estimate} unread messages. Top ones:`
      : `You have ${snippets.length} unread.`;
  return `${head} ${snippets.join(". ")}.`;
}
