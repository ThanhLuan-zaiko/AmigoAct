/**
 * Unit tests for `lib/checkin.ts` — the check-in code contract and payload
 * parsing for QR scans / manual entry. Pure functions, no I/O.
 *
 * Layer: **unit**
 */
import { describe, expect, it } from "vitest";

import {
  buildCheckinUrl,
  CHECKIN_CODE_ALPHABET,
  CHECKIN_CODE_LENGTH,
  CHECKIN_EARLY_MINUTES,
  checkinOpensAt,
  normalizeCheckinCode,
  parseCheckinPayload,
} from "@/lib/checkin";

const VALID_CODE = "KM2P4R"; // 6 chars, all inside the alphabet

describe("checkin code contract", () => {
  it("excludes lookalike characters from the alphabet", () => {
    for (const char of "ILO01") {
      expect(CHECKIN_CODE_ALPHABET).not.toContain(char);
    }
  });

  it("uses uppercase letters and digits 2-9 only", () => {
    expect(CHECKIN_CODE_ALPHABET).toMatch(/^[A-Z2-9]+$/);
  });

  it("keeps the agreed code length", () => {
    expect(CHECKIN_CODE_LENGTH).toBe(6);
  });
});

describe("normalizeCheckinCode", () => {
  it("returns the code uppercased", () => {
    expect(normalizeCheckinCode("km2p4r")).toBe(VALID_CODE);
  });

  it("strips surrounding and inner whitespace", () => {
    expect(normalizeCheckinCode("  KM 2P4R ")).toBe(VALID_CODE);
  });

  it.each([
    "",
    "   ",
    "ABC", // too short
    "ABCDEFGH", // too long
    "KM2P4I", // I is not in the alphabet
    "KM2P4O", // O is not in the alphabet
    "KM2P40", // 0 is not in the alphabet
    "KM2P-4", // punctuation
  ])("returns null for %j", (raw) => {
    expect(normalizeCheckinCode(raw)).toBeNull();
  });
});

describe("buildCheckinUrl", () => {
  it("builds the contract URL shape", () => {
    expect(buildCheckinUrl("act-123", VALID_CODE)).toBe(
      "/checkin?a=act-123&c=KM2P4R",
    );
  });

  it("encodes reserved characters", () => {
    expect(buildCheckinUrl("a&b", VALID_CODE)).toBe(
      "/checkin?a=a%26b&c=KM2P4R",
    );
  });
});

describe("checkinOpensAt", () => {
  it("opens the window CHECKIN_EARLY_MINUTES before starts_at", () => {
    expect(checkinOpensAt("2026-06-15T08:00:00.000Z")).toBe(
      "2026-06-15T07:00:00.000Z",
    );
    expect(CHECKIN_EARLY_MINUTES).toBe(60);
  });

  it("throws on an unparseable starts_at", () => {
    expect(() => checkinOpensAt("nope")).toThrow("invalid ISO datetime");
  });
});

describe("parseCheckinPayload", () => {
  it("parses a bare code", () => {
    expect(parseCheckinPayload("km2p4r")).toEqual({
      activityId: null,
      code: VALID_CODE,
    });
  });

  it("parses the app checkin URL", () => {
    expect(
      parseCheckinPayload("https://app.example/checkin?a=act-1&c=km2p4r"),
    ).toEqual({ activityId: "act-1", code: VALID_CODE });
  });

  it("parses a relative checkin URL", () => {
    expect(parseCheckinPayload("/checkin?a=act-9&c=KM2P4R")).toEqual({
      activityId: "act-9",
      code: VALID_CODE,
    });
  });

  it("parses a bare query payload without a URL wrapper", () => {
    expect(parseCheckinPayload("a=act-7&c=KM2P4R")).toEqual({
      activityId: "act-7",
      code: VALID_CODE,
    });
  });

  it.each([
    "",
    "   ",
    "not a code at all",
    "/checkin?a=act-1", // missing code
    "/checkin?c=KM2P4R", // missing activity id
    "/checkin?a=act-1&c=BAD!!!", // malformed code
    "a=act-1&c=TOOLONGCODE", // malformed code
  ])("returns null for %j", (raw) => {
    expect(parseCheckinPayload(raw)).toBeNull();
  });
});
