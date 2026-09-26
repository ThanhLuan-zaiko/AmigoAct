/**
 * Realtime event → query-invalidation mapping.
 *
 * The WebSocket channel pushes typed envelopes (`{type, data}`); each type
 * maps to the TanStack Query keys that must be invalidated so live screens
 * refresh. The map is pure so it is unit-tested without sockets; the
 * `RealtimeProvider` component wires it to `queryClient.invalidateQueries`.
 *
 * Event type strings are a frozen contract with the backend — pinned by
 * `tests/regression/api-contract.test.ts`.
 *
 * Framework-free: no `next/*` or React imports.
 */
import { type QueryKey, qk } from "@/lib/query-keys";
import type { SocketEnvelope } from "@/lib/websocket";

/** Event types the server may push, per the frozen realtime contract. */
export const REALTIME_EVENT_TYPES = [
  "activity.changed",
  "registration.changed",
  "checkin.recorded",
  "record.changed",
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

/** Extract a non-empty string field from an envelope payload. */
function field(data: Record<string, unknown>, name: string): string | null {
  const value = data[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Compute the query keys to invalidate for one pushed envelope.
 *
 * Unknown types, missing payloads and missing ids produce only the keys that
 * can be derived — never throw on a malformed push.
 */
export function realtimeInvalidations(
  envelope: SocketEnvelope,
): readonly QueryKey[] {
  const data =
    typeof envelope.data === "object" && envelope.data !== null
      ? (envelope.data as Record<string, unknown>)
      : {};
  const orgId = field(data, "org_id");
  const activityId = field(data, "activity_id");

  switch (envelope.type) {
    case "activity.changed": {
      const keys: QueryKey[] = [qk.feed];
      if (orgId) {
        // Prefixes: every status-filtered activity variant and every report.
        keys.push(qk.orgActivities(orgId), qk.reports(orgId));
      }
      if (activityId) {
        keys.push(qk.activity(activityId));
      }
      return keys;
    }
    case "registration.changed": {
      const keys: QueryKey[] = [qk.meRegistrations, qk.feed];
      if (activityId) {
        keys.push(qk.activityRegs(activityId), qk.activity(activityId));
      }
      if (orgId) {
        // Registration counts feed the org reports.
        keys.push(qk.reports(orgId));
      }
      return keys;
    }
    case "checkin.recorded": {
      const keys: QueryKey[] = [];
      if (activityId) {
        keys.push(qk.activityRegs(activityId), qk.activity(activityId));
      }
      if (orgId) {
        // Check-in totals change the org's reports and the member's row.
        keys.push(qk.reports(orgId), qk.orgMembers(orgId));
      }
      return keys;
    }
    case "record.changed": {
      const keys: QueryKey[] = [qk.meRecords];
      if (orgId) {
        // Prefixes: every member's records, the roster totals (a MemberRow's
        // total_hours/total_points) and every report variant in the org.
        keys.push(qk.memberRecords(orgId), qk.orgMembers(orgId));
        keys.push(qk.reports(orgId));
      }
      return keys;
    }
    default:
      return [];
  }
}
