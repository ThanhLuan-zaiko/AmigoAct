/**
 * Integration tests for `/orgs/[orgId]` (OrgView): stats, role-gated
 * manager links, status filters that refetch with `?status=`, activity
 * cards and honest empty/error states. `fetch` mocked.
 *
 * Layer: **integration**
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrgView } from "@/app/orgs/[orgId]/org-view";
import { callsTo, mockApi } from "@/tests/helpers/api-mock";
import { activity, orgDetail } from "@/tests/helpers/fixtures";
import { renderAuthed } from "@/tests/helpers/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockOrg(
  role: "member" | "manager" | "admin" = "member",
  activities: ReturnType<typeof activity>[] = [],
) {
  return mockApi({
    "GET /api/orgs/o-1": { body: orgDetail(role) },
    "GET /api/orgs/o-1/activities": {
      body: {
        activities: activities.map((a) => ({
          activity: a,
          registered: 7,
          checked_in: 3,
        })),
      },
    },
  });
}

describe("OrgView — member", () => {
  it("renders identity, stats, role chip and activities", async () => {
    mockOrg("member", [activity()]);
    renderAuthed(<OrgView orgId="o-1" />);

    expect(
      await screen.findByRole("heading", { name: "CLB Tình nguyện" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Đoàn viên")).toBeInTheDocument();
    expect(screen.getByText("Mã tham gia: CLB-TN")).toBeInTheDocument();

    // Stats: members / activities / upcoming from the contract stats block.
    expect(screen.getByText("Thành viên")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Sắp diễn ra")).toBeInTheDocument();

    expect(
      await screen.findByRole("link", { name: /Hiến máu tình nguyện/ }),
    ).toHaveAttribute("href", "/activities/a-1");
    expect(screen.getByText(/Đăng ký 7\/50/)).toBeInTheDocument();

    // Members see no manager nav and no draft filter.
    expect(
      screen.queryByRole("link", { name: /Tạo hoạt động/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Bản nháp" }),
    ).not.toBeInTheDocument();
  });

  it("refetches with ?status= when a filter tab is clicked", async () => {
    const calls = mockOrg("member", [activity()]);
    const user = userEvent.setup();
    renderAuthed(<OrgView orgId="o-1" />);

    await screen.findByRole("link", { name: /Hiến máu tình nguyện/ });
    await user.click(screen.getByRole("button", { name: "Đã hủy" }));

    await waitFor(() =>
      expect(
        callsTo(calls, "GET", "/api/orgs/o-1/activities").some(
          (call) => call.query.get("status") === "cancelled",
        ),
      ).toBe(true),
    );
  });

  it("shows the member empty state with no CTA", async () => {
    mockOrg("member", []);
    renderAuthed(<OrgView orgId="o-1" />);

    expect(
      await screen.findByText("Chưa có hoạt động nào"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Chưa có hoạt động nào được công bố."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Tạo hoạt động" }),
    ).not.toBeInTheDocument();
  });
});

describe("OrgView — manager", () => {
  it("shows manager links and the draft filter", async () => {
    mockOrg("manager", []);
    renderAuthed(<OrgView orgId="o-1" />);

    expect(
      await screen.findByRole("link", { name: /Tạo hoạt động/ }),
    ).toHaveAttribute("href", "/orgs/o-1/activities/new");
    expect(screen.getByRole("link", { name: "Thành viên" })).toHaveAttribute(
      "href",
      "/orgs/o-1/members",
    );
    expect(screen.getByRole("link", { name: "Báo cáo" })).toHaveAttribute(
      "href",
      "/orgs/o-1/reports",
    );
    expect(
      screen.getByRole("button", { name: "Bản nháp" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ban chấp hành")).toBeInTheDocument();
    // Manager empty state carries the create CTA.
    expect(
      await screen.findByRole("link", { name: "Tạo hoạt động" }),
    ).toBeInTheDocument();
  });
});

describe("OrgView — errors", () => {
  it("renders the org_not_found banner", async () => {
    mockApi({
      "GET /api/orgs/o-1": {
        status: 404,
        body: { code: "org_not_found", detail: "nope" },
      },
    });
    renderAuthed(<OrgView orgId="o-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không tìm thấy tổ chức với mã này",
    );
  });
});
