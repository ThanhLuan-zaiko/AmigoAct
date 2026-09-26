/**
 * Unit tests for `lib/query-keys.ts` ↔ `lib/realtime-events.ts` alignment —
 * every key a WS event invalidates must be a key `qk` can produce, or the
 * invalidation silently hits nothing.
 *
 * Layer: **unit**
 */
import { describe, expect, it } from "vitest";

import { qk } from "@/lib/query-keys";
import {
  REALTIME_EVENT_TYPES,
  realtimeInvalidations,
} from "@/lib/realtime-events";

/** Every key shape qk produces, with sample ids/params. */
const ALL_KEYS: readonly (readonly unknown[])[] = [
  qk.me,
  qk.orgs("o1"),
  qk.orgActivities("o1"),
  qk.orgActivities("o1", "published"),
  qk.activity("a1"),
  qk.activityRegs("a1"),
  qk.activityRegs("a1", "pending"),
  qk.activityCheckins("a1"),
  qk.meRegistrations,
  qk.meRecords,
  qk.orgMembers("o1"),
  qk.memberRecords("o1"),
  qk.memberRecords("o1", "m1"),
  qk.reports("o1"),
  qk.reports("o1", "overview"),
  qk.reports("o1", "overview", { from: "2026-01-01", to: "2026-06-30" }),
  qk.feed,
];

/** TanStack Query prefix match: `key` is covered when it is a prefix of
 * or equal to a produced key… or vice versa — invalidation targets are
 * prefixes, so `qk` must produce a key that has the target as its head. */
function isCovered(target: readonly unknown[]): boolean {
  return ALL_KEYS.some(
    (key) =>
      key.length >= target.length && target.every((part, i) => key[i] === part),
  );
}

describe("query key registry", () => {
  it("keeps id-scoped key shapes", () => {
    expect(qk.orgs("o1")).toEqual(["orgs", "o1"]);
    expect(qk.orgActivities("o1")).toEqual(["org-activities", "o1"]);
    expect(qk.orgActivities("o1", "draft")).toEqual([
      "org-activities",
      "o1",
      "draft",
    ]);
    expect(qk.activity("a1")).toEqual(["activity", "a1"]);
    expect(qk.activityRegs("a1")).toEqual(["activity-regs", "a1"]);
    expect(qk.activityRegs("a1", "approved")).toEqual([
      "activity-regs",
      "a1",
      "approved",
    ]);
    expect(qk.feed).toEqual(["feed"]);
    expect(qk.meRegistrations).toEqual(["me-registrations"]);
    expect(qk.meRecords).toEqual(["me-records"]);
    expect(qk.orgMembers("o1")).toEqual(["org-members", "o1"]);
    expect(qk.memberRecords("o1")).toEqual(["member-records", "o1"]);
    expect(qk.memberRecords("o1", "m1")).toEqual([
      "member-records",
      "o1",
      "m1",
    ]);
    expect(qk.reports("o1")).toEqual(["reports", "o1"]);
    expect(qk.reports("o1", "overview")).toEqual(["reports", "o1", "overview"]);
    expect(qk.reports("o1", "overview", { from: "2026-01-01" })).toEqual([
      "reports",
      "o1",
      "overview",
      { from: "2026-01-01" },
    ]);
  });

  it.each(
    REALTIME_EVENT_TYPES,
  )("every key invalidated by %s exists in the registry", (type) => {
    const keys = realtimeInvalidations({
      type,
      data: {
        org_id: "o1",
        activity_id: "a1",
        registration_id: "r1",
        record_id: "rec1",
        member_user_id: "u1",
      },
    });
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(isCovered(key), `unregistered key ${JSON.stringify(key)}`).toBe(
        true,
      );
    }
  });
});
