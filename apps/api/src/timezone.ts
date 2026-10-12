/** Resolve calendar "today" / wall times in a named IANA timezone (never server local / UTC day). */

export function isValidTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
};

export function getZonedParts(timeZone: string, date = new Date()): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

/** Convert a wall-clock time in `timeZone` to a UTC Date. */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i += 1) {
    const parts = getZonedParts(timeZone, new Date(utc));
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
    );
    const want = Date.UTC(year, month - 1, day, hour, minute, 0);
    utc += want - asUtc;
  }
  return new Date(utc);
}

export function addZonedCalendarDays(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  const noon = zonedTimeToUtc(timeZone, year, month, day, 12, 0);
  const shifted = new Date(noon.getTime() + delta * 86_400_000);
  const parts = getZonedParts(timeZone, shifted);
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function dayBoundsInZone(
  timeZone: string,
  offsetDays: number,
  now = new Date(),
): { start: Date; end: Date } {
  const today = getZonedParts(timeZone, now);
  const target = addZonedCalendarDays(
    timeZone,
    today.year,
    today.month,
    today.day,
    offsetDays,
  );
  const start = zonedTimeToUtc(
    timeZone,
    target.year,
    target.month,
    target.day,
    0,
    0,
  );
  const next = addZonedCalendarDays(
    timeZone,
    target.year,
    target.month,
    target.day,
    1,
  );
  const end = zonedTimeToUtc(timeZone, next.year, next.month, next.day, 0, 0);
  return { start, end };
}

export function zonedDayKey(timeZone: string, now = new Date()): string {
  const parts = getZonedParts(timeZone, now);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

/** Offset from today in `timeZone` for today/tomorrow/weekday names. */
export function dayOffsetFromToken(
  token: string,
  timeZone: string,
  now = new Date(),
): number | null {
  const lower = token.trim().toLowerCase();
  if (lower === "today") return 0;
  if (lower === "tomorrow") return 1;
  const want = WEEKDAY_INDEX[lower];
  if (want === undefined) return null;
  const parts = getZonedParts(timeZone, now);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const todayIdx = map[parts.weekday] ?? 0;
  let delta = (want - todayIdx + 7) % 7;
  if (delta === 0) delta = 7; // "Monday" later this week, not today
  return delta;
}

export function formatWhenInZone(date: Date, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  const monthDay = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${weekday}, ${monthDay} at ${time}`;
}

export function formatClockAmPm(hour24: number, minute: number): string {
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = ((hour24 + 11) % 12) + 1;
  const min = minute ? `:${String(minute).padStart(2, "0")}` : ":00";
  return `${hour12}${min} ${meridiem}`;
}
