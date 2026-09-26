/**
 * Integration tests for `/activities/[id]/manage` (ManageView +
 * LifecycleBar + QrPanel): the manager gate, lifecycle transitions behind
 * inline confirms, QR code ensure/rotate/revoke and the live counter.
 * `fetch` mocked.
 *
 * Layer: **integration**
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManageView } from "@/app/activities/[id]/manage/manage-view";
import type { ActivityDetailResponse, MemberRole } from "@/lib/types";
import { callsTo, mockApi } from "@/tests/helpers/api-mock";
import {
  activity,
  activityDetail,
  orgDetail,
  registration,
  regRow,
} from "@/tests/helpers/fixtures";
import { renderAuthed } from "@/tests/helpers/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockManage(
  detail: ActivityDetailResponse,
  role: MemberRole = "manager",
) {
  return mockApi({
    "GET /api/activities/a-1": { body: detail },
    "GET /api/orgs/o-1": { body: orgDetail(role) },
    "GET /api/activities/a-1/registrations": (call) => ({
      body: {
        registrations:
          call.query.get("status") === "approved"
            ? [
                regRow("approved", {
                  registration: registration({ id: "r-2", status: "approved" }),
                }),
              ]
            : [
                regRow("pending"),
                regRow("approved", {
                  registration: registration({ id: "r-2", status: "approved" }),
                }),
              ],
      },
    }),
    "POST /api/activities/a-1/publish": { body: { activity: activity() } },
    "POST /api/activities/a-1/cancel": {
      body: { activity: activity({ status: "cancelled" }) },
    },
    "POST /api/activities/a-1/complete": {
      body: {
        activity: activity({ status: "completed" }),
        records_created: 3,
      },
    },
    "POST /api/activities/a-1/checkin-code": {
      body: { code: "KM2P4R", rotated: false },
    },
    "DELETE /api/activities/a-1/checkin-code": { status: 204 },
  });
}

describe("ManageView — gate", () => {
  it("locks non-managers out", async () => {
    mockManage(activityDetail(), "member");
    renderAuthed(<ManageView activityId="a-1" />);

    expect(await screen.findByText("Cần quyền quản lý")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Về trang hoạt động" }),
    ).toHaveAttribute("href", "/activities/a-1");
  });
});

describe("ManageView — lifecycle", () => {
  it("draft publishes with one click", async () => {
    const user = userEvent.setup();
    const calls = mockManage(
      activityDetail({ activity: activity({ status: "draft" }) }),
    );
    renderAuthed(<ManageView activityId="a-1" />);

    await user.click(await screen.findByRole("button", { name: "Công bố" }));
    await waitFor(() =>
      expect(
        callsTo(calls, "POST", "/api/activities/a-1/publish"),
      ).toHaveLength(1),
    );
  });

  it("published completes after the inline confirm and shows records", async () => {
    const user = userEvent.setup();
    const calls = mockManage(activityDetail());
    renderAuthed(<ManageView activityId="a-1" />);

    await user.click(await screen.findByRole("button", { name: "Hoàn thành" }));
    await user.click(
      screen.getByRole("button", { name: "Xác nhận hoàn thành?" }),
    );

    await waitFor(() =>
      expect(
        callsTo(calls, "POST", "/api/activities/a-1/complete"),
      ).toHaveLength(1),
    );
    expect(
      await screen.findByText("Đã ghi nhận 3 thành tích"),
    ).toBeInTheDocument();
  });

  it("published cancels only after the confirm", async () => {
    const user = userEvent.setup();
    const calls = mockManage(activityDetail());
    renderAuthed(<ManageView activityId="a-1" />);

    await user.click(
      await screen.findByRole("button", { name: "Hủy hoạt động" }),
    );
    expect(callsTo(calls, "POST", "/api/activities/a-1/cancel")).toHaveLength(
      0,
    );
    await user.click(screen.getByRole("button", { name: "Xác nhận hủy?" }));
    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/activities/a-1/cancel")).toHaveLength(
        1,
      ),
    );
  });

  it("terminal activities get no lifecycle actions or edit link", async () => {
    mockManage(activityDetail({ activity: activity({ status: "completed" }) }));
    renderAuthed(<ManageView activityId="a-1" />);

    expect(
      await screen.findByRole("heading", { name: "Hiến máu tình nguyện" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Hoàn thành" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Chỉnh sửa" }),
    ).not.toBeInTheDocument();
  });
});

describe("ManageView — QR panel", () => {
  it("creates the code on explicit click (no auto-ensure)", async () => {
    const user = userEvent.setup();
    const calls = mockManage(activityDetail());
    renderAuthed(<ManageView activityId="a-1" />);

    // No POST on mount — the ensure endpoint is a write.
    await screen.findByRole("heading", { name: "Hiến máu tình nguyện" });
    expect(
      callsTo(calls, "POST", "/api/activities/a-1/checkin-code"),
    ).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Tạo mã điểm danh" }));
    await waitFor(() =>
      expect(
        callsTo(calls, "POST", "/api/activities/a-1/checkin-code")[0].body,
      ).toEqual({ rotate: false }),
    );
  });

  it("renders the QR code + code text when a code exists", async () => {
    mockManage(activityDetail({ checkin_code: "KM2P4R" }));
    const { container } = renderAuthed(<ManageView activityId="a-1" />);

    await screen.findByRole("heading", { name: "Hiến máu tình nguyện" });
    expect(screen.getByText("KM2P4R")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
    // Live counter: checked_in 2 of 1 approved registration — arrives
    // only after the approved-registrations query resolves.
    expect(await screen.findByText(/Đã điểm danh 2\/1/)).toBeInTheDocument();
  });

  it("rotates with {rotate:true} and revokes via confirm", async () => {
    const user = userEvent.setup();
    const calls = mockManage(activityDetail({ checkin_code: "KM2P4R" }));
    renderAuthed(<ManageView activityId="a-1" />);

    await user.click(await screen.findByRole("button", { name: "Đổi mã" }));
    await waitFor(() =>
      expect(
        callsTo(calls, "POST", "/api/activities/a-1/checkin-code")[0].body,
      ).toEqual({ rotate: true }),
    );

    await user.click(screen.getByRole("button", { name: "Tắt mã" }));
    await user.click(screen.getByRole("button", { name: "Xác nhận tắt mã?" }));
    await waitFor(() =>
      expect(
        callsTo(calls, "DELETE", "/api/activities/a-1/checkin-code"),
      ).toHaveLength(1),
    );
  });
});
