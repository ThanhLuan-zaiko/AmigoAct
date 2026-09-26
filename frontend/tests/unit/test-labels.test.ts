/**
 * Unit tests for `lib/labels.ts` — the Vietnamese display vocabulary for
 * contract statuses and roles. Pure maps/functions, no I/O.
 *
 * Layer: **unit**
 */
import { describe, expect, it } from "vitest";

import {
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_STATUSES,
  isManagerRole,
  MEMBER_ROLE_LABELS,
  MEMBER_STATUS_LABELS,
  MEMBER_STATUSES,
  REGISTRATION_STATUS_LABELS,
  REGISTRATION_STATUSES,
  ROLE_RANK,
  statusLabel,
} from "@/lib/labels";
import type {
  ActivityStatus,
  MemberRole,
  MemberStatus,
  RegistrationStatus,
} from "@/lib/types";

describe("status vocabularies", () => {
  it("labels every activity status in Vietnamese", () => {
    for (const status of ACTIVITY_STATUSES) {
      expect(ACTIVITY_STATUS_LABELS[status]).toBeTruthy();
    }
    expect(ACTIVITY_STATUS_LABELS.draft).toBe("Bản nháp");
    expect(ACTIVITY_STATUS_LABELS.published).toBe("Đã công bố");
    expect(ACTIVITY_STATUS_LABELS.cancelled).toBe("Đã hủy");
    expect(ACTIVITY_STATUS_LABELS.completed).toBe("Đã hoàn thành");
  });

  it("labels every registration status in Vietnamese", () => {
    for (const status of REGISTRATION_STATUSES) {
      expect(REGISTRATION_STATUS_LABELS[status]).toBeTruthy();
    }
    expect(REGISTRATION_STATUS_LABELS.pending).toBe("Chờ duyệt");
    expect(REGISTRATION_STATUS_LABELS.approved).toBe("Đã duyệt");
    expect(REGISTRATION_STATUS_LABELS.rejected).toBe("Đã từ chối");
    expect(REGISTRATION_STATUS_LABELS.cancelled).toBe("Đã hủy");
  });

  it("statusLabel covers the union of both vocabularies", () => {
    const all: readonly (ActivityStatus | RegistrationStatus)[] = [
      ...ACTIVITY_STATUSES,
      ...REGISTRATION_STATUSES,
    ];
    for (const status of all) {
      expect(statusLabel(status)).not.toBe(status);
      expect(statusLabel(status).length).toBeGreaterThan(0);
    }
  });
});

describe("MEMBER_ROLE_LABELS", () => {
  it("labels every contract role", () => {
    const roles: readonly MemberRole[] = ["admin", "manager", "member"];
    for (const role of roles) {
      expect(MEMBER_ROLE_LABELS[role]).toBeTruthy();
    }
    expect(MEMBER_ROLE_LABELS.admin).toBe("Quản trị");
    expect(MEMBER_ROLE_LABELS.manager).toBe("Ban chấp hành");
    expect(MEMBER_ROLE_LABELS.member).toBe("Đoàn viên");
  });
});

describe("MEMBER_STATUS_LABELS", () => {
  it("labels every membership status", () => {
    const statuses: readonly MemberStatus[] = [...MEMBER_STATUSES];
    for (const status of statuses) {
      expect(MEMBER_STATUS_LABELS[status]).toBeTruthy();
    }
    expect(MEMBER_STATUS_LABELS.active).toBe("Hoạt động");
    expect(MEMBER_STATUS_LABELS.inactive).toBe("Ngừng");
  });
});

describe("ROLE_RANK", () => {
  it("ranks admin strongest and member weakest", () => {
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK.manager);
    expect(ROLE_RANK.manager).toBeLessThan(ROLE_RANK.member);
  });
});

describe("isManagerRole", () => {
  it("is true for manager and admin only", () => {
    expect(isManagerRole("manager")).toBe(true);
    expect(isManagerRole("admin")).toBe(true);
    expect(isManagerRole("member")).toBe(false);
  });
});
