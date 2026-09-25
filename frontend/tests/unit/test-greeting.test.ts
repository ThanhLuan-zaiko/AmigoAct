/**
 * Unit tests for `lib/greeting.ts` — pure functions, no React, no I/O.
 *
 * Layer: **unit**
 */
import { describe, expect, it } from "vitest";

import {
  buildGreeting,
  DEFAULT_GREETING,
  DEFAULT_NAME,
  InvalidNameError,
  MAX_NAME_LENGTH,
  normalizeName,
} from "@/lib/greeting";

describe("normalizeName", () => {
  it.each([
    ["Lan", "Lan"],
    ["  Lan  ", "Lan"],
    ["Lan   Anh", "Lan Anh"],
    ["\tLan\nAnh  ", "Lan Anh"],
  ])("collapses whitespace in %j", (raw, expected) => {
    expect(normalizeName(raw)).toBe(expected);
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeName("   ")).toBe("");
  });
});

describe("buildGreeting", () => {
  it("builds a greeting for a name", () => {
    expect(buildGreeting("Lan")).toBe(`${DEFAULT_GREETING}, Lan!`);
  });

  it("normalizes the name first", () => {
    expect(buildGreeting("  Lan   Anh ")).toBe(`${DEFAULT_GREETING}, Lan Anh!`);
  });

  it.each([
    undefined,
    null,
    "",
    "   ",
  ])("falls back to the default name for %j", (value) => {
    expect(buildGreeting(value)).toBe(`${DEFAULT_GREETING}, ${DEFAULT_NAME}!`);
  });

  it("uses a Vietnamese default salutation", () => {
    expect(DEFAULT_GREETING).toBe("Xin chào");
  });

  it("uses a Vietnamese default name", () => {
    expect(DEFAULT_NAME).toBe("bạn");
  });

  it("supports a custom salutation", () => {
    expect(buildGreeting("Lan", "Chào buổi sáng")).toBe("Chào buổi sáng, Lan!");
  });

  it("collapses whitespace in the salutation", () => {
    expect(buildGreeting("Lan", "  Chào   buổi sáng ")).toBe(
      "Chào buổi sáng, Lan!",
    );
  });

  it.each([
    "",
    "   ",
  ])("falls back to the default for the blank salutation %j", (blank) => {
    expect(buildGreeting("Lan", blank)).toBe(`${DEFAULT_GREETING}, Lan!`);
  });

  it("accepts a name exactly at the length limit", () => {
    const name = "x".repeat(MAX_NAME_LENGTH);
    expect(buildGreeting(name)).toBe(`${DEFAULT_GREETING}, ${name}!`);
  });

  it("throws for a name over the length limit", () => {
    const name = "x".repeat(MAX_NAME_LENGTH + 1);
    expect(() => buildGreeting(name)).toThrow(InvalidNameError);
    expect(() => buildGreeting(name)).toThrow("at most 80 characters");
  });

  it("ends with exactly one exclamation mark", () => {
    expect(buildGreeting("Lan").endsWith("!!")).toBe(false);
  });
});
