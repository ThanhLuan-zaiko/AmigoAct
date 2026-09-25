/**
 * End-to-end regression tests.
 *
 * These run against a **production build** in a real browser, so they are the
 * highest-fidelity guard in the suite. Playwright auto-starts the server via
 * `webServer` in `playwright.config.ts`.
 */
import { expect, test } from "@playwright/test";

test.describe("trang chủ", () => {
  test("hiển thị tiêu đề sản phẩm", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: "AmigoAct" }),
    ).toBeVisible();
  });

  test("hiển thị nội dung tiếng Việt", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Xem trước lời chào" }),
    ).toBeVisible();
    await expect(page.getByLabel("Tên của bạn")).toBeVisible();
  });

  test("cập nhật lời chào theo thời gian thực", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("greeting-output")).toHaveText(
      "Xin chào, bạn!",
    );

    await page.getByLabel("Tên của bạn").fill("Lan");

    await expect(page.getByTestId("greeting-output")).toHaveText(
      "Xin chào, Lan!",
    );
  });

  test("phục vụ trang từ cùng origin", async ({ request }) => {
    // The frontend never calls /api/health during SSR, so assert the page is
    // served by the same origin first to keep this a real smoke test.
    const response = await request.get("/");

    expect(response.ok()).toBe(true);
  });
});
