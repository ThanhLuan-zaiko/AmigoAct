/**
 * Integration tests for the dashboard — memberships, the upcoming
 * activities feed (`/api/me/feed`) and honest states, rendered through a
 * real `useQuery` against a routed mocked `fetch`. Authentication is driven
 * via `SignInProbe` (a real `signIn`).
 *
 * Layer: **integration**
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "@/app/dashboard/page";
import type { FeedItem, Membership } from "@/lib/types";
import { callsTo, mockApi } from "@/tests/helpers/api-mock";
import { FakeSocket } from "@/tests/helpers/fake-socket";
import { activity } from "@/tests/helpers/fixtures";
import { SignInProbe, TEST_AUTH, TestProviders } from "@/tests/helpers/render";

afterEach(() => {
  vi.unstubAllGlobals();
  FakeSocket.reset();
});

function renderDashboard() {
  return render(
    <TestProviders socketFactory={FakeSocket.factory}>
      <SignInProbe auth={TEST_AUTH} />
      <DashboardPage />
    </TestProviders>,
  );
}

const MANAGER_MEMBERSHIP: Membership = {
  member_id: "m-1",
  org_id: "o-1",
  full_name: "Nguyễn Lan",
  role: "manager",
  status: "active",
  student_code: "SV2024",
  class_name: "CNTT01",
  faculty: "Công nghệ thông tin",
  joined_at: "2026-02-01T00:00:00Z",
  org: { id: "o-1", code: "CLB-TN", name: "CLB Tình nguyện" },
};

const INACTIVE_ADMIN: Membership = {
  member_id: "m-2",
  org_id: "o-2",
  full_name: "Nguyễn Lan",
  role: "admin",
  status: "inactive",
  student_code: null,
  class_name: null,
  faculty: null,
  joined_at: "2025-11-20T00:00:00Z",
  org: { id: "o-2", code: "DOI-XH", name: "Đội Xung kích" },
};

function mockDashboard(memberships: Membership[], feedItems: FeedItem[] = []) {
  return mockApi({
    "GET /api/auth/me": {
      body: { user: TEST_AUTH.user, memberships },
    },
    "GET /api/me/feed": { body: { activities: feedItems } },
  });
}

const FEED_ITEM: FeedItem = {
  activity: activity(),
  org: { id: "o-1", code: "CLB-TN", name: "CLB Tình nguyện" },
  my_registration_status: "approved",
  registered: 7,
};

describe("DashboardPage", () => {
  it("greets the signed-in user and lists memberships", async () => {
    const calls = mockDashboard([MANAGER_MEMBERSHIP, INACTIVE_ADMIN]);
    renderDashboard();

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Xin chào, Nguyễn Lan!",
      }),
    ).toBeInTheDocument();

    // The memberships were fetched with the bearer token (the query and
    // the auth-provider bootstrap may both hit the endpoint).
    await waitFor(() =>
      expect(
        callsTo(calls, "GET", "/api/auth/me").length,
      ).toBeGreaterThanOrEqual(1),
    );
    const me = callsTo(calls, "GET", "/api/auth/me")[0];
    expect((me.init.headers as Headers).get("Authorization")).toBe(
      "Bearer test.jwt.token",
    );

    // Active membership: name, code, translated role, student meta.
    const activeCard = (
      await screen.findByRole("heading", { name: "CLB Tình nguyện" })
    ).closest("a");
    expect(activeCard).toHaveAttribute("href", "/orgs/o-1");
    expect(activeCard).toHaveTextContent("Ban chấp hành");
    expect(activeCard).toHaveTextContent("Mã SV: SV2024");
    expect(activeCard).toHaveTextContent("CNTT01");

    // Inactive membership shows the muted state and its translated role.
    const inactiveCard = screen
      .getByRole("heading", { name: "Đội Xung kích" })
      .closest("a");
    expect(inactiveCard).toHaveTextContent("Quản trị");
    expect(inactiveCard).toHaveTextContent("Ngừng hoạt động");
  });

  it("shows an honest empty state with real CTAs", async () => {
    mockDashboard([]);
    renderDashboard();

    expect(
      await screen.findByText("Bạn chưa thuộc tổ chức nào"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tạo tổ chức/ })).toHaveAttribute(
      "href",
      "/orgs/new",
    );
    expect(
      screen.getByRole("link", { name: /Tham gia bằng mã/ }),
    ).toHaveAttribute("href", "/orgs/join");
  });

  it("shows a Vietnamese error when the memberships fetch fails", async () => {
    mockApi({
      "GET /api/auth/me": {
        status: 500,
        body: { detail: "boom", code: "unexpected" },
      },
      "GET /api/me/feed": { body: { activities: [] } },
    });
    renderDashboard();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Có lỗi xảy ra, thử lại sau",
    );
  });
});

describe("DashboardPage — feed", () => {
  it("lists upcoming activities with org, status chip and link", async () => {
    mockDashboard([MANAGER_MEMBERSHIP], [FEED_ITEM]);
    renderDashboard();

    const card = (
      await screen.findByRole("heading", { name: "Hiến máu tình nguyện" })
    ).closest("a");
    expect(card).toHaveAttribute("href", "/activities/a-1");
    expect(card).toHaveTextContent("CLB Tình nguyện");
    expect(card).toHaveTextContent("Hội trường A");
    expect(card).toHaveTextContent("Đăng ký 7");
    // The member's own registration status chips on the card.
    expect(card).toHaveTextContent("Đã duyệt");
    expect(
      screen.getByRole("link", { name: "Đăng ký của tôi" }),
    ).toHaveAttribute("href", "/me/registrations");
  });

  it("omits the chip when the member has no registration", async () => {
    mockDashboard([], [{ ...FEED_ITEM, my_registration_status: null }]);
    renderDashboard();

    const card = (
      await screen.findByRole("heading", { name: "Hiến máu tình nguyện" })
    ).closest("a");
    expect(card).not.toBeNull();
    expect(card).not.toHaveTextContent("Đã duyệt");
  });

  it("shows the empty feed state", async () => {
    mockDashboard([], []);
    renderDashboard();

    expect(
      await screen.findByText("Chưa có hoạt động sắp tới"),
    ).toBeInTheDocument();
  });
});
