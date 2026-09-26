/**
 * Unit tests for `lib/realtime-events.ts` — the envelope → invalidation map.
 * Pure: keys in, keys out. Prefix keys rely on TanStack Query's prefix
 * matching to cover every status/param variant.
 *
 * Layer: **unit**
 */
import { describe, expect, it } from "vitest";

import {
  REALTIME_EVENT_TYPES,
  realtimeInvalidations,
} from "@/lib/realtime-events";

describe("realtimeInvalidations", () => {
  it("activity.changed invalidates the org list, reports, the activity, and the feed", () => {
    const keys = realtimeInvalidations({
      type: "activity.changed",
      data: { org_id: "o1", activity_id: "a1", activity_status: "published" },
    });
    expect(keys).toContainEqual(["feed"]);
    expect(keys).toContainEqual(["org-activities", "o1"]);
    expect(keys).toContainEqual(["activity", "a1"]);
    expect(keys).toContainEqual(["reports", "o1"]);
  });

  it("activity.changed degrades gracefully without ids", () => {
    expect(realtimeInvalidations({ type: "activity.changed" })).toEqual([
      ["feed"],
    ]);
  });

  it("registration.changed covers regs (all variants), activity, mine, feed, reports", () => {
    const keys = realtimeInvalidations({
      type: "registration.changed",
      data: {
        org_id: "o1",
        activity_id: "a2",
        registration_id: "r1",
        member_id: "m1",
        status: "approved",
      },
    });
    expect(keys).toContainEqual(["activity-regs", "a2"]);
    expect(keys).toContainEqual(["activity", "a2"]);
    expect(keys).toContainEqual(["me-registrations"]);
    expect(keys).toContainEqual(["feed"]);
    expect(keys).toContainEqual(["reports", "o1"]);
  });

  it("checkin.recorded invalidates regs, detail, reports and the roster", () => {
    expect(
      realtimeInvalidations({
        type: "checkin.recorded",
        data: {
          org_id: "o1",
          activity_id: "a3",
          registration_id: "r1",
          member_user_id: "u1",
          member_full_name: "Nguyễn Lan",
          checked_in_at: "2026-06-15T08:10:00Z",
          checked_in_count: 7,
        },
      }),
    ).toEqual([
      ["activity-regs", "a3"],
      ["activity", "a3"],
      ["reports", "o1"],
      ["org-members", "o1"],
    ]);
  });

  it("checkin.recorded without an activity id still hits org-scoped keys", () => {
    expect(
      realtimeInvalidations({ type: "checkin.recorded", data: {} }),
    ).toEqual([]);
    expect(
      realtimeInvalidations({
        type: "checkin.recorded",
        data: { org_id: "o1" },
      }),
    ).toEqual([
      ["reports", "o1"],
      ["org-members", "o1"],
    ]);
  });

  it("record.changed invalidates my records plus the org's member/report prefixes", () => {
    const keys = realtimeInvalidations({
      type: "record.changed",
      data: {
        org_id: "o9",
        activity_id: "a1",
        record_id: "rec1",
        member_id: "m5",
        title: "Hiến máu",
        hours: 4,
        points: 2,
        awarded_on: "2026-06-16",
      },
    });
    expect(keys).toContainEqual(["me-records"]);
    expect(keys).toContainEqual(["member-records", "o9"]);
    expect(keys).toContainEqual(["org-members", "o9"]);
    expect(keys).toContainEqual(["reports", "o9"]);
  });

  it("record.changed without an org id touches only my records", () => {
    expect(realtimeInvalidations({ type: "record.changed" })).toEqual([
      ["me-records"],
    ]);
  });

  it.each([
    { type: "hello" },
    { type: "ping" },
    { type: "error", data: { code: "x" } },
    { type: "activity.changed", data: "not-an-object" },
  ])("returns [] or partial keys for non-data envelopes: %j", (envelope) => {
    const keys = realtimeInvalidations(envelope);
    expect(Array.isArray(keys)).toBe(true);
    expect(keys.every((key) => Array.isArray(key))).toBe(true);
  });
});

describe("REALTIME_EVENT_TYPES", () => {
  it("lists every contract event exactly once", () => {
    expect([...REALTIME_EVENT_TYPES].sort()).toEqual(
      [
        "activity.changed",
        "checkin.recorded",
        "record.changed",
        "registration.changed",
      ].sort(),
    );
  });
});
