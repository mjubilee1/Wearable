import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AgentActionReceipt } from "@nearby/shared";
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
  htmlLink: string | null;
};

export type GoogleToolResult = {
  spoken: string;
  receipt: AgentActionReceipt | null;
};

function httpsHref(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function dayWindow(when: "today" | "tomorrow"): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (when === "tomorrow") start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function calendarDayHref(start: Date): string {
  const year = start.getFullYear();
  const month = start.getMonth() + 1;
  const day = start.getDate();
  return `https://calendar.google.com/calendar/u/0/r/day/${year}/${month}/${day}`;
}

function withName(name: string | null, sentence: string): string {
  if (!name) return sentence;
  const keep =
    sentence.startsWith("I ") || sentence.startsWith("I'");
  const spoken = keep
    ? sentence
    : `${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
  return `${name}, ${spoken}`;
}

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

function eventPhrase(event: CalendarEvent): string {
  if (!event.startLabel) return event.summary;
  if (event.startLabel === "all day") return `${event.summary}, all day`;
  return `${event.summary} at ${event.startLabel}`;
}

export async function readCalendar(
  uid: string,
  options: { when: "today" | "tomorrow"; firstOnly: boolean; name: string | null },
): Promise<GoogleToolResult> {
  const whenWord = options.when === "tomorrow" ? "tomorrow" : "today";
  if (!isGoogleCalendarConfigured()) {
    return { spoken: "Calendar isn't set up on the server yet.", receipt: null };
  }
  const accessToken = await getValidAccessToken(uid);
  if (!accessToken) {
    return {
      spoken: "Connect Google in Connectors first, then ask again.",
      receipt: null,
    };
  }

  const { start, end } = dayWindow(options.when);
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
    return {
      spoken: "Google access expired. Connect it again in Connectors.",
      receipt: null,
    };
  }
  if (!res.ok) {
    console.error("[calendar] list failed", await res.text());
    return { spoken: "I couldn't read your calendar just now.", receipt: null };
  }

  const data = (await res.json()) as {
    items?: Array<{
      summary?: string;
      status?: string;
      htmlLink?: string;
      start?: { dateTime?: string; date?: string };
    }>;
  };
  const events: CalendarEvent[] = (data.items ?? [])
    .filter((item) => item.status !== "cancelled")
    .map((item) => {
      const allDay = Boolean(item.start?.date && !item.start?.dateTime);
      const startRaw = item.start?.dateTime ?? item.start?.date;
      return {
        summary: (item.summary || "Busy").trim(),
        startLabel: formatEventTime(startRaw, allDay),
        htmlLink: httpsHref(item.htmlLink),
      };
    })
    .filter((item) => item.summary);

  const dayHref = calendarDayHref(start);
  if (events.length === 0) {
    const spoken = options.firstOnly
      ? withName(options.name, `You don't have a meeting ${whenWord}.`)
      : withName(options.name, `You're free ${whenWord}. Nothing on the calendar.`);
    return {
      spoken,
      receipt: {
        action: `Checked ${whenWord}'s calendar`,
        href: dayHref,
        linkLabel: "Open calendar",
      },
    };
  }

  const primary = events[0];
  const href = primary.htmlLink ?? dayHref;
  if (options.firstOnly) {
    return {
      spoken: withName(
        options.name,
        `Your first meeting ${whenWord} is ${eventPhrase(primary)}.`,
      ),
      receipt: {
        action: `Checked ${whenWord}'s first meeting`,
        href,
        linkLabel: primary.htmlLink ? "Open event" : "Open calendar",
      },
    };
  }

  const listed = events.slice(0, 5).map(eventPhrase).join(". ");
  const spoken =
    events.length === 1
      ? withName(options.name, `${whenWord === "today" ? "Today" : "Tomorrow"}: ${listed}.`)
      : withName(
          options.name,
          `${whenWord === "today" ? "Today" : "Tomorrow"} you have ${events.length} events. ${listed}.`,
        );
  return {
    spoken,
    receipt: {
      action: `Checked ${whenWord}'s calendar`,
      href,
      linkLabel: primary.htmlLink ? "Open event" : "Open calendar",
    },
  };
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
  name?: string | null,
): Promise<
  | { ok: true; spoken: string; receipt: AgentActionReceipt }
  | { ok: false; spoken: string; receipt: null }
> {
  const label = title.trim() || "that";
  if (!isGoogleCalendarConfigured()) {
    return { ok: false, spoken: "Google isn't set up on the server yet.", receipt: null };
  }
  const accessToken = await getValidAccessToken(uid);
  if (!accessToken) {
    return {
      ok: false,
      spoken: "Connect Google in Connectors to save tasks there.",
      receipt: null,
    };
  }

  const body: { title: string; due?: string; notes?: string } = {
    title: label.slice(0, 200),
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
      receipt: null,
    };
  }
  if (!res.ok) {
    console.error("[tasks] create failed", await res.text());
    return { ok: false, spoken: "I couldn't add that to Google Tasks.", receipt: null };
  }
  const created = (await res.json().catch(() => ({}))) as { id?: string };
  const href =
    typeof created.id === "string" && created.id
      ? `https://tasks.google.com/task/${encodeURIComponent(created.id)}`
      : "https://tasks.google.com/";
  const spoken = when
    ? withName(name ?? null, `I added ${label} to your tasks for ${when}.`)
    : withName(name ?? null, `I added ${label} to your tasks.`);
  return {
    ok: true,
    spoken,
    receipt: {
      action: `Added ${label} to tasks`,
      href,
      linkLabel: "Open task",
    },
  };
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
export async function readUnreadGmail(
  uid: string,
  options: { limit: number; name: string | null },
): Promise<GoogleToolResult> {
  const limit = Math.min(5, Math.max(1, options.limit || 3));
  if (!isGoogleCalendarConfigured()) {
    return { spoken: "Gmail isn't set up on the server yet.", receipt: null };
  }
  const accessToken = await getValidAccessToken(uid);
  if (!accessToken) {
    return {
      spoken: "Connect Google in Connectors first, then ask again.",
      receipt: null,
    };
  }

  const listUrl = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  listUrl.searchParams.set("q", "is:unread newer_than:14d");
  listUrl.searchParams.set("maxResults", String(limit));

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (listRes.status === 401) {
    return {
      spoken: "Google access expired. Connect it again in Connectors.",
      receipt: null,
    };
  }
  if (!listRes.ok) {
    console.error("[gmail] list failed", await listRes.text());
    return { spoken: "I couldn't read Gmail just now.", receipt: null };
  }

  const listData = (await listRes.json()) as {
    messages?: Array<{ id?: string }>;
    resultSizeEstimate?: number;
  };
  const ids = (listData.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id))
    .slice(0, limit);

  const inbox = "https://mail.google.com/mail/u/0/#inbox";
  if (ids.length === 0) {
    return {
      spoken: withName(options.name, "No unread mail in the last two weeks."),
      receipt: {
        action: "Checked unread email",
        href: inbox,
        linkLabel: "Open inbox",
      },
    };
  }

  const snippets: string[] = [];
  for (const id of ids) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!msgRes.ok) continue;
    const msg = (await msgRes.json()) as {
      payload?: { headers?: Array<{ name?: string; value?: string }> };
    };
    const from = headerValue(msg.payload?.headers, "From")
      .replace(/<.*>/, "")
      .trim();
    const subject = headerValue(msg.payload?.headers, "Subject") || "No subject";
    snippets.push(`${from || "someone"}: ${subject}`);
  }

  if (snippets.length === 0) {
    return {
      spoken: "You have unread mail, but I couldn't read the subjects.",
      receipt: null,
    };
  }

  const estimate = listData.resultSizeEstimate ?? ids.length;
  const head =
    estimate > snippets.length
      ? `You have about ${estimate} unread messages. The latest ${snippets.length}:`
      : `Your last ${snippets.length} unread:`;
  const latest = ids[0];
  return {
    spoken: withName(options.name, `${head} ${snippets.join(". ")}.`),
    receipt: {
      action: `Summarized your last ${snippets.length} unread emails`,
      href: latest ? `https://mail.google.com/mail/u/0/#inbox/${latest}` : inbox,
      linkLabel: "Open email",
    },
  };
}
