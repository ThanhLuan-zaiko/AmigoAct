/**
 * End-to-end regression tests.
 *
 * These run against a **production build** in a real browser, so they are the
 * highest-fidelity guard in the suite. Playwright auto-starts the server via
 * `webServer` in `playwright.config.ts`. The API is mocked at the network
 * layer with `page.route` — no backend is required.
 */
import { expect, test } from "@playwright/test";

const isDark = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.classList.contains("dark"));

test.describe("trang chủ", () => {
  test("hiển thị hero, tính năng và CTA", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: "AmigoAct" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Quản lý đăng ký và ghi nhận thành tích tình nguyện cho Đoàn – Hội.",
      ),
    ).toBeVisible();

    for (const title of [
      "Đăng ký sự kiện",
      "Điểm danh QR",
      "Chứng nhận & giờ tình nguyện",
    ]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }

    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "Đăng nhập" })).toHaveAttribute(
      "href",
      "/login",
    );
    await expect(
      main.getByRole("link", { name: "Tạo tài khoản" }),
    ).toHaveAttribute("href", "/register");
  });

  test("theo theme hệ điều hành và giữ lựa chọn thủ công sau reload", async ({
    page,
  }) => {
    // OS prefers dark → the pre-paint script applies the dark class.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    expect(await isDark(page)).toBe(true);

    // Manual toggle overrides the OS choice.
    await page
      .getByRole("button", { name: "Chuyển sang giao diện sáng" })
      .click();
    expect(await isDark(page)).toBe(false);

    // The manual choice persists across reloads even while OS stays dark.
    await page.reload();
    expect(await isDark(page)).toBe(false);
  });

  test("theme sáng của hệ điều hành không gắn class dark", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");

    expect(await isDark(page)).toBe(false);
    await page
      .getByRole("button", { name: "Chuyển sang giao diện tối" })
      .click();
    expect(await isDark(page)).toBe(true);
  });
});

test.describe("đăng nhập", () => {
  test("render form và hiển thị lỗi tiếng Việt khi sai thông tin", async ({
    page,
  }) => {
    // The API origin differs from the page origin, so the fulfilled response
    // must carry a CORS header for the browser to accept it.
    await page.route("**/api/auth/login", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          detail: "Invalid credentials",
          code: "invalid_credentials",
        }),
      });
    });

    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Đăng nhập" }),
    ).toBeVisible();

    await page.getByLabel("Email").fill("lan@example.com");
    await page.getByLabel("Mật khẩu").fill("sai-mat-khau");
    await page.getByRole("button", { name: "Đăng nhập" }).click();

    // Scoped to <p> — Next's route announcer is also role="alert".
    await expect(page.locator("p[role='alert']")).toHaveText(
      "Email hoặc mật khẩu không đúng",
    );
  });

  test("đi tới đăng ký từ liên kết dưới form", async ({ page }) => {
    await page.goto("/login");

    await page
      .getByRole("main")
      .getByRole("link", { name: "Tạo tài khoản" })
      .click();

    await expect(page).toHaveURL(/\/register$/);
    await expect(
      page.getByRole("heading", { name: "Tạo tài khoản" }),
    ).toBeVisible();
  });
});

test.describe("trang bảo vệ", () => {
  test("/dashboard chuyển hướng về /login khi chưa đăng nhập", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await expect(
      page.getByRole("heading", { name: "Đăng nhập" }),
    ).toBeVisible();
  });
});
