/**
 * Integration tests for `/activities/[id]` (ActivityView): metadata,
 * status chip, manager link gating and the registration states that are
 * not the check-in flow (register, pending-cancel, rejected, cancelled).
 * `fetch` mocked.
 *
 * Layer: **integration**
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityView } from "@/app/activities/[id]/activity-view";
import { callsTo, type MockCall, mockApi } from "@/tests/helpers/api-mock";
import {
  activity,
  activityDetail,
  orgDetail,
  registration,
} from "@/tests/helpers/fixtures";
import { renderAuthed } from "@/tests/helpers/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockActivity(
  overrides: Parameters<typeof activityDetail>[0] = {},
  role: "member" | "manager" = "member",
): MockCall[] {
  return mockApi({
    "GET /api/activities/a-1": { body: activityDetail(overrides) },
    "GET /api/orgs/o-1": { body: orgDetail(role) },
    "POST /api/activities/a-1/register": {
      body: { registration: registration() },
    },
    "POST /api/registrations/r-1/cancel": {
      body: { registration: registration({ status: "cancelled" }) },
    },
  });
}

async function renderActivity(
  overrides: Parameters<typeof activityDetail>[0] = {},
  role: "member" | "manager" = "member",
) {
  const calls = mockActivity(overrides, role);
  renderAuthed(<ActivityView activityId="a-1" />);
  await screen.findByRole("heading", { name: "Hiến máu tình nguyện" });
  return calls;
}

describe("ActivityView — detail", () => {
  it("renders title, status chip, schedule, capacity and counts", async () => {
    await renderActivity();

    expect(screen.getByText("Đã công bố")).toBeInTheDocument();
    expect(screen.getByText("Hội trường A")).toBeInTheDocument();
    expect(screen.getByText(/50 người/)).toBeInTheDocument();
    expect(screen.getByText(/Đăng ký 5/)).toBeInTheDocument();
    expect(screen.getByText(/Điểm danh 2/)).toBeInTheDocument();
    expect(screen.getByText(/4 giờ/)).toBeInTheDocument();
    expect(screen.getByText(/2,5 điểm/)).toBeInTheDocument();
    // Check-in window opens 60 min before starts_at.
    expect(screen.getByText(/^từ /)).toBeInTheDocument();
  });

  it("maps activity errors into Vietnamese", async () => {
    mockApi({
      "GET /api/activities/a-1": {
        status: 404,
        body: { code: "activity_not_found", detail: "nope" },
      },
    });
    renderAuthed(<ActivityView activityId="a-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không tìm thấy hoạt động",
    );
  });

  it("shows Quản lý only to managers", async () => {
    await renderActivity({}, "manager");
    // The link waits on the second (org) query — find it, don't get it.
    expect(
      await screen.findByRole("link", { name: "Quản lý →" }),
    ).toHaveAttribute("href", "/activities/a-1/manage");
  });

  it("hides Quản lý from members", async () => {
    await renderActivity();
    expect(
      screen.queryByRole("link", { name: "Quản lý →" }),
    ).not.toBeInTheDocument();
  });
});

describe("ActivityView — registration states", () => {
  it("offers Đăng ký with an optional note when not registered", async () => {
    const user = userEvent.setup();
    const calls = await renderActivity();

    await user.type(screen.getByLabelText("Ghi chú đăng ký"), "Tôi sẽ đến sớm");
    await user.click(screen.getByRole("button", { name: "Đăng ký" }));

    await waitFor(() =>
      expect(
        callsTo(calls, "POST", "/api/activities/a-1/register"),
      ).toHaveLength(1),
    );
    expect(
      callsTo(calls, "POST", "/api/activities/a-1/register")[0].body,
    ).toEqual({ note: "Tôi sẽ đến sớm" });
  });

  it("sends an empty body when the note is blank", async () => {
    const user = userEvent.setup();
    const calls = await renderActivity();

    await user.click(screen.getByRole("button", { name: "Đăng ký" }));
    await waitFor(() =>
      expect(
        callsTo(calls, "POST", "/api/activities/a-1/register")[0].body,
      ).toEqual({}),
    );
  });

  it("pending → Chờ duyệt chip and a confirmed cancel", async () => {
    const user = userEvent.setup();
    const calls = await renderActivity({
      my_registration: registration({ status: "pending" }),
    });

    expect(screen.getByText("Chờ duyệt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hủy đăng ký" }));
    await user.click(screen.getByRole("button", { name: "Xác nhận?" }));

    await waitFor(() =>
      expect(
        callsTo(calls, "POST", "/api/registrations/r-1/cancel"),
      ).toHaveLength(1),
    );
  });

  it("rejected → terminal notice", async () => {
    await renderActivity({
      my_registration: registration({ status: "rejected" }),
    });
    expect(
      screen.getByText("Đăng ký của bạn đã bị từ chối."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Đăng ký" }),
    ).not.toBeInTheDocument();
  });

  it("cancelled on a published activity → Đăng ký lại", async () => {
    await renderActivity({
      my_registration: registration({ status: "cancelled" }),
    });
    expect(
      screen.getByRole("button", { name: "Đăng ký lại" }),
    ).toBeInTheDocument();
  });

  it("cancelled on a cancelled activity → no re-register CTA", async () => {
    await renderActivity({
      activity: activity({ status: "cancelled" }),
      my_registration: registration({ status: "cancelled" }),
    });
    expect(
      screen.queryByRole("button", { name: "Đăng ký lại" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Đã hủy").length).toBeGreaterThan(0);
  });
});
