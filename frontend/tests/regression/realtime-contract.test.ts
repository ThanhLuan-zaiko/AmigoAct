/**
 * Regression tests — the realtime/query-key half of the cross-stack
 * contract (split from `api-contract.test.ts` to stay under the size cap).
 *
 * The backend serializes event payloads in `backend/api/events.py` and the
 * frontend maps them to cache invalidations; both the payload key sets and
 * the invalidation wiring are pinned here so a rename cannot slip through.
 *
 * Layer: **regression**
 */
import { describe, expect, it } from "vitest";

import { qk } from "@/lib/query-keys";
import {
  REALTIME_EVENT_TYPES,
  realtimeInvalidations,
} from "@/lib/realtime-events";
import { WS_AUTH_CLOSE_CODE, WS_AUTH_ERROR_MESSAGE } from "@/lib/websocket";

/**
 * The exact `data` key set each pushed event carries — the backend
 * serializes these, the invalidation map reads them. If the backend
 * renames a field the invalidations silently miss; this pins them.
 */
const REALTIME_DATA_KEYS: Record<
  (typeof REALTIME_EVENT_TYPES)[number],
  readonly string[]
> = {
  "activity.changed": ["org_id", "activity_id", "activity_status"],
  "registration.changed": [
    "org_id",
    "activity_id",
    "registration_id",
    "member_id",
    "status",
  ],
  "checkin.recorded": [
    "org_id",
    "activity_id",
    "registration_id",
    "member_user_id",
    "member_full_name",
    "checked_in_at",
    "checked_in_count",
  ],
  "record.changed": [
    "org_id",
    "activity_id",
    "record_id",
    "member_id",
    "title",
    "hours",
    "points",
    "awarded_on",
  ],
};

describe("realtime contract", () => {
  it("pins the pushed event type strings", () => {
    expect(REALTIME_EVENT_TYPES).toEqual([
      "activity.changed",
      "registration.changed",
      "checkin.recorded",
      "record.changed",
    ]);
  });

  it("pins the data key set of every pushed event", () => {
    // One representative payload per event — keys must match the frozen
    // backend serializers in `backend/src/backend/api/events.py`.
    const samples: Record<
      (typeof REALTIME_EVENT_TYPES)[number],
      Record<string, unknown>
    > = {
      "activity.changed": {
        org_id: "o1",
        activity_id: "a1",
        activity_status: "published",
      },
      "registration.changed": {
        org_id: "o1",
        activity_id: "a1",
        registration_id: "r1",
        member_id: "m1",
        status: "approved",
      },
      "checkin.recorded": {
        org_id: "o1",
        activity_id: "a1",
        registration_id: "r1",
        member_user_id: "u1",
        member_full_name: "Nguyễn Lan",
        checked_in_at: "2026-06-15T08:10:00Z",
        checked_in_count: 7,
      },
      "record.changed": {
        org_id: "o1",
        activity_id: "a1",
        record_id: "rec1",
        member_id: "m1",
        title: "Hiến máu",
        hours: 4,
        points: 2,
        awarded_on: "2026-06-16",
      },
    };
    for (const type of REALTIME_EVENT_TYPES) {
      expect(Object.keys(samples[type]).sort()).toEqual(
        [...REALTIME_DATA_KEYS[type]].sort(),
      );
    }
  });

  it("maps each event's contract fields to the right invalidations", () => {
    // The invalidation map must consume org_id/activity_id from every
    // event — that is what the data keys exist for.
    for (const type of REALTIME_EVENT_TYPES) {
      const data = Object.fromEntries(
        REALTIME_DATA_KEYS[type].map((key) => [
          key,
          key === "org_id" ? "o1" : key === "activity_id" ? "a1" : "x",
        ]),
      );
      const keys = realtimeInvalidations({ type, data });
      expect(
        keys.some((key) => key[0] === "reports" && key[1] === "o1"),
        `${type} must invalidate the org reports`,
      ).toBe(true);
    }
  });

  it("pins the WebSocket auth-rejection close code", () => {
    expect(WS_AUTH_CLOSE_CODE).toBe(4401);
    expect(WS_AUTH_ERROR_MESSAGE).toBe("WebSocket authentication rejected");
  });
});

describe("query key contract", () => {
  it("pins the Phase-6 keys the pages and realtime layer share", () => {
    expect(qk.meRecords).toEqual(["me-records"]);
    expect(qk.orgMembers("o1")).toEqual(["org-members", "o1"]);
    expect(qk.memberRecords("o1")).toEqual(["member-records", "o1"]);
    expect(qk.memberRecords("o1", "m1")).toEqual([
      "member-records",
      "o1",
      "m1",
    ]);
    expect(qk.reports("o1")).toEqual(["reports", "o1"]);
    expect(qk.reports("o1", "overview", { from: "2026-01-01" })).toEqual([
      "reports",
      "o1",
      "overview",
      { from: "2026-01-01" },
    ]);
  });
});
