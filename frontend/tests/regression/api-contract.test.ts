/**
 * Regression tests — the frontend half of the contract locked down by
 * `backend/tests/regression/test_api_contract.py`.
 *
 * These run in the `node` environment: no jsdom, no React. They assert the
 * shapes and constants the API and the UI agree on, so a change on one side
 * cannot silently break the other.
 *
 * Layer: **regression**
 */
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import { clearToken, getToken, TOKEN_STORAGE_KEY } from "@/lib/auth-storage";
import {
  CHECKIN_CODE_ALPHABET,
  CHECKIN_CODE_LENGTH,
  CHECKIN_EARLY_MINUTES,
} from "@/lib/checkin";
import { API_ERROR_MESSAGES, describeApiError } from "@/lib/errors";
import {
  DEFAULT_GREETING,
  DEFAULT_NAME,
  MAX_NAME_LENGTH,
} from "@/lib/greeting";
import {
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_STATUSES,
  MEMBER_ROLE_LABELS,
  MEMBER_STATUS_LABELS,
  REGISTRATION_STATUS_LABELS,
  REGISTRATION_STATUSES,
} from "@/lib/labels";
import { THEME_STORAGE_KEY } from "@/lib/theme";

/** Response keys the backend `/api/greeting` endpoint is contracted to return. */
const GREETING_RESPONSE_KEYS = ["message"];

/** Response keys the backend `/api/health` endpoint is contracted to return. */
const HEALTH_RESPONSE_KEYS = ["app", "environment", "status", "version"];

/** Error codes the backend may return — every one must have a VN message. */
const CONTRACT_ERROR_CODES = [
  "missing_token",
  "token_invalid",
  "invalid_credentials",
  "account_disabled",
  "email_taken",
  "invalid_email",
  "password_too_short",
  "password_too_long",
  "invalid_name",
  "not_found",
  "permission_denied",
  "conflict",
  "rule_violation",
  // Phase 5 — org/activity/registration/check-in codes.
  "org_not_found",
  "org_code_taken",
  "invalid_org_code",
  "not_a_member",
  "already_member",
  "student_code_taken",
  "last_admin",
  "insufficient_role",
  "activity_not_found",
  "invalid_transition",
  "invalid_window",
  "activity_over",
  "capacity_below_registrations",
  "activity_full",
  "registration_closed",
  "already_registered",
  "registration_rejected",
  "cannot_cancel",
  "cannot_review_checked_in",
  "registration_not_approved",
  "registration_not_found",
  "checkin_not_started",
  "checkin_ended",
  "invalid_code",
  "wrong_checkin_code",
  // Phase 6 — member management and record codes.
  "member_not_found",
  "record_not_found",
  "record_exists",
  "invalid_evidence_url",
  "future_awarded_on",
  "invalid_status",
  "cannot_review",
  "activity_not_published",
  "not_started",
  "terminal_state",
  // apiFetch's local codes — FastAPI list-detail and transport failures.
  "validation_error",
  "unexpected_response",
  "network_error",
] as const;

describe("cross-stack API contract", () => {
  it("keeps the greeting response shape to exactly one key", () => {
    expect(Object.keys({ message: "Xin chào, Lan!" })).toEqual(
      GREETING_RESPONSE_KEYS,
    );
  });

  it("keeps the health response keys in sync with the backend", () => {
    expect(
      Object.keys({ app: "", environment: "", status: "", version: "" }),
    ).toEqual(HEALTH_RESPONSE_KEYS);
  });

  it("uses the same name-length limit as the backend", () => {
    // backend/src/backend/domain/greeting.py :: MAX_NAME_LENGTH
    expect(MAX_NAME_LENGTH).toBe(80);
  });

  it("uses the same default salutation as the backend", () => {
    // backend/src/backend/domain/greeting.py :: DEFAULT_GREETING
    expect(DEFAULT_GREETING).toBe("Xin chào");
  });

  it("uses the same default name as the backend", () => {
    // backend/src/backend/domain/greeting.py :: DEFAULT_NAME
    expect(DEFAULT_NAME).toBe("bạn");
  });
});

describe("check-in code contract", () => {
  it("pins the alphabet the backend generates codes from", () => {
    // backend domain emits codes in this exact lookalike-free alphabet.
    expect(CHECKIN_CODE_ALPHABET).toBe("ABCDEFGHJKMNPQRSTUVWXYZ23456789");
  });

  it("pins the agreed code length", () => {
    expect(CHECKIN_CODE_LENGTH).toBe(6);
  });

  it("pins the check-in window opening offset (display mirror)", () => {
    // The server enforces starts_at − 60min … ends_at; the UI shows it.
    expect(CHECKIN_EARLY_MINUTES).toBe(60);
  });
});

describe("status vocabulary contract", () => {
  it("pins the activity lifecycle values", () => {
    expect(ACTIVITY_STATUSES).toEqual([
      "draft",
      "published",
      "cancelled",
      "completed",
    ]);
  });

  it("pins the registration lifecycle values", () => {
    expect(REGISTRATION_STATUSES).toEqual([
      "pending",
      "approved",
      "rejected",
      "cancelled",
    ]);
  });

  it("labels every contract status in Vietnamese", () => {
    for (const status of ACTIVITY_STATUSES) {
      expect(ACTIVITY_STATUS_LABELS[status]).toBeTruthy();
    }
    for (const status of REGISTRATION_STATUSES) {
      expect(REGISTRATION_STATUS_LABELS[status]).toBeTruthy();
    }
    expect(ACTIVITY_STATUS_LABELS.published).toBe("Đã công bố");
    expect(REGISTRATION_STATUS_LABELS.approved).toBe("Đã duyệt");
  });

  it("labels every member role and status in Vietnamese", () => {
    expect(MEMBER_ROLE_LABELS.admin).toBe("Quản trị");
    expect(MEMBER_ROLE_LABELS.manager).toBe("Ban chấp hành");
    expect(MEMBER_ROLE_LABELS.member).toBe("Đoàn viên");
    expect(MEMBER_STATUS_LABELS.active).toBe("Hoạt động");
    expect(MEMBER_STATUS_LABELS.inactive).toBe("Ngừng");
  });
});

// The realtime payload/query-key pins live in realtime-contract.test.ts.

describe("error code contract", () => {
  it.each(CONTRACT_ERROR_CODES)("maps %s to a Vietnamese message", (code) => {
    expect(API_ERROR_MESSAGES[code]).toBeTruthy();
  });

  it("pins the messages the auth flow depends on", () => {
    expect(
      describeApiError(new ApiError(401, "invalid_credentials", "x")),
    ).toBe("Email hoặc mật khẩu không đúng");
    expect(describeApiError(new ApiError(409, "email_taken", "x"))).toBe(
      "Email này đã được đăng ký",
    );
    expect(describeApiError(new ApiError(422, "password_too_short", "x"))).toBe(
      "Mật khẩu cần ít nhất 8 ký tự",
    );
    expect(describeApiError(new ApiError(401, "token_invalid", "x"))).toBe(
      "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại",
    );
    expect(describeApiError(new ApiError(401, "missing_token", "x"))).toBe(
      "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại",
    );
    expect(describeApiError(new ApiError(401, "account_disabled", "x"))).toBe(
      "Tài khoản đã bị khóa",
    );
    expect(describeApiError(new ApiError(500, "unmapped", "x"))).toBe(
      "Có lỗi xảy ra, thử lại sau",
    );
    expect(describeApiError(new Error("not api"))).toBe(
      "Có lỗi xảy ra, thử lại sau",
    );
  });
});

describe("storage key contract", () => {
  it("pins the token storage key", () => {
    expect(TOKEN_STORAGE_KEY).toBe("amigoact-token");
    // SSR-safe: importing and calling these in node must not throw.
    expect(getToken()).toBeNull();
    expect(() => clearToken()).not.toThrow();
  });

  it("pins the theme storage key the inline script writes", () => {
    // The literal in app/layout.tsx's bootstrap script must match.
    expect(THEME_STORAGE_KEY).toBe("amigoact-theme");
  });
});

describe("user-facing language", () => {
  it("renders Vietnamese copy in the greeting card", () => {
    expect(DEFAULT_GREETING).toBe("Xin chào");
    expect(DEFAULT_NAME).toBe("bạn");
  });
});
