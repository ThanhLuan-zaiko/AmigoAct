/**
 * Phase 5 end-to-end flows — login → dashboard feed, the org page, the
 * member register flow and the manager console with its QR code.
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

const MANAGER_MEMBERSHIP = {
  member_id: "m-1",
  org_id: "o-1",
  full_name: "Nguyễn Lan",
  role: "manager",
  status: "active",
  student_code: "SV2024",
  class_name: "CNTT01",
  faculty: null,
  joined_at: "2026-02-01T00:00:00Z",
  org: { id: "o-1", code: "CLB-TN", name: "CLB Tình nguyện" },
};

const ORG = {
  id: "o-1",
  code: "CLB-TN",
  name: "CLB Tình nguyện",
  description: "Câu lạc bộ tình nguyện sinh viên",
  contact_email: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
};

const ORG_DETAIL = {
  org: ORG,
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

const ACTIVITY = {
  id: "a-1",
  org_id: "o-1",
  title: "Hiến máu tình nguyện",
  description: "Đợt hiến máu đầu hè",
  location: "Hội trường A",
  status: "published",
  capacity: 50,
  points: 2.5,
  hours: 4,
  registration_opens_at: null,
  registration_closes_at: null,
  starts_at: "2026-06-15T08:00:00.000Z",
  ends_at: "2026-06-15T17:00:00.000Z",
  created_at: "2026-05-01T00:00:00Z",
};

const ACTIVITY_DETAIL = {
  activity: ACTIVITY,
  registered: 5,
  checked_in: 2,
  my_registration: null,
  checkin_code: "KM2P4R",
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

/** Mock every read the app needs when a token is already in storage. */
async function stubAuthedApi(page: Page) {
  await fulfill(page, "**/api/auth/me", {
    user: USER,
    memberships: [MANAGER_MEMBERSHIP],
  });
  await fulfill(page, "**/api/me/feed", {
    activities: [
      {
        activity: ACTIVITY,
        org: { id: "o-1", code: "CLB-TN", name: "CLB Tình nguyện" },
        my_registration_status: "approved",
        registered: 7,
      },
    ],
  });
  await fulfill(page, "**/api/me/registrations", { registrations: [] });
  await fulfill(page, "**/api/orgs/o-1/activities*", {
    activities: [{ activity: ACTIVITY, registered: 5, checked_in: 2 }],
  });
  await fulfill(page, "**/api/orgs/o-1", ORG_DETAIL);
  await fulfill(page, "**/api/activities/a-1/registrations*", {
    registrations: [],
  });
  await fulfill(page, "**/api/activities/a-1", ACTIVITY_DETAIL);
}

/** Seed the auth token so protected pages see a signed-in session. */
async function signIn(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("amigoact-token", "e2e-token");
  });
}

test.describe("luồng chính", () => {
  test("đăng nhập bằng form thật rồi thấy dashboard với feed", async ({
    page,
  }) => {
    await stubAuthedApi(page);
    await fulfill(page, "**/api/auth/login", {
      access_token: "e2e-token",
      token_type: "bearer",
      user: USER,
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill("lan@example.com");
    await page.getByLabel("Mật khẩu").fill("mật-khẩu-123");
    await page.getByRole("button", { name: "Đăng nhập" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Xin chào, Nguyễn Lan!" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Hiến máu tình nguyện/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Đăng ký của tôi" }),
    ).toHaveAttribute("href", "/me/registrations");
  });

  test("trang tổ chức hiển thị thống kê, hoạt động và link quản lý", async ({
    page,
  }) => {
    await stubAuthedApi(page);
    await signIn(page);
    await page.goto("/orgs/o-1");

    await expect(
      page.getByRole("heading", { name: "CLB Tình nguyện" }),
    ).toBeVisible();
    await expect(page.getByText("Ban chấp hành")).toBeVisible();
    await expect(page.getByText("12")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Tạo hoạt động/ }),
    ).toHaveAttribute("href", "/orgs/o-1/activities/new");
    await expect(
      page.getByRole("link", { name: /Hiến máu tình nguyện/ }),
    ).toHaveAttribute("href", "/activities/a-1");
  });

  test("thành viên đăng ký hoạt động từ trang chi tiết", async ({ page }) => {
    await stubAuthedApi(page);
    // The register POST is the request under test.
    await fulfill(
      page,
      "**/api/activities/a-1/register",
      {
        registration: {
          id: "r-1",
          activity_id: "a-1",
          member_id: "m-1",
          status: "pending",
          note: null,
          checked_in_at: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: "2026-06-01T00:00:00Z",
        },
      },
      201,
    );
    await signIn(page);
    await page.goto("/activities/a-1");

    const registerCall = page.waitForRequest((request) =>
      request.url().includes("/api/activities/a-1/register"),
    );
    await page.getByRole("button", { name: "Đăng ký" }).click();
    const request = await registerCall;
    expect(request.method()).toBe("POST");
  });

  test("trang quản lý hiển thị QR và mã điểm danh", async ({ page }) => {
    await stubAuthedApi(page);
    await signIn(page);
    await page.goto("/activities/a-1/manage");

    await expect(
      page.getByRole("heading", { name: "Hiến máu tình nguyện" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Mã điểm danh" }),
    ).toBeVisible();
    await expect(page.getByText("KM2P4R")).toBeVisible();
    await expect(page.locator("svg").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Hoàn thành" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Hủy hoạt động" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Đăng ký" })).toBeVisible();
  });
});
