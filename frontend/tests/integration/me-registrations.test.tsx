/**
 * Integration tests for `/me/registrations` (MyRegistrationsView):
 * grouping by status, org + activity links, the confirmed cancel and
 * honest empty/error states. `fetch` mocked.
 *
 * Layer: **integration**
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MyRegistrationsView } from "@/app/me/registrations/my-registrations-view";
import type { MyRegistrationItem } from "@/lib/types";
import { callsTo, mockApi } from "@/tests/helpers/api-mock";
import { activity, myRegItem, registration } from "@/tests/helpers/fixtures";
import { renderAuthed } from "@/tests/helpers/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockRegs(items: MyRegistrationItem[]) {
  return mockApi({
    "GET /api/me/registrations": { body: { registrations: items } },
    "POST /api/registrations/r-1/cancel": {
      body: { registration: registration({ status: "cancelled" }) },
    },
  });
}

describe("MyRegistrationsView", () => {
  it("groups registrations by status with headings", async () => {
    mockRegs([
      myRegItem("approved"),
      myRegItem("pending", {
        registration: registration({ id: "r-2", status: "pending" }),
        activity: {
          ...activity({ id: "a-2", title: "Dọn vệ sinh biển" }),
          id: "a-2",
          title: "Dọn vệ sinh biển",
        },
      }),
    ]);
    renderAuthed(<MyRegistrationsView />);

    expect(await screen.findByText("Đã duyệt (1)")).toBeInTheDocument();
    expect(screen.getByText("Chờ duyệt (1)")).toBeInTheDocument();
    // Group ordering: approved before pending.
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings[0]).toHaveTextContent("Đã duyệt");
    expect(headings[1]).toHaveTextContent("Chờ duyệt");

    const link = screen.getByRole("link", {
      name: "Hiến máu tình nguyện",
    });
    expect(link).toHaveAttribute("href", "/activities/a-1");
    expect(screen.getAllByText(/CLB Tình nguyện/)[0]).toBeInTheDocument();
  });

  it("cancels a pending registration after the inline confirm", async () => {
    const user = userEvent.setup();
    const calls = mockRegs([
      myRegItem("pending", {
        registration: registration({ id: "r-1", status: "pending" }),
      }),
    ]);
    renderAuthed(<MyRegistrationsView />);

    await user.click(
      await screen.findByRole("button", { name: "Hủy đăng ký" }),
    );
    await user.click(screen.getByRole("button", { name: "Xác nhận?" }));

    await waitFor(() =>
      expect(
        callsTo(calls, "POST", "/api/registrations/r-1/cancel"),
      ).toHaveLength(1),
    );
  });

  it("hides cancel for checked-in or terminal registrations", async () => {
    mockRegs([
      myRegItem("approved", {
        registration: registration({
          status: "approved",
          checked_in_at: "2026-06-15T08:10:00Z",
        }),
      }),
      myRegItem("rejected", {
        registration: registration({ id: "r-9", status: "rejected" }),
        activity: {
          ...activity({ id: "a-9", title: "Khác" }),
          id: "a-9",
          title: "Khác",
        },
      }),
    ]);
    renderAuthed(<MyRegistrationsView />);

    await screen.findByText("Đã duyệt (1)");
    expect(
      screen.queryByRole("button", { name: "Hủy đăng ký" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Đã điểm danh/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no registrations", async () => {
    mockRegs([]);
    renderAuthed(<MyRegistrationsView />);

    expect(
      await screen.findByText("Bạn chưa đăng ký hoạt động nào"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Về bảng tin" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("renders the error banner on failure", async () => {
    mockApi({
      "GET /api/me/registrations": {
        status: 500,
        body: { code: "unexpected", detail: "boom" },
      },
    });
    renderAuthed(<MyRegistrationsView />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Có lỗi xảy ra, thử lại sau",
    );
  });
});
