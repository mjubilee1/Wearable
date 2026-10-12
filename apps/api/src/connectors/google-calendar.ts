import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  AgentActionReceipt,
  AgentDraftChoicesPreview,
  AgentDraftPreview,
  AgentReschedulePreview,
} from "@nearby/shared";
import { getFirebaseAdmin, isFirebaseConfigured } from "../firebase.js";
import {
  addZonedCalendarDays,
  dayBoundsInZone,
  dayOffsetFromToken,
  formatClockAmPm,
  formatWhenInZone,
  getZonedParts,
  zonedTimeToUtc,
} from "../timezone.js";

/** One Google connect unlocks Calendar (read/write events), Tasks, and Gmail read + drafts. */
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
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

export function buildGoogleAuthUrl(uid: string, next?: "demo"): string {
  if (!isGoogleCalendarConfigured()) {
    throw new Error("Google Calendar is not configured on the API");
  }
  const body = Buffer.from(
    JSON.stringify({
      uid,
      exp: Date.now() + 10 * 60 * 1000,
      n: randomBytes(8).toString("hex"),
      ...(next ? { next } : {}),
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

function parseState(state: string): { uid: string; next?: "demo" } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = signState(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as { uid?: string; exp?: number; next?: string };
    if (typeof parsed.uid !== "string" || !parsed.uid) return null;
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return {
      uid: parsed.uid,
      next: parsed.next === "demo" ? "demo" : undefined,
    };
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
  if (input.error) {
    return `${appBaseUrl()}/connectors?calendar=error&reason=${encodeURIComponent(input.error)}`;
  }
  if (!input.code || !input.state) {
    return `${appBaseUrl()}/connectors?calendar=error&reason=missing_code`;
  }
  const parsed = parseState(input.state);
  if (!parsed) return `${appBaseUrl()}/connectors?calendar=error&reason=bad_state`;
  const landing =
    parsed.next === "demo" ? `${appBaseUrl()}/activity` : `${appBaseUrl()}/connectors`;
  const done = (query: string) => `${landing}?${query}`;
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

function dayWindow(
  when: "today" | "tomorrow",
  timeZone: string,
): { start: Date; end: Date } {
  return dayBoundsInZone(timeZone, when === "tomorrow" ? 1 : 0);
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

function formatEventTime(
  raw: string | undefined,
  allDay: boolean,
  timeZone: string,
): string {
  if (!raw) return "";
  if (allDay) return "all day";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export async function fetchPrimaryCalendarTimeZone(
  uid: string,
): Promise<string | null> {
  const accessToken = await getValidAccessToken(uid);
  if (!accessToken) return null;
  try {
    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { timeZone?: string };
    return typeof data.timeZone === "string" && data.timeZone
      ? data.timeZone
      : null;
  } catch {
    return null;
  }
}

function eventPhrase(event: CalendarEvent): string {
  if (!event.startLabel) return event.summary;
  if (event.startLabel === "all day") return `${event.summary}, all day`;
  return `${event.summary} at ${event.startLabel}`;
}

export async function readCalendar(
  uid: string,
  options: {
    when: "today" | "tomorrow";
    firstOnly: boolean;
    name: string | null;
    timeZone: string;
  },
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

  const { start, end } = dayWindow(options.when, options.timeZone);
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
        startLabel: formatEventTime(startRaw, allDay, options.timeZone),
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

type ClockParse =
  | { ok: true; hour: number; minute: number }
  | { ok: false; ask: string };

/**
 * Bare hours: 7–11 → AM, 1–6 → PM, 12 → noon.
 * Explicit am/pm always wins. Unclear bare hours ask AM or PM.
 */
export function parseClockHint(raw: string): ClockParse {
  const cleaned = raw.trim().toLowerCase().replace(/\./g, "");
  const m = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return { ok: false, ask: "Which time did you mean?" };
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3] as "am" | "pm" | undefined;
  if (!Number.isFinite(hour) || hour < 0 || hour > 23 || minute > 59) {
    return { ok: false, ask: "Which time did you mean?" };
  }
  if (meridiem === "pm" && hour < 12) hour += 12;
  else if (meridiem === "am" && hour === 12) hour = 0;
  else if (meridiem === "am" && hour < 12) {
    // keep hour
  } else if (!meridiem) {
    if (hour >= 13 && hour <= 23) {
      // already 24h
    } else if (hour >= 7 && hour <= 11) {
      // working-hours morning → AM
    } else if (hour >= 1 && hour <= 6) {
      hour += 12; // afternoon → PM
    } else if (hour === 12) {
      // noon
    } else {
      const bare = String(Number(m[1]));
      return { ok: false, ask: `${bare} AM or ${bare} PM?` };
    }
  }
  return { ok: true, hour, minute };
}

const DAY_TOKEN =
  "today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday";

const TITLE_STOP = new Set([
  "move",
  "reschedule",
  "shift",
  "push",
  "my",
  "the",
  "a",
  "an",
  "our",
  "your",
  "it",
  "that",
  "this",
  "please",
  "can",
  "you",
  "could",
  "would",
  "just",
  "to",
  "for",
  "at",
  "on",
  "from",
  "of",
  "event",
  "meeting",
  "appointment",
  "call",
  "today",
  "tomorrow",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "am",
  "pm",
]);

export type RescheduleParse =
  | {
      ok: true;
      /** Null when the user named a time or title but no day — search the next 7 days. */
      fromDayOffset: number | null;
      fromClock: { hour: number; minute: number } | null;
      titleWords: string[];
      toDayOffset: number;
      toClock: { hour: number; minute: number };
    }
  | { ok: false; ask: string };

export type TimedCalendarEvent = {
  id: string;
  title: string;
  htmlLink: string | null;
  startAt: Date;
  endAt: Date;
};

/** Parse "Move my 3 PM to tomorrow at 10" and "move the Robinson meeting". */
export function parseRescheduleRequest(
  text: string,
  timeZone: string,
  now: Date = new Date(),
): RescheduleParse | null {
  const lower = text.toLowerCase().replace(/[’']/g, "'");
  if (!/\b(move|reschedule|shift|push)\b/.test(lower)) return null;

  const destRe = new RegExp(
    `\\b(?:to|for)\\s+((?:${DAY_TOKEN})\\s+)?(?:at\\s+)?(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)\\b`,
    "g",
  );
  let dest: RegExpExecArray | null = null;
  for (let match = destRe.exec(lower); match; match = destRe.exec(lower)) {
    dest = match;
  }
  if (!dest?.[2] || dest.index === undefined) return null;

  const toClock = parseClockHint(dest[2]);
  if (!toClock.ok) return { ok: false, ask: toClock.ask };

  let toDayOffset = 1;
  if (dest[1]) {
    const resolved = dayOffsetFromToken(dest[1].trim(), timeZone, now);
    if (resolved === null) return null;
    toDayOffset = resolved;
  }

  const source = lower.slice(0, dest.index);
  const fromDayToken = source.match(new RegExp(`\\b(${DAY_TOKEN})\\b`))?.[1];
  let fromDayOffset: number | null = null;
  if (fromDayToken) {
    const resolved = dayOffsetFromToken(fromDayToken, timeZone, now);
    if (resolved === null) return null;
    fromDayOffset = resolved;
  }

  const clockRe = /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/g;
  let fromClockRaw: string | null = null;
  for (let match = clockRe.exec(source); match; match = clockRe.exec(source)) {
    fromClockRaw = match[1] ?? null;
  }
  let fromClock: { hour: number; minute: number } | null = null;
  if (fromClockRaw) {
    const parsed = parseClockHint(fromClockRaw);
    if (!parsed.ok) return { ok: false, ask: parsed.ask };
    fromClock = { hour: parsed.hour, minute: parsed.minute };
  }

  let titleSource = source;
  if (fromClockRaw) titleSource = titleSource.replace(fromClockRaw, " ");
  const titleWords = titleSource
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !TITLE_STOP.has(word));

  if (!fromClock && titleWords.length === 0) {
    return { ok: false, ask: "Which event should I move?" };
  }

  return {
    ok: true,
    fromDayOffset,
    fromClock,
    titleWords,
    toDayOffset,
    toClock: { hour: toClock.hour, minute: toClock.minute },
  };
}

export function rescheduleWindow(
  timeZone: string,
  fromDayOffset: number | null,
  now: Date,
): { start: Date; end: Date } {
  if (fromDayOffset !== null) return dayBoundsInZone(timeZone, fromDayOffset, now);
  const parts = getZonedParts(timeZone, now);
  const endDay = addZonedCalendarDays(
    timeZone,
    parts.year,
    parts.month,
    parts.day,
    7,
  );
  return {
    start: now,
    end: zonedTimeToUtc(
      timeZone,
      endDay.year,
      endDay.month,
      endDay.day,
      parts.hour,
      parts.minute,
    ),
  };
}

function clockMatches(
  startAt: Date,
  timeZone: string,
  clock: { hour: number; minute: number },
): boolean {
  const local = getZonedParts(timeZone, startAt);
  return local.hour === clock.hour && local.minute === clock.minute;
}

function titleMatches(title: string, words: string[]): boolean {
  if (words.length === 0) return true;
  const hay = title.toLowerCase();
  return words.every((word) => hay.includes(word));
}

function whenPhrase(fromDayOffset: number | null): string {
  if (fromDayOffset === null) return "in the next 7 days";
  if (fromDayOffset === 0) return "today";
  if (fromDayOffset === 1) return "tomorrow";
  return "that day";
}

export function resolveRescheduleChoice(
  events: TimedCalendarEvent[],
  parsed: Extract<RescheduleParse, { ok: true }>,
  timeZone: string,
  now: Date = new Date(),
):
  | {
      ok: true;
      event: TimedCalendarEvent;
      newStart: Date;
      newEnd: Date;
      oldWhen: string;
      newWhen: string;
    }
  | { ok: false; spoken: string } {
  const window = rescheduleWindow(timeZone, parsed.fromDayOffset, now);
  const matches = events
    .filter((event) => {
      if (event.startAt.getTime() < window.start.getTime()) return false;
      if (event.startAt.getTime() >= window.end.getTime()) return false;
      if (
        parsed.fromClock &&
        !clockMatches(event.startAt, timeZone, parsed.fromClock)
      ) {
        return false;
      }
      return titleMatches(event.title, parsed.titleWords);
    })
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const when = whenPhrase(parsed.fromDayOffset);
  if (matches.length === 0) {
    if (parsed.fromClock && parsed.titleWords.length > 0) {
      const clock = formatClockAmPm(parsed.fromClock.hour, parsed.fromClock.minute);
      return {
        ok: false,
        spoken: `I couldn't find a ${clock} ${parsed.titleWords.join(" ")} event ${when}. Which one?`,
      };
    }
    if (parsed.fromClock) {
      const clock = formatClockAmPm(parsed.fromClock.hour, parsed.fromClock.minute);
      return {
        ok: false,
        spoken: `I couldn't find a ${clock} event ${when}. Which one?`,
      };
    }
    return {
      ok: false,
      spoken: `I couldn't find ${parsed.titleWords.join(" ")} ${when}. Which one?`,
    };
  }

  const earliest = matches[0].startAt.getTime();
  const sameSlot = matches.filter(
    (event) => Math.abs(event.startAt.getTime() - earliest) < 60_000,
  );
  // A bare clock means the next upcoming event. Title words stay ambiguous
  // across the week, and two events in the same minute need a choice.
  const ambiguous =
    parsed.titleWords.length > 0 ? matches : sameSlot;
  if (ambiguous.length > 1) {
    const listed = ambiguous
      .slice(0, 5)
      .map((event) => `${event.title}, ${formatWhenInZone(event.startAt, timeZone)}`)
      .join("; ");
    const more =
      ambiguous.length > 5 ? `; and ${ambiguous.length - 5} more` : "";
    return {
      ok: false,
      spoken: `I found a few: ${listed}${more}. Which one?`,
    };
  }

  const hit = ambiguous[0];
  const durationMs = Math.max(
    15 * 60 * 1000,
    hit.endAt.getTime() - hit.startAt.getTime(),
  );
  const toDay = dayBoundsInZone(timeZone, parsed.toDayOffset, now);
  const toParts = getZonedParts(timeZone, toDay.start);
  const newStart = zonedTimeToUtc(
    timeZone,
    toParts.year,
    toParts.month,
    toParts.day,
    parsed.toClock.hour,
    parsed.toClock.minute,
  );
  const newEnd = new Date(newStart.getTime() + durationMs);
  return {
    ok: true,
    event: hit,
    newStart,
    newEnd,
    oldWhen: formatWhenInZone(hit.startAt, timeZone),
    newWhen: formatWhenInZone(newStart, timeZone),
  };
}

export async function previewReschedule(
  uid: string,
  parsed: Extract<RescheduleParse, { ok: true }>,
  name: string | null,
  timeZone: string,
): Promise<
  | {
      ok: true;
      spoken: string;
      preview: AgentReschedulePreview;
      payload: Record<string, string>;
    }
  | { ok: false; spoken: string }
> {
  if (!isGoogleCalendarConfigured()) {
    return { ok: false, spoken: "Calendar isn't set up on the server yet." };
  }
  const accessToken = await getValidAccessToken(uid);
  if (!accessToken) {
    return {
      ok: false,
      spoken: "Connect Google in Connectors first, then ask again.",
    };
  }

  const now = new Date();
  const { start, end } = rescheduleWindow(timeZone, parsed.fromDayOffset, now);
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", start.toISOString());
  url.searchParams.set("timeMax", end.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "100");
  url.searchParams.set("timeZone", timeZone);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    console.error("[calendar] reschedule list failed", await res.text());
    return { ok: false, spoken: "I couldn't read your calendar just now." };
  }

  const data = (await res.json()) as {
    items?: Array<{
      id?: string;
      summary?: string;
      status?: string;
      htmlLink?: string;
      start?: { dateTime?: string; date?: string; timeZone?: string };
      end?: { dateTime?: string; date?: string; timeZone?: string };
    }>;
  };

  const events: TimedCalendarEvent[] = (data.items ?? [])
    .filter((item) => item.status !== "cancelled" && item.id && item.start?.dateTime)
    .map((item) => {
      const startAt = new Date(item.start!.dateTime!);
      const endAt = item.end?.dateTime
        ? new Date(item.end.dateTime)
        : new Date(startAt.getTime() + 60 * 60 * 1000);
      return {
        id: item.id!,
        title: (item.summary || "Busy").trim(),
        htmlLink: httpsHref(item.htmlLink),
        startAt,
        endAt,
      };
    });

  const choice = resolveRescheduleChoice(events, parsed, timeZone, now);
  if (!choice.ok) {
    return { ok: false, spoken: withName(name, choice.spoken) };
  }

  const hit = choice.event;
  const preview: AgentReschedulePreview = {
    kind: "reschedule",
    eventId: hit.id,
    calendarId: "primary",
    title: hit.title,
    oldWhen: choice.oldWhen,
    newWhen: choice.newWhen,
    htmlLink: hit.htmlLink,
  };

  return {
    ok: true,
    spoken: withName(
      name,
      `Move '${hit.title}' from ${choice.oldWhen} to ${choice.newWhen}?`,
    ),
    preview,
    payload: {
      eventId: hit.id,
      calendarId: "primary",
      title: hit.title,
      oldWhen: choice.oldWhen,
      newWhen: choice.newWhen,
      newStartIso: choice.newStart.toISOString(),
      newEndIso: choice.newEnd.toISOString(),
    },
  };
}

export async function applyReschedule(
  uid: string,
  input: {
    eventId: string;
    calendarId: string;
    newStartIso: string;
    newEndIso: string;
    title: string;
    oldWhen: string;
    newWhen: string;
  },
  name: string | null,
): Promise<GoogleToolResult> {
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

  const cal = encodeURIComponent(input.calendarId || "primary");
  const getRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${encodeURIComponent(input.eventId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!getRes.ok) {
    console.error("[calendar] get event failed", await getRes.text());
    return {
      spoken: withName(name, "I couldn't find that event anymore."),
      receipt: null,
    };
  }
  const existing = (await getRes.json()) as {
    start?: { timeZone?: string };
    end?: { timeZone?: string };
    htmlLink?: string;
    summary?: string;
  };

  const patchRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${encodeURIComponent(input.eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        start: {
          dateTime: input.newStartIso,
          timeZone: existing.start?.timeZone,
        },
        end: {
          dateTime: input.newEndIso,
          timeZone: existing.end?.timeZone ?? existing.start?.timeZone,
        },
      }),
    },
  );
  if (!patchRes.ok) {
    console.error("[calendar] patch failed", await patchRes.text());
    return {
      spoken: withName(name, "I couldn't update that event."),
      receipt: null,
    };
  }
  const updated = (await patchRes.json().catch(() => ({}))) as {
    htmlLink?: string;
    summary?: string;
  };
  const title = (updated.summary || input.title || "Event").trim();
  const href = httpsHref(updated.htmlLink) ?? httpsHref(existing.htmlLink);
  return {
    spoken: withName(
      name,
      `Moved ${title} from ${input.oldWhen} to ${input.newWhen}.`,
    ),
    receipt: {
      action: `Moved ${title} to ${input.newWhen}`,
      href,
      linkLabel: "Open event",
    },
  };
}

export type DraftParse = {
  query: string;
  intent: string;
};

/** Parse "Draft a reply to the lender saying I'll send docs Friday". */
export function parseDraftRequest(text: string): DraftParse | null {
  const lower = text.toLowerCase();
  if (!/\b(draft|compose)\b/.test(lower) || !/\b(reply|email|e-mail|message)\b/.test(lower)) {
    return null;
  }
  const toMatch =
    text.match(
      /\b(?:to|for)\s+(?:the\s+)?(.+?)(?:\s+saying|\s+about|\s+that\b|,|\.|$)/i,
    ) ?? text.match(/\breply\s+to\s+(?:the\s+)?(.+?)(?:\s+saying|\s+about|,|\.|$)/i);
  const sayingMatch = text.match(
    /\b(?:saying|that|about)\s+(.+)$/i,
  );
  const query = (toMatch?.[1] ?? "").replace(/\s+/g, " ").trim();
  const intent = (sayingMatch?.[1] ?? "").replace(/\s+/g, " ").trim();
  if (!query || query.length < 2) return null;
  return {
    query: query.slice(0, 80),
    intent: intent.slice(0, 280) || "Thanks — I'll follow up soon.",
  };
}

function extractEmail(fromHeader: string): string {
  const angle = fromHeader.match(/<([^>]+)>/);
  if (angle?.[1]) return angle[1].trim();
  if (fromHeader.includes("@")) return fromHeader.trim();
  return fromHeader.trim();
}

function displayNameFrom(fromHeader: string): string {
  const withoutAngle = fromHeader.replace(/<[^>]+>/, "").trim();
  return withoutAngle.replace(/^"|"$/g, "").trim() || extractEmail(fromHeader);
}

function isNoReplyAddress(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return /^(no[\-_]?reply|noreply|donotreply|do[\-_]?not[\-_]?reply|mailer[\-_]?daemon|notifications?)$/i.test(
    local,
  );
}

function buildReplyBody(intent: string, name: string | null): string {
  const line = intent.replace(/^["']|["']$/g, "").trim();
  const closing = name ? `\n\nThanks,\n${name}` : "\n\nThanks";
  if (/^[A-Z]/.test(line)) return `${line}${closing}`;
  return `Hi,\n\n${line.charAt(0).toUpperCase()}${line.slice(1)}${closing}`;
}

type DraftCandidate = {
  messageId: string;
  threadId: string;
  to: string;
  fromLabel: string;
  subject: string;
  score: number;
};

async function fetchMessageMeta(
  accessToken: string,
  id: string,
): Promise<{
  id: string;
  threadId: string;
  from: string;
  subject: string;
  listUnsubscribe: string;
  labelIds: string[];
} | null> {
  const msgRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe&metadataHeaders=Message-ID`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!msgRes.ok) return null;
  const msg = (await msgRes.json()) as {
    id?: string;
    threadId?: string;
    labelIds?: string[];
    payload?: { headers?: Array<{ name?: string; value?: string }> };
  };
  if (!msg.id) return null;
  const headers = msg.payload?.headers;
  return {
    id: msg.id,
    threadId: msg.threadId || "",
    from: headerValue(headers, "From"),
    subject: headerValue(headers, "Subject") || "No subject",
    listUnsubscribe: headerValue(headers, "List-Unsubscribe"),
    labelIds: msg.labelIds ?? [],
  };
}

function scoreDraftCandidate(
  query: string,
  from: string,
  toHeader: string,
  subject: string,
): number {
  const q = query.toLowerCase();
  const fromLower = from.toLowerCase();
  const email = extractEmail(from).toLowerCase();
  const name = displayNameFrom(from).toLowerCase();
  const subjectLower = subject.toLowerCase();
  const toLower = toHeader.toLowerCase();
  let score = 0;
  if (name.includes(q) || q.includes(name)) score += 8;
  if (email.includes(q)) score += 8;
  if (fromLower.includes(q)) score += 5;
  if (toLower.includes(q)) score += 6;
  if (subjectLower.includes(q)) score += 2;
  return score;
}

function isSkippableMail(meta: {
  from: string;
  listUnsubscribe: string;
  labelIds: string[];
}): boolean {
  const email = extractEmail(meta.from);
  if (!email.includes("@") || isNoReplyAddress(email)) return true;
  if (meta.listUnsubscribe.trim()) return true;
  const labels = new Set(meta.labelIds.map((l) => l.toUpperCase()));
  if (labels.has("CATEGORY_PROMOTIONS") || labels.has("CATEGORY_SOCIAL")) {
    return true;
  }
  return false;
}

async function searchMessageIds(
  accessToken: string,
  query: string,
): Promise<Array<{ id: string; threadId: string }>> {
  const listUrl = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  listUrl.searchParams.set("q", query);
  listUrl.searchParams.set("maxResults", "12");
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    console.error("[gmail] draft search failed", await listRes.text());
    return [];
  }
  const listData = (await listRes.json()) as {
    messages?: Array<{ id?: string; threadId?: string }>;
  };
  return (listData.messages ?? [])
    .filter((m): m is { id: string; threadId: string } => Boolean(m.id))
    .map((m) => ({ id: m.id, threadId: m.threadId || "" }));
}

async function collectDraftCandidates(
  accessToken: string,
  parsed: DraftParse,
): Promise<DraftCandidate[]> {
  const safeQuery = parsed.query.replace(/"/g, "").slice(0, 80);
  const baseExclude =
    `-in:drafts -in:chats -category:promotions -category:social newer_than:90d`;
  const inboxHits = await searchMessageIds(
    accessToken,
    `${safeQuery} ${baseExclude}`,
  );
  const sentHits = await searchMessageIds(
    accessToken,
    `${safeQuery} in:sent ${baseExclude}`,
  );

  const seen = new Set<string>();
  const candidates: DraftCandidate[] = [];

  for (const hit of [...inboxHits, ...sentHits]) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    const meta = await fetchMessageMeta(accessToken, hit.id);
    if (!meta || isSkippableMail(meta)) continue;

    // For sent mail, the person is in To.
    const detailed = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${hit.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    let toField = "";
    if (detailed.ok) {
      const body = (await detailed.json()) as {
        payload?: { headers?: Array<{ name?: string; value?: string }> };
        labelIds?: string[];
      };
      toField = headerValue(body.payload?.headers, "To");
      if (isSkippableMail({
        from: meta.from,
        listUnsubscribe: headerValue(body.payload?.headers, "List-Unsubscribe"),
        labelIds: body.labelIds ?? meta.labelIds,
      })) {
        continue;
      }
    }

    const replyTo = extractEmail(meta.from);
    const sentTo = extractEmail(toField);
    const labels = new Set(meta.labelIds.map((l) => l.toUpperCase()));
    const isSent = labels.has("SENT");
    const personEmail = isSent && sentTo.includes("@") ? sentTo : replyTo;
    if (!personEmail.includes("@") || isNoReplyAddress(personEmail)) continue;

    const score = scoreDraftCandidate(
      parsed.query,
      isSent ? toField || meta.from : meta.from,
      toField,
      meta.subject,
    );
    if (score < 2) continue;

    const fromLabel = isSent
      ? displayNameFrom(toField || meta.from)
      : displayNameFrom(meta.from);
    candidates.push({
      messageId: meta.id,
      threadId: meta.threadId || hit.threadId,
      to: personEmail,
      fromLabel,
      subject: meta.subject,
      score,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  // Dedupe by email+subject
  const deduped: DraftCandidate[] = [];
  const keys = new Set<string>();
  for (const c of candidates) {
    const key = `${c.to.toLowerCase()}|${c.subject.toLowerCase()}`;
    if (keys.has(key)) continue;
    keys.add(key);
    deduped.push(c);
  }
  return deduped;
}

function draftPreviewFromCandidate(
  candidate: DraftCandidate,
  intent: string,
  name: string | null,
): AgentDraftPreview {
  const subject = /^re:/i.test(candidate.subject)
    ? candidate.subject
    : `Re: ${candidate.subject}`;
  return {
    kind: "draft_email",
    threadId: candidate.threadId,
    messageId: candidate.messageId,
    to: candidate.to,
    subject,
    body: buildReplyBody(intent, name),
  };
}

export async function previewDraftReply(
  uid: string,
  parsed: DraftParse,
  name: string | null,
): Promise<
  | { ok: true; spoken: string; preview: AgentDraftPreview }
  | {
      ok: true;
      spoken: string;
      preview: AgentDraftChoicesPreview;
    }
  | { ok: false; spoken: string }
> {
  if (!isGoogleCalendarConfigured()) {
    return { ok: false, spoken: "Gmail isn't set up on the server yet." };
  }
  const accessToken = await getValidAccessToken(uid);
  if (!accessToken) {
    return {
      ok: false,
      spoken: "Connect Google in Connectors first, then ask again.",
    };
  }

  const candidates = await collectDraftCandidates(accessToken, parsed);
  if (candidates.length === 0) {
    return {
      ok: false,
      spoken: withName(
        name,
        `I couldn't find an email from your ${parsed.query}. Who is it?`,
      ),
    };
  }

  if (candidates.length > 1) {
    const top = candidates.slice(0, 3);
    const lines = top
      .map((c, i) => `${i + 1}. ${c.fromLabel} — ${c.subject}`)
      .join(" ");
    const preview: AgentDraftChoicesPreview = {
      kind: "draft_choices",
      query: parsed.query,
      intent: parsed.intent,
      choices: top.map((c) => ({
        messageId: c.messageId,
        threadId: c.threadId,
        to: c.to,
        label: `${c.fromLabel} — ${c.subject}`,
      })),
    };
    return {
      ok: true,
      spoken: withName(
        name,
        `I found a few matches for ${parsed.query}. Which one? ${lines}`,
      ),
      preview,
    };
  }

  const hit = candidates[0];
  if (isNoReplyAddress(hit.to)) {
    return {
      ok: false,
      spoken: withName(
        name,
        `I couldn't find an email from your ${parsed.query}. Who is it?`,
      ),
    };
  }
  const preview = draftPreviewFromCandidate(hit, parsed.intent, name);
  return {
    ok: true,
    spoken: withName(
      name,
      `Here's a draft reply to ${preview.to} about ${hit.subject}. Edit it, save to Gmail Drafts, or cancel.`,
    ),
    preview,
  };
}

export async function previewDraftFromPick(
  uid: string,
  pick: {
    messageId: string;
    threadId: string;
    intent: string;
    query: string;
  },
  name: string | null,
): Promise<
  | { ok: true; spoken: string; preview: AgentDraftPreview }
  | { ok: false; spoken: string }
> {
  const accessToken = await getValidAccessToken(uid);
  if (!accessToken) {
    return {
      ok: false,
      spoken: "Connect Google in Connectors first, then ask again.",
    };
  }
  const meta = await fetchMessageMeta(accessToken, pick.messageId);
  if (!meta || isSkippableMail(meta)) {
    return {
      ok: false,
      spoken: withName(
        name,
        `I couldn't find an email from your ${pick.query}. Who is it?`,
      ),
    };
  }
  const to = extractEmail(meta.from);
  if (!to.includes("@") || isNoReplyAddress(to)) {
    return {
      ok: false,
      spoken: withName(name, "That address looks like a no-reply. Pick another."),
    };
  }
  const candidate: DraftCandidate = {
    messageId: meta.id,
    threadId: meta.threadId || pick.threadId,
    to,
    fromLabel: displayNameFrom(meta.from),
    subject: meta.subject,
    score: 10,
  };
  const preview = draftPreviewFromCandidate(candidate, pick.intent, name);
  return {
    ok: true,
    spoken: withName(
      name,
      `Here's a draft reply to ${preview.to} about ${meta.subject}. Edit it, save to Gmail Drafts, or cancel.`,
    ),
    preview,
  };
}

function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function saveGmailDraft(
  uid: string,
  input: {
    to: string;
    subject: string;
    body: string;
    threadId?: string;
    inReplyToMessageId?: string;
  },
  name: string | null,
): Promise<GoogleToolResult> {
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

  const lines = [
    `To: ${input.to.trim()}`,
    `Subject: ${input.subject.trim()}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body.trim(),
  ];
  const raw = toBase64Url(lines.join("\r\n"));
  const draftBody: {
    message: { raw: string; threadId?: string };
  } = {
    message: { raw },
  };
  if (input.threadId) draftBody.message.threadId = input.threadId;

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(draftBody),
    },
  );
  if (!res.ok) {
    console.error("[gmail] create draft failed", await res.text());
    return {
      spoken: withName(name, "I couldn't save that draft."),
      receipt: null,
    };
  }
  const created = (await res.json().catch(() => ({}))) as {
    id?: string;
    message?: { id?: string; threadId?: string };
  };
  const draftId = created.id;
  const href = draftId
    ? `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(draftId)}`
    : "https://mail.google.com/mail/u/0/#drafts";
  return {
    spoken: withName(name, `Saved a draft to ${input.to}. Nothing was sent.`),
    receipt: {
      action: `Saved draft to ${input.to}`,
      href,
      linkLabel: "Open draft",
    },
  };
}
