/**
 * Integration tests for the landing page — hero, feature cards, CTAs and the
 * speculation-rules payload for the auth routes.
 *
 * Layer: **integration**
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("Trang chủ", () => {
  it("hiển thị tiêu đề và khẩu hiệu sản phẩm", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: "AmigoAct" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Quản lý đăng ký và ghi nhận thành tích tình nguyện cho Đoàn – Hội.",
      ),
    ).toBeInTheDocument();
  });

  it("hiển thị ba thẻ tính năng", () => {
    render(<Home />);

    for (const title of [
      "Đăng ký sự kiện",
      "Điểm danh QR",
      "Chứng nhận & giờ tình nguyện",
    ]) {
      expect(
        screen.getByRole("heading", { level: 2, name: title }),
      ).toBeInTheDocument();
    }
  });

  it("có CTA tới trang đăng nhập và đăng ký", () => {
    render(<Home />);

    expect(screen.getByRole("link", { name: "Đăng nhập" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "Tạo tài khoản" })).toHaveAttribute(
      "href",
      "/register",
    );
  });

  it("yêu cầu trình duyệt prefetch các trang auth", () => {
    const { container } = render(<Home />);

    const script = container.querySelector('script[type="speculationrules"]');
    expect(script).not.toBeNull();
    const rules = JSON.parse(script?.innerHTML ?? "null");
    expect(rules.prefetch[0].urls).toEqual(["/login", "/register"]);
  });
});
