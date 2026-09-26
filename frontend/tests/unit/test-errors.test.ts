/**
 * Unit tests for `lib/errors.ts` — every contract error code maps to
 * Vietnamese copy; unknown codes and non-API errors fall back to the
 * generic message. The exact strings are pinned in `tests/regression/`.
 *
 * Layer: **unit**
 */
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import {
  API_ERROR_MESSAGES,
  describeApiError,
  GENERIC_ERROR_MESSAGE,
} from "@/lib/errors";

/** Every error code in the frozen contract (auth + orgs + activities). */
const CONTRACT_CODES = [
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
] as const;

describe("API_ERROR_MESSAGES", () => {
  it.each(CONTRACT_CODES)("maps %s to Vietnamese copy", (code) => {
    const message = API_ERROR_MESSAGES[code];
    expect(message).toBeTruthy();
    // Never leak the raw English code to the UI.
    expect(message).not.toBe(code);
    expect(message).not.toBe(GENERIC_ERROR_MESSAGE);
  });
});

describe("describeApiError", () => {
  it("translates ApiError codes", () => {
    expect(describeApiError(new ApiError(404, "org_not_found", "nope"))).toBe(
      "Không tìm thấy tổ chức với mã này",
    );
    expect(
      describeApiError(new ApiError(409, "wrong_checkin_code", "nope")),
    ).toBe("Mã điểm danh không đúng");
    expect(describeApiError(new ApiError(404, "record_not_found", "x"))).toBe(
      "Không tìm thấy thành tích",
    );
    expect(describeApiError(new ApiError(409, "last_admin", "x"))).toBe(
      "Tổ chức cần ít nhất một quản trị viên",
    );
  });

  it("falls back for unknown codes, plain errors and oddballs", () => {
    expect(describeApiError(new ApiError(500, "weird", "x"))).toBe(
      GENERIC_ERROR_MESSAGE,
    );
    expect(describeApiError(new Error("nope"))).toBe(GENERIC_ERROR_MESSAGE);
    expect(describeApiError("string")).toBe(GENERIC_ERROR_MESSAGE);
    expect(describeApiError(undefined)).toBe(GENERIC_ERROR_MESSAGE);
  });
});
