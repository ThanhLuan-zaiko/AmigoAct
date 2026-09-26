/**
 * Phase 6 end-to-end coverage — the volunteer-hours page with its PDF
 * certificate download, the org roster, and the manager report dashboard.
 *
 * The API is mocked at the network layer with `page.route`; every
 * fulfillment carries `Access-Control-Allow-Origin: *` because the API
 * origin differs from the page origin. No real backend required.
 */
import { expect, type Page, test } from "@playwright/test";

const USER = {
  id: "u-1",
  email: "lan@example.com",
  full_name: "Nguyễn Lan",
  phone: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
};

const ORG_DETAIL = {
  org: {
    id: "o-1",
    code: "CLB-TN",
    name: "CLB Tình nguyện",
    description: null,
    contact_email: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  membership: {
    member_id: "m-1",
    full_name: "Nguyễn Lan",
    role: "manager",
    status: "active",
    student_code: "SV2024",
    class_name: "CNTT01",
    faculty: null,
    joined_at: "2026-02-01T00:00:00Z",
  },
  stats: { member_count: 12, activity_count: 3, upcoming_count: 1 },
};

const MY_RECORDS = {
  totals: { hours: 8.5, points: 4 },
  by_org: [
    {
      org: { id: "o-1", code: "CLB-TN", name: "CLB Tình nguyện" },
      hours: 8.5,
      points: 4,
    },
  ],
  records: [
    {
      record: {
        id: "rec-1",
        member_id: "m-1",
        activity_id: "a-1",
        registration_id: "r-1",
        title: "Hiến máu tình nguyện",
        hours: 8.5,
        points: 4,
        awarded_on: "2026-06-16",
        note: null,
        evidence_url: null,
        recorded_by: "m-2",
        created_at: "2026-06-16T10:00:00Z",
      },
      activity: {
        id: "a-1",
        title: "Hiến máu tình nguyện",
        starts_at: "2026-06-15T08:00:00.000Z",
        ends_at: "2026-06-15T17:00:00.000Z",
        status: "completed",
      },
      org: { id: "o-1", code: "CLB-TN", name: "CLB Tình nguyện" },
    },
  ],
};

const OVERVIEW = {
  totals: {
    activities: 6,
    published: 2,
    completed: 3,
    cancelled: 1,
    registrations: 40,
    approved: 30,
    checked_in: 24,
    checkin_rate: 0.8,
    total_hours: 120,
    total_points: 48,
  },
  monthly: [{ month: "2026-06", activities: 4, registrations: 28, hours: 90 }],
  by_faculty: [
    {
      faculty: "Công nghệ thông tin",
      members: 10,
      hours: 80,
      points: 30,
    },
  ],
  top_volunteers: [
    {
      member_id: "m-1",
      full_name: "Nguyễn Lan",
      student_code: "SV2024",
      faculty: "Công nghệ thông tin",
      hours: 20,
      points: 9,
      record_count: 5,
    },
  ],
};

const MEMBERS = {
  members: [
    {
      member_id: "m-1",
      user_id: "u-1",
      email: "lan@example.com",
      full_name: "Nguyễn Lan",
      role: "manager",
      status: "active",
      student_code: "SV2024",
      class_name: "CNTT01",
      faculty: "Công nghệ thông tin",
      joined_at: "2026-02-01T00:00:00Z",
      total_hours: 8.5,
      total_points: 4,
    },
  ],
};

async function fulfill(
  page: Page,
  pattern: string,
  body: unknown,
  status = 200,
) {
  await page.route(pattern, async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(body),
    });
  });
}

/** Seed the auth token and the account bootstrap every page needs. */
async function signIn(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("amigoact-token", "e2e-token");
  });
  await fulfill(page, "**/api/auth/me", {
    user: USER,
    memberships: [],
  });
}

test.describe("thành tích và báo cáo", () => {
  test("trang giờ tình nguyện hiển thị tổng và bảng thành tích", async ({
    page,
  }) => {
    await signIn(page);
    await fulfill(page, "**/api/me/records", MY_RECORDS);

    await page.goto("/me/hours");

    await expect(
      page.getByRole("heading", { name: "Giờ tình nguyện" }),
    ).toBeVisible();
    await expect(page.getByText("Tổng giờ tình nguyện")).toBeVisible();
    await expect(page.getByText("8,5").first()).toBeVisible();
    await expect(page.getByText("Số thành tích")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Hiến máu tình nguyện" }),
    ).toHaveAttribute("href", "/activities/a-1");
    await expect(
      page.getByRole("button", { name: "Tải chứng nhận" }),
    ).toBeVisible();
  });

  test("nút chứng nhận tải file PDF về máy", async ({ page }) => {
    await signIn(page);
    await fulfill(page, "**/api/me/records", MY_RECORDS);
    await page.route("**/api/records/rec-1/certificate", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Disposition": 'attachment; filename="chung-nhan-rec-1.pdf"',
        },
        body: Buffer.from("%PDF-1.4\n% e2e fake certificate\n"),
      });
    });

    await page.goto("/me/hours");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Tải chứng nhận" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("chung-nhan-rec-1.pdf");
  });

  test("trang báo cáo hiển thị các thẻ tổng quan", async ({ page }) => {
    await signIn(page);
    await fulfill(page, "**/api/orgs/o-1", ORG_DETAIL);
    await fulfill(page, "**/api/orgs/o-1/reports/overview*", OVERVIEW);
    await fulfill(page, "**/api/orgs/o-1/reports/activities*", {
      activities: [],
    });

    await page.goto("/orgs/o-1/reports");

    await expect(page.getByRole("heading", { name: "Báo cáo" })).toBeVisible();
    await expect(page.getByText("Tỷ lệ điểm danh")).toBeVisible();
    await expect(page.getByText("80%")).toBeVisible();
    await expect(page.getByText("120")).toBeVisible();
    await expect(page.getByText("06/2026")).toBeVisible();
    await expect(page.getByText("Cần quyền quản lý")).not.toBeVisible();
  });

  test("đổi khoảng ngày gọi lại API với tham số from/to", async ({ page }) => {
    await signIn(page);
    await fulfill(page, "**/api/orgs/o-1", ORG_DETAIL);
    await fulfill(page, "**/api/orgs/o-1/reports/overview*", OVERVIEW);
    await fulfill(page, "**/api/orgs/o-1/reports/activities*", {
      activities: [],
    });

    await page.goto("/orgs/o-1/reports");
    await expect(page.getByRole("heading", { name: "Báo cáo" })).toBeVisible();

    const ranged = page.waitForRequest(
      (request) =>
        request.url().includes("/api/orgs/o-1/reports/overview") &&
        request.url().includes("from=2026-01-01") &&
        request.url().includes("to=2026-06-30"),
    );
    await page.getByLabel("Từ ngày").fill("2026-01-01");
    await page.getByLabel("Đến ngày").fill("2026-06-30");
    await ranged;
    // The URL carries the shareable range too.
    await expect(page).toHaveURL(/from=2026-01-01&to=2026-06-30/);
  });

  test("trang thành viên hiển thị danh sách", async ({ page }) => {
    await signIn(page);
    await fulfill(page, "**/api/orgs/o-1", ORG_DETAIL);
    await fulfill(page, "**/api/orgs/o-1/members", MEMBERS);

    await page.goto("/orgs/o-1/members");

    await expect(
      page.getByRole("heading", { name: "Thành viên" }),
    ).toBeVisible();
    await expect(page.getByText("lan@example.com")).toBeVisible();
    await expect(page.getByText("Ban chấp hành")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Thành tích" }),
    ).toHaveAttribute("href", "/orgs/o-1/members/m-1/records");
  });
});
