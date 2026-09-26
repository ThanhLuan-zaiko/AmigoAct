/**
 * Display formatting helpers — numbers and datetimes in Vietnamese style.
 *
 * Datetimes arrive as ISO 8601 UTC strings from the API and are rendered in
 * the viewer's locale (`vi-VN`). Every formatter takes an optional `timeZone`
 * so tests can assert fixed offsets instead of host-TZ-dependent strings.
 *
 * Framework-free: no `next/*` or React imports.
 */

/** Format volunteer hours vi-VN style: `8` stays "8", `8.5` → "8,5". */
export function formatHours(hours: number): string {
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 2,
  }).format(hours);
}

/** Format an ISO datetime as a vi-VN date, e.g. `15/06/2026`. */
export function formatDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).format(mustParse(iso));
}

/** Format an ISO datetime as vi-VN date + time, e.g. `07:30, 15/06/2026`. */
export function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(mustParse(iso));
}

/**
 * Convert an ISO 8601 string to `YYYY-MM-DDTHH:mm` — the shape
 * `<input type="datetime-local">` expects — in the given zone (default:
 * the viewer's local zone). Returns `null` for unparseable input.
 */
export function isoToDatetimeLocal(
  iso: string,
  timeZone?: string,
): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = wallClockParts(date.getTime(), timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` +
    `T${pad(parts.hour)}:${pad(parts.minute)}`
  );
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Render a `YYYY-MM-DD` contract date (`awarded_on`, report params) as
 * `DD/MM/YYYY`. Pure string work — parsing it as a `Date` would shift the
 * day for viewers west of UTC. Throws on malformed input, like `mustParse`.
 */
export function formatDay(day: string): string {
  const match = DATE_ONLY_RE.exec(day.trim());
  if (match === null) {
    throw new Error(`invalid date: ${day}`);
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Format a 0–1 ratio as a vi-VN percentage, e.g. `0.753` → "75,3%". */
export function formatPercent(ratio: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(ratio);
}

/**
 * Today's date as `YYYY-MM-DD` in the viewer's local zone — the shape
 * `<input type="date">` expects for defaults.
 */
export function todayDateInput(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const DATETIME_LOCAL_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * Convert a `<input type="datetime-local">` value (`YYYY-MM-DDTHH:mm`) to an
 * ISO 8601 UTC string, interpreting the wall-clock time in `timeZone`
 * (default: the viewer's local zone). Returns `null` for malformed input or
 * impossible dates.
 */
export function datetimeLocalToIso(
  value: string,
  timeZone?: string,
): string | null {
  const match = DATETIME_LOCAL_RE.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  const fields = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: second === undefined ? 0 : Number(second),
  };
  if (!isValidCivil(fields)) {
    return null;
  }
  if (timeZone === undefined) {
    // No explicit zone: the platform's local zone interprets the wall time.
    const date = new Date(
      fields.year,
      fields.month - 1,
      fields.day,
      fields.hour,
      fields.minute,
      fields.second,
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  // Find the instant whose zone wall-time equals the input: start from the
  // wall time read as UTC, then correct by the zone offset (once or twice —
  // converges except inside a DST transition's impossible hour).
  const target = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  );
  let instant = target;
  for (let i = 0; i < 3; i += 1) {
    instant = target - zoneOffsetMs(instant, timeZone);
  }
  return new Date(instant).toISOString();
}

interface CivilFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Range-check civil fields, including leap-aware day-of-month. */
function isValidCivil(fields: CivilFields): boolean {
  if (
    fields.month < 1 ||
    fields.month > 12 ||
    fields.hour > 23 ||
    fields.minute > 59 ||
    fields.second > 59
  ) {
    return false;
  }
  const daysInMonth = new Date(
    Date.UTC(fields.year, fields.month, 0),
  ).getUTCDate();
  return fields.day >= 1 && fields.day <= daysInMonth;
}

/** Wall-clock parts of `instant` rendered in `timeZone` (or local). */
function wallClockParts(
  instant: number,
  timeZone?: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

/** Offset in ms such that `instant + offset` read as UTC is the zone's wall. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const truncated = Math.floor(instant / 1000) * 1000;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(truncated));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const wallAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return wallAsUtc - truncated;
}

/** Parse an ISO string or throw — a silent Invalid Date must not render. */
function mustParse(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid ISO datetime: ${iso}`);
  }
  return date;
}
