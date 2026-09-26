/**
 * Unit tests for `lib/format.ts` — vi-VN number/date rendering and the
 * `datetime-local` conversions. Timezone-sensitive cases inject `timeZone`
 * explicitly; nothing here depends on the host TZ.
 *
 * Layer: **unit**
 */
import { describe, expect, it } from "vitest";

import {
  datetimeLocalToIso,
  formatDate,
  formatDateTime,
  formatDay,
  formatHours,
  formatPercent,
  isoToDatetimeLocal,
  todayDateInput,
} from "@/lib/format";

describe("formatHours", () => {
  it.each([
    [8, "8"],
    [8.5, "8,5"],
    [0, "0"],
    [12.25, "12,25"],
    [1000, "1.000"], // vi-VN groups with a dot
  ])("formats %j hours as %j", (hours, expected) => {
    expect(formatHours(hours)).toBe(expected);
  });
});

describe("formatDate", () => {
  it("renders a vi-VN date in an injected timeZone", () => {
    expect(formatDate("2026-06-15T18:00:00Z", "UTC")).toBe("15/06/2026");
  });

  it("respects the zone — the same instant can flip a day", () => {
    expect(formatDate("2026-06-15T18:00:00Z", "Asia/Ho_Chi_Minh")).toBe(
      "16/06/2026",
    );
  });

  it("throws on an unparseable datetime", () => {
    expect(() => formatDate("not a date", "UTC")).toThrow("invalid ISO");
  });
});

describe("formatDay", () => {
  it("renders a YYYY-MM-DD contract date as DD/MM/YYYY", () => {
    expect(formatDay("2026-06-15")).toBe("15/06/2026");
    expect(formatDay("2026-01-01")).toBe("01/01/2026");
  });

  it.each([
    "",
    "15/06/2026",
    "2026-6-5",
    "not a date",
  ])("throws on malformed input %j — a silent day-shift would be worse", (raw) => {
    expect(() => formatDay(raw)).toThrow("invalid date");
  });
});

describe("formatPercent", () => {
  it.each([
    [0.8, "80%"],
    [0, "0%"],
    [1, "100%"],
    [0.753, "75,3%"],
  ])("formats %j as %j", (ratio, expected) => {
    expect(formatPercent(ratio)).toBe(expected);
  });
});

describe("todayDateInput", () => {
  it("renders the injected date in the viewer's local zone", () => {
    expect(todayDateInput(new Date(2026, 5, 15, 12, 0, 0))).toBe("2026-06-15");
  });

  it("zero-pads single-digit months and days", () => {
    expect(todayDateInput(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("formatDateTime", () => {
  it("renders date and time in the injected zone", () => {
    const rendered = formatDateTime("2026-06-15T18:30:00.000Z", "UTC");
    expect(rendered).toContain("18:30");
    expect(rendered).toContain("15/06/2026");
  });

  it("shifts the wall time to the zone", () => {
    const rendered = formatDateTime(
      "2026-06-15T18:30:00.000Z",
      "Asia/Ho_Chi_Minh",
    );
    expect(rendered).toContain("01:30");
    expect(rendered).toContain("16/06/2026");
  });
});

describe("isoToDatetimeLocal", () => {
  it("converts to input format in an injected zone", () => {
    expect(isoToDatetimeLocal("2026-06-15T18:30:00.000Z", "UTC")).toBe(
      "2026-06-15T18:30",
    );
  });

  it("shifts the result into the given zone", () => {
    expect(
      isoToDatetimeLocal("2026-06-15T18:30:00.000Z", "Asia/Ho_Chi_Minh"),
    ).toBe("2026-06-16T01:30");
  });

  it("returns null for unparseable input", () => {
    expect(isoToDatetimeLocal("garbage")).toBeNull();
  });
});

describe("datetimeLocalToIso", () => {
  it("interprets the wall time in an injected zone", () => {
    expect(datetimeLocalToIso("2026-06-15T18:30", "UTC")).toBe(
      "2026-06-15T18:30:00.000Z",
    );
  });

  it("converts a zoned wall time back to UTC", () => {
    expect(datetimeLocalToIso("2026-06-16T01:30", "Asia/Ho_Chi_Minh")).toBe(
      "2026-06-15T18:30:00.000Z",
    );
  });

  it("accepts a space separator and seconds", () => {
    expect(datetimeLocalToIso("2026-06-15 18:30:15", "UTC")).toBe(
      "2026-06-15T18:30:15.000Z",
    );
  });

  it.each([
    "",
    "garbage",
    "15/06/2026 18:30",
    "2026-13-15T18:30", // month 13
    "2026-02-30T10:00", // February 30th
    "2026-06-15T25:30", // hour 25
    "2026-06-15T18:99", // minute 99
  ])("returns null for %j", (raw) => {
    expect(datetimeLocalToIso(raw, "UTC")).toBeNull();
  });
});

describe("round-trip", () => {
  it.each([
    "UTC",
    "Asia/Ho_Chi_Minh",
    "America/New_York",
    "Pacific/Kiritimati",
  ])("iso → datetime-local → iso is stable in %s", (timeZone) => {
    const iso = "2026-06-15T18:30:00.000Z";
    const local = isoToDatetimeLocal(iso, timeZone);
    expect(local).not.toBeNull();
    expect(datetimeLocalToIso(local ?? "", timeZone)).toBe(iso);
  });
});
