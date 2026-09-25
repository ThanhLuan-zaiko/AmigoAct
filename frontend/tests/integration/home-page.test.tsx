/**
 * Integration tests for the App Router pages.
 *
 * Layer: **integration**
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("Trang chủ", () => {
  it("hiển thị tiêu đề sản phẩm", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: "AmigoAct" }),
    ).toBeInTheDocument();
  });

  it("hiển thị mô tả bằng tiếng Việt", () => {
    render(<Home />);

    expect(
      screen.getByText("Xây dựng thói quen cùng nhau, từng hoạt động một."),
    ).toBeInTheDocument();
  });

  it("nhúng thẻ chào để trang tương tác được", () => {
    render(<Home />);

    expect(screen.getByLabelText("Tên của bạn")).toBeInTheDocument();
  });
});
