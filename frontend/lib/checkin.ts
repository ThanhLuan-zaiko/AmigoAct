/**
 * Check-in code helpers — the client half of the QR/manual check-in flow.
 *
 * A check-in code is a short human-typable token
 * ({@link CHECKIN_CODE_LENGTH} chars drawn from {@link CHECKIN_CODE_ALPHABET},
 * an alphabet with lookalikes removed: no I/L/O/0/1). The alphabet and length
 * are a frozen contract shared with the backend — pinned by
 * `tests/regression/api-contract.test.ts`.
 *
 * Framework-free: no `next/*` or React imports.
 */

export const CHECKIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CHECKIN_CODE_LENGTH = 6;

/**
 * Minutes before `starts_at` that the check-in window opens (it stays open
 * until `ends_at`). Frozen contract — the server enforces the same window;
 * this constant exists for display only ("Điểm danh từ {time}").
 */
export const CHECKIN_EARLY_MINUTES = 60;

/**
 * The instant the check-in window opens for an activity, as an ISO string.
 * Throws on an unparseable `starts_at` — a silent wrong time is worse.
 */
export function checkinOpensAt(startsAt: string): string {
  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) {
    throw new Error(`invalid ISO datetime: ${startsAt}`);
  }
  return new Date(start - CHECKIN_EARLY_MINUTES * 60_000).toISOString();
}

/** Result of parsing a scanned/typed check-in payload. */
export interface CheckinPayload {
  /** Activity id when the payload carried one (QR URL), else `null`. */
  activityId: string | null;
  /** Normalized check-in code (uppercase, alphabet-validated). */
  code: string;
}

/**
 * Normalize a typed/scanned code: trim, drop inner whitespace, uppercase,
 * then validate length and alphabet. Returns `null` for anything invalid.
 */
export function normalizeCheckinCode(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (cleaned.length !== CHECKIN_CODE_LENGTH) {
    return null;
  }
  for (const char of cleaned) {
    if (!CHECKIN_CODE_ALPHABET.includes(char)) {
      return null;
    }
  }
  return cleaned;
}

/** Build the in-app check-in URL embedded into QR codes: `/checkin?a=&c=`. */
export function buildCheckinUrl(activityId: string, code: string): string {
  return `/checkin?a=${encodeURIComponent(activityId)}&c=${encodeURIComponent(code)}`;
}

/**
 * Parse whatever a QR scan or manual paste produced:
 *
 *   - a URL or query payload carrying `a=`/`c=` params → `{activityId, code}`
 *   - a bare code → `{activityId: null, code}`
 *   - anything else → `null`
 *
 * A payload that looks like params (`a=`/`c=` present but malformed) is
 * rejected outright rather than silently reinterpreted as a raw code.
 */
export function parseCheckinPayload(raw: string): CheckinPayload | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }

  // For URLs, only the query part is interesting.
  const queryStart = text.indexOf("?");
  const candidate = queryStart >= 0 ? text.slice(queryStart + 1) : text;

  if (candidate.includes("=")) {
    const params = new URLSearchParams(candidate);
    const activityId = params.get("a");
    const rawCode = params.get("c");
    const code = rawCode === null ? null : normalizeCheckinCode(rawCode);
    if (activityId && code) {
      return { activityId, code };
    }
    return null;
  }

  const code = normalizeCheckinCode(candidate);
  return code === null ? null : { activityId: null, code };
}
