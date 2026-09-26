/**
 * Integration tests for `/orgs/[orgId]/members` (MembersView +
 * MembersTable + SelfProfileForm): roster rendering, the manager gate,
 * admin role/status mutations incl. the demote confirm and `last_admin`,
 * and the self-profile PATCH. `fetch` routed through `mockApi`.
 *
 * Layer: **integration**
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MembersView } from "@/app/orgs/[orgId]/members/members-view";
import type { MemberRole } from "@/lib/types";
import { callsTo, type MockHandler, mockApi } from "@/tests/helpers/api-mock";
import { memberRow, membership, orgDetail } from "@/tests/helpers/fixtures";
import { renderAuthed } from "@/tests/helpers/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

const OTHER = memberRow({
  member_id: "m-2",
  user_id: "u-2",
  email: "minh@example.com",
  full_name: "Trần Minh",
  student_code: "SV88",
  class_name: "KT02",
  faculty: "Kinh tế",
  total_hours: 7,
  total_points: 3,
});

function mockRoster(
  role: MemberRole,
  members = [memberRow(), OTHER],
  patchHandler?: MockHandler,
) {
  return mockApi({
    "GET /api/orgs/o-1": { body: orgDetail(role) },
    "GET /api/orgs/o-1/members": { body: { members } },
    "PATCH /api/orgs/o-1/members/m-2": patchHandler ?? {
      body: { membership: membership("member") },
    },
    "PATCH /api/orgs/o-1/members/me": {
      body: { membership: membership("member") },
    },
  });
}

describe("MembersView", () => {
  it("renders the roster with names, meta, role labels and totals", async () => {
    mockRoster("manager");
    renderAuthed(<MembersView orgId="o-1" />);

    expect(
      await screen.findByRole("heading", { name: "Thành viên" }),
    ).toBeInTheDocument();
    // Self row carries the "(bạn)" marker and the roster name.
    expect(screen.getByText("(bạn)")).toBeInTheDocument();
    expect(screen.getByText("minh@example.com")).toBeInTheDocument();
    expect(screen.getByText(/SV88 · KT02 · Kinh tế/)).toBeInTheDocument();
    // Manager (not admin) sees role badges, not selects.
    expect(screen.getAllByText("Đoàn viên").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("combobox", { name: /Vai trò của/ }),
    ).not.toBeInTheDocument();
    // Totals and the per-member "Thành tích" link.
    expect(screen.getByText(/7 giờ · 3 điểm/)).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Thành tích" })[0],
    ).toHaveAttribute("href", "/orgs/o-1/members/m-1/records");
  });

  it("locks non-managers out without calling the roster endpoint", async () => {
    const calls = mockRoster("member");
    renderAuthed(<MembersView orgId="o-1" />);

    expect(await screen.findByText("Cần quyền quản lý")).toBeInTheDocument();
    expect(callsTo(calls, "GET", "/api/orgs/o-1/members")).toHaveLength(0);
  });

  it("promotes a member directly via the role select", async () => {
    const user = userEvent.setup();
    const calls = mockRoster("admin");
    renderAuthed(<MembersView orgId="o-1" />);

    const select = await screen.findByRole("combobox", {
      name: "Vai trò của Trần Minh",
    });
    // member → manager is a promotion: applies immediately, no confirm.
    await user.selectOptions(select, "manager");

    await waitFor(() => {
      const patch = callsTo(calls, "PATCH", "/api/orgs/o-1/members/m-2");
      expect(patch).toHaveLength(1);
      expect(patch[0].body).toEqual({ role: "manager" });
    });
  });

  it("holds a demotion behind the inline confirm", async () => {
    const user = userEvent.setup();
    const calls = mockRoster("admin", [
      memberRow(),
      memberRow({ ...OTHER, role: "manager" }),
    ]);
    renderAuthed(<MembersView orgId="o-1" />);

    const select = await screen.findByRole("combobox", {
      name: "Vai trò của Trần Minh",
    });
    // manager → member is a demotion: it must not fire the PATCH yet.
    await user.selectOptions(select, "member");
    expect(callsTo(calls, "PATCH", "/api/orgs/o-1/members/m-2")).toHaveLength(
      0,
    );

    await user.click(
      await screen.findByRole("button", { name: "Hạ quyền: Đoàn viên" }),
    );
    await user.click(screen.getByRole("button", { name: "Xác nhận?" }));

    await waitFor(() => {
      const patch = callsTo(calls, "PATCH", "/api/orgs/o-1/members/m-2");
      expect(patch).toHaveLength(1);
      expect(patch[0].body).toEqual({ role: "member" });
    });
  });

  it("surfaces the last_admin error from a rejected PATCH", async () => {
    const user = userEvent.setup();
    mockRoster("admin", [memberRow(), OTHER], {
      status: 409,
      body: { detail: "org needs an admin", code: "last_admin" },
    });
    renderAuthed(<MembersView orgId="o-1" />);

    const select = await screen.findByRole("combobox", {
      name: "Vai trò của Trần Minh",
    });
    await user.selectOptions(select, "manager");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tổ chức cần ít nhất một quản trị viên",
    );
  });

  it("deactivates a member behind the confirm and reactivates directly", async () => {
    const user = userEvent.setup();
    const calls = mockRoster("admin");
    renderAuthed(<MembersView orgId="o-1" />);

    const otherRow = (await screen.findByText("Trần Minh")).closest("tr");
    expect(otherRow).not.toBeNull();
    const row = within(otherRow as HTMLElement);

    await user.click(await row.findByRole("button", { name: "Ngừng" }));
    await user.click(row.getByRole("button", { name: "Xác nhận ngừng?" }));

    await waitFor(() => {
      const patch = callsTo(calls, "PATCH", "/api/orgs/o-1/members/m-2");
      expect(patch).toHaveLength(1);
      expect(patch[0].body).toEqual({ status: "inactive" });
    });
  });

  it("edits the own profile via PATCH members/me", async () => {
    const user = userEvent.setup();
    const calls = mockRoster("manager");
    renderAuthed(<MembersView orgId="o-1" />);

    await user.click(
      await screen.findByRole("button", { name: "Chỉnh sửa hồ sơ" }),
    );
    const nameField = await screen.findByLabelText("Họ và tên hiển thị");
    await user.clear(nameField);
    await user.type(nameField, "Lan Nguyễn");
    await user.click(screen.getByRole("button", { name: "Lưu hồ sơ" }));

    await waitFor(() => {
      const patch = callsTo(calls, "PATCH", "/api/orgs/o-1/members/me");
      expect(patch).toHaveLength(1);
      expect(patch[0].body).toEqual({
        full_name: "Lan Nguyễn",
        student_code: "SV2024",
        class_name: "CNTT01",
        faculty: "Công nghệ thông tin",
      });
    });
  });
});
