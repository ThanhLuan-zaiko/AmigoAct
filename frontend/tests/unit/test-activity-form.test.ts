/**
 * Unit tests for `lib/activity-form.ts` — payload assembly and Vietnamese
 * validation messages for the activity create/edit form. Pure, no I/O.
 *
 * Layer: **unit**
 */
import { describe, expect, it } from "vitest";

import {
  type ActivityFormFields,
  buildActivityPayload,
} from "@/lib/activity-form";

const VALID: ActivityFormFields = {
  title: "Hiến máu tình nguyện",
  description: "  Mô tả  ",
  location: "Hội trường A",
  capacity: "50",
  points: "2.5",
  hours: "4",
  registrationOpens: "2026-06-01T08:00",
  registrationCloses: "2026-06-14T08:00",
  startsAt: "2026-06-15T08:00",
  endsAt: "2026-06-15T17:00",
};

describe("buildActivityPayload — happy path", () => {
  it("builds the contract body with ISO datetimes", () => {
    const result = buildActivityPayload(VALID, "create");
    expect(result.error).toBeUndefined();
    expect(result.body?.title).toBe("Hiến máu tình nguyện");
    expect(result.body?.points).toBe(2.5);
    expect(result.body?.hours).toBe(4);
    expect(result.body?.capacity).toBe(50);
    expect(result.body?.description).toBe("Mô tả");
    expect(result.body?.location).toBe("Hội trường A");
    expect(String(result.body?.starts_at)).toMatch(/^\d{4}-.*Z$/);
    expect(String(result.body?.registration_opens_at)).toMatch(/Z$/);
    expect(String(result.body?.registration_closes_at)).toMatch(/Z$/);
  });

  it("create omits empty optional fields entirely", () => {
    const result = buildActivityPayload(
      {
        ...VALID,
        description: "  ",
        location: "",
        capacity: "",
        registrationOpens: "",
        registrationCloses: "",
      },
      "create",
    );
    expect(result.body).toEqual({
      title: "Hiến máu tình nguyện",
      points: 2.5,
      hours: 4,
      starts_at: result.body?.starts_at,
      ends_at: result.body?.ends_at,
    });
  });

  it("edit sends emptied optional fields as null", () => {
    const result = buildActivityPayload(
      {
        ...VALID,
        description: "",
        location: "",
        capacity: "",
        registrationOpens: "",
        registrationCloses: "",
      },
      "edit",
    );
    expect(result.body?.description).toBeNull();
    expect(result.body?.location).toBeNull();
    expect(result.body?.capacity).toBeNull();
    expect(result.body?.registration_opens_at).toBeNull();
    expect(result.body?.registration_closes_at).toBeNull();
  });
});

describe("buildActivityPayload — validation", () => {
  it("rejects an ends_at that is not after starts_at", () => {
    for (const endsAt of ["2026-06-15T08:00", "2026-06-15T07:00"]) {
      expect(buildActivityPayload({ ...VALID, endsAt }, "create").error).toBe(
        "Thời gian kết thúc phải sau thời gian bắt đầu",
      );
    }
  });

  it("rejects unparseable datetimes", () => {
    expect(
      buildActivityPayload({ ...VALID, startsAt: "nope" }, "create").error,
    ).toBe("Thời gian không hợp lệ");
    expect(buildActivityPayload({ ...VALID, endsAt: "" }, "create").error).toBe(
      "Thời gian không hợp lệ",
    );
  });

  it("rejects negative or non-numeric points/hours", () => {
    expect(
      buildActivityPayload({ ...VALID, points: "-1" }, "create").error,
    ).toBe("Điểm và giờ tình nguyện phải là số không âm");
    expect(
      buildActivityPayload({ ...VALID, hours: "abc" }, "create").error,
    ).toBe("Điểm và giờ tình nguyện phải là số không âm");
  });

  it("pins capacity errors to the capacity field", () => {
    for (const capacity of ["0", "2.5", "-3", "abc"]) {
      const result = buildActivityPayload({ ...VALID, capacity }, "create");
      expect(result.capacityError).toBe(
        "Sức chứa phải là số nguyên từ 1 trở lên",
      );
      expect(result.body).toBeUndefined();
    }
  });

  it("rejects malformed and reversed registration windows", () => {
    expect(
      buildActivityPayload({ ...VALID, registrationOpens: "garbage" }, "create")
        .error,
    ).toBe("Thời gian đăng ký không hợp lệ");
    expect(
      buildActivityPayload(
        {
          ...VALID,
          registrationOpens: "2026-06-14T08:00",
          registrationCloses: "2026-06-01T08:00",
        },
        "create",
      ).error,
    ).toBe("Thời gian đóng đăng ký phải sau thời gian mở");
  });
});
