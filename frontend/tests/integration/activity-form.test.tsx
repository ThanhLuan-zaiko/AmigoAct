/**
 * Integration tests for the shared ActivityForm (create + edit modes) and
 * the role gates in NewActivityView / EditActivityView. `fetch` mocked.
 *
 * Layer: **integration**
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditActivityView } from "@/app/activities/[id]/edit/edit-activity-view";
import { NewActivityView } from "@/app/orgs/[orgId]/activities/new/new-activity-view";
import { ActivityForm } from "@/components/activity-form";
import { isoToDatetimeLocal } from "@/lib/format";
import { callsTo, mockApi } from "@/tests/helpers/api-mock";
import { activity, activityDetail, orgDetail } from "@/tests/helpers/fixtures";
import { renderAuthed } from "@/tests/helpers/render";
import { getMockRouter } from "@/tests/setup";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fillDateTimes() {
  fireEvent.change(screen.getByLabelText("Bắt đầu"), {
    target: { value: "2026-06-15T08:00" },
  });
  fireEvent.change(screen.getByLabelText("Kết thúc"), {
    target: { value: "2026-06-15T17:00" },
  });
}

describe("ActivityForm — create", () => {
  it("posts the contract body and navigates to the new activity", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      "POST /api/orgs/o-1/activities": { body: { activity: activity() } },
    });
    renderAuthed(<ActivityForm orgId="o-1" />);

    await user.type(screen.getByLabelText("Tên hoạt động"), "Hiến máu");
    await user.type(screen.getByLabelText("Sức chứa"), "50");
    fireEvent.change(screen.getByLabelText("Giờ tình nguyện"), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("Điểm"), {
      target: { value: "2.5" },
    });
    fillDateTimes();
    await user.click(screen.getByRole("button", { name: "Tạo hoạt động" }));

    await waitFor(() =>
      expect(getMockRouter().push).toHaveBeenCalledWith("/activities/a-1"),
    );
    const body = callsTo(calls, "POST", "/api/orgs/o-1/activities")[0]
      .body as Record<string, unknown>;
    expect(body.title).toBe("Hiến máu");
    expect(body.hours).toBe(4);
    expect(body.points).toBe(2.5);
    expect(body.capacity).toBe(50);
    expect(String(body.starts_at)).toMatch(/^\d{4}-.*Z$/);
    // Empty optional fields are omitted on create.
    expect(body).not.toHaveProperty("description");
    expect(body).not.toHaveProperty("registration_opens_at");
  });

  it("blocks a backwards time window locally", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      "POST /api/orgs/o-1/activities": { body: { activity: activity() } },
    });
    renderAuthed(<ActivityForm orgId="o-1" />);

    await user.type(screen.getByLabelText("Tên hoạt động"), "X");
    fireEvent.change(screen.getByLabelText("Giờ tình nguyện"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Điểm"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Bắt đầu"), {
      target: { value: "2026-06-15T18:00" },
    });
    fireEvent.change(screen.getByLabelText("Kết thúc"), {
      target: { value: "2026-06-15T08:00" },
    });
    await user.click(screen.getByRole("button", { name: "Tạo hoạt động" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Thời gian kết thúc phải sau thời gian bắt đầu",
    );
    expect(callsTo(calls, "POST", "/api/orgs/o-1/activities")).toHaveLength(0);
  });

  it("pins a bad capacity to the field", async () => {
    const user = userEvent.setup();
    renderAuthed(<ActivityForm orgId="o-1" />);

    await user.type(screen.getByLabelText("Tên hoạt động"), "X");
    // userEvent.type is unreliable on number inputs — change events it is.
    fireEvent.change(screen.getByLabelText("Sức chứa"), {
      target: { value: "2.5" },
    });
    fireEvent.change(screen.getByLabelText("Giờ tình nguyện"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Điểm"), {
      target: { value: "1" },
    });
    fillDateTimes();
    // "2.5" violates the input's step=1, so a click is swallowed by HTML
    // constraint validation — submit the form directly to reach the
    // JS-level check that mirrors the server.
    const form = screen
      .getByRole("button", { name: "Tạo hoạt động" })
      .closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sức chứa phải là số nguyên từ 1 trở lên",
    );
  });
});

describe("ActivityForm — edit", () => {
  const EDITABLE = activity({
    description: "Mô tả cũ",
    capacity: null,
  });

  it("prefills fields and PATCHes with null for cleared optionals", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      "PATCH /api/activities/a-1": { body: { activity: EDITABLE } },
    });
    renderAuthed(<ActivityForm activity={EDITABLE} />);

    expect(screen.getByLabelText("Tên hoạt động")).toHaveValue(
      "Hiến máu tình nguyện",
    );
    expect((screen.getByLabelText("Sức chứa") as HTMLInputElement).value).toBe(
      "",
    );
    expect(screen.getByLabelText("Bắt đầu")).toHaveValue(
      isoToDatetimeLocal(EDITABLE.starts_at),
    );

    await user.clear(screen.getByLabelText("Mô tả"));
    await user.click(screen.getByRole("button", { name: "Lưu thay đổi" }));

    await waitFor(() =>
      expect(getMockRouter().push).toHaveBeenCalledWith("/activities/a-1"),
    );
    const body = callsTo(calls, "PATCH", "/api/activities/a-1")[0]
      .body as Record<string, unknown>;
    expect(body.description).toBeNull();
    expect(body.capacity).toBeNull();
    expect(body.location).toBe("Hội trường A");
    expect(body.title).toBe("Hiến máu tình nguyện");
  });

  it("surfaces capacity_below_registrations on the capacity field", async () => {
    const user = userEvent.setup();
    mockApi({
      "PATCH /api/activities/a-1": {
        status: 409,
        body: {
          code: "capacity_below_registrations",
          detail: "too small",
        },
      },
    });
    renderAuthed(<ActivityForm activity={activity({ capacity: 50 })} />);

    await user.clear(screen.getByLabelText("Sức chứa"));
    fireEvent.change(screen.getByLabelText("Sức chứa"), {
      target: { value: "2" },
    });
    await user.click(screen.getByRole("button", { name: "Lưu thay đổi" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sức chứa không thể nhỏ hơn số đăng ký hiện có",
    );
    expect(getMockRouter().push).not.toHaveBeenCalled();
  });
});

describe("NewActivityView / EditActivityView — gates", () => {
  it("locks members out of the create form", async () => {
    mockApi({ "GET /api/orgs/o-1": { body: orgDetail("member") } });
    renderAuthed(<NewActivityView orgId="o-1" />);

    expect(await screen.findByText("Cần quyền quản lý")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tạo hoạt động" }),
    ).not.toBeInTheDocument();
  });

  it("shows the form to managers", async () => {
    mockApi({ "GET /api/orgs/o-1": { body: orgDetail("manager") } });
    renderAuthed(<NewActivityView orgId="o-1" />);

    expect(
      await screen.findByRole("heading", { name: "Tạo hoạt động" }),
    ).toBeInTheDocument();
  });

  it("refuses to edit a terminal activity", async () => {
    mockApi({
      "GET /api/activities/a-1": {
        body: activityDetail({ activity: activity({ status: "completed" }) }),
      },
      "GET /api/orgs/o-1": { body: orgDetail("manager") },
    });
    renderAuthed(<EditActivityView activityId="a-1" />);

    expect(await screen.findByText("Không thể chỉnh sửa")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Lưu thay đổi" }),
    ).not.toBeInTheDocument();
  });
});
