/**
 * Integration tests for the shared building blocks: StatusChip, ErrorBanner,
 * EmptyState, ConfirmAction and Field — including the two-click
 * `window.confirm`-free confirmation flow.
 *
 * Layer: **integration**
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FaRegCircle } from "react-icons/fa";
import { describe, expect, it, vi } from "vitest";

import { ConfirmAction } from "@/components/confirm-action";
import { EmptyState } from "@/components/empty-state";
import { ErrorBanner } from "@/components/error-banner";
import { InputField } from "@/components/field";
import { StatusChip } from "@/components/status-chip";
import { ApiError } from "@/lib/api";
import { GENERIC_ERROR_MESSAGE } from "@/lib/errors";

describe("StatusChip", () => {
  it("renders the Vietnamese label for every status", () => {
    const { rerender } = render(<StatusChip status="published" />);
    expect(screen.getByText("Đã công bố")).toBeInTheDocument();
    rerender(<StatusChip status="pending" />);
    expect(screen.getByText("Chờ duyệt")).toBeInTheDocument();
    rerender(<StatusChip status="completed" />);
    expect(screen.getByText("Đã hoàn thành")).toBeInTheDocument();
  });

  it("paints statuses with their own colour pairs", () => {
    const a = render(<StatusChip status="published" />).container
      .firstElementChild;
    const b = render(<StatusChip status="cancelled" />).container
      .firstElementChild;
    expect(a?.className).not.toBe(b?.className);
  });
});

describe("ErrorBanner", () => {
  it("translates API codes into Vietnamese", () => {
    render(
      <ErrorBanner error={new ApiError(409, "org_code_taken", "taken")} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Mã tổ chức đã được sử dụng",
    );
  });

  it("renders plain strings and falls back for oddballs", () => {
    const { rerender } = render(<ErrorBanner error="Mã không hợp lệ" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Mã không hợp lệ");
    rerender(<ErrorBanner error={new Error("boom")} />);
    expect(screen.getByRole("alert")).toHaveTextContent(GENERIC_ERROR_MESSAGE);
  });

  it("renders nothing for an empty error", () => {
    const { container } = render(<ErrorBanner error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("EmptyState", () => {
  it("renders icon, title, hint and an optional CTA link", () => {
    render(
      <EmptyState
        icon={FaRegCircle}
        title="Chưa có hoạt động"
        hint="Tạo hoạt động đầu tiên"
        action={{ href: "/x", label: "Tạo ngay" }}
      />,
    );
    expect(screen.getByText("Chưa có hoạt động")).toBeInTheDocument();
    expect(screen.getByText("Tạo hoạt động đầu tiên")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tạo ngay" })).toHaveAttribute(
      "href",
      "/x",
    );
  });
});

describe("ConfirmAction", () => {
  it("fires only after the second click", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmAction label="Hủy hoạt động" onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Hủy hoạt động" }));
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Xác nhận?" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("disarms via Hủy without firing", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmAction label="Thu hồi mã" onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Thu hồi mã" }));
    await user.click(screen.getByRole("button", { name: "Hủy" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Thu hồi mã" }),
    ).toBeInTheDocument();
  });
});

describe("InputField", () => {
  it("wires label, hint and error to the input", () => {
    render(
      <InputField
        label="Sức chứa"
        hint="Để trống nếu không giới hạn"
        error="Sức chứa phải là số nguyên từ 1 trở lên"
      />,
    );
    expect(screen.getByLabelText("Sức chứa")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sức chứa phải là số nguyên từ 1 trở lên",
    );
    expect(
      screen.queryByText("Để trống nếu không giới hạn"),
    ).not.toBeInTheDocument();
  });
});
