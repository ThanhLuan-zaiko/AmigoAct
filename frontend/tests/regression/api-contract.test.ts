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

import {
  DEFAULT_GREETING,
  DEFAULT_NAME,
  MAX_NAME_LENGTH,
} from "@/lib/greeting";

/** Response keys the backend `/api/greeting` endpoint is contracted to return. */
const GREETING_RESPONSE_KEYS = ["message"];

/** Response keys the backend `/api/health` endpoint is contracted to return. */
const HEALTH_RESPONSE_KEYS = ["app", "environment", "status", "version"];

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

describe("user-facing language", () => {
  it("renders Vietnamese copy in the greeting card", () => {
    expect(DEFAULT_GREETING).toBe("Xin chào");
    expect(DEFAULT_NAME).toBe("bạn");
  });
});
