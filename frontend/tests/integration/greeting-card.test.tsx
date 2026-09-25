/**
 * Integration tests: a real component rendered in jsdom, driven the way a
 * user would drive it.
 *
 * Layer: **integration**
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { GreetingCard } from "@/components/greeting-card";

describe("GreetingCard", () => {
  it("renders the default greeting before any input", () => {
    render(<GreetingCard />);

    expect(screen.getByTestId("greeting-output")).toHaveTextContent(
      "Xin chào, bạn!",
    );
  });

  it("renders an accessible heading and a labelled input", () => {
    render(<GreetingCard />);

    expect(
      screen.getByRole("heading", { name: "Xem trước lời chào" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Tên của bạn")).toBeInTheDocument();
  });

  it("updates the greeting as the user types", async () => {
    const user = userEvent.setup();
    render(<GreetingCard />);

    await user.type(screen.getByLabelText("Tên của bạn"), "Lan");

    expect(screen.getByTestId("greeting-output")).toHaveTextContent(
      "Xin chào, Lan!",
    );
  });

  it("normalizes whitespace typed by the user", async () => {
    const user = userEvent.setup();
    render(<GreetingCard />);

    await user.type(screen.getByLabelText("Tên của bạn"), "  Lan   Anh  ");

    expect(screen.getByTestId("greeting-output")).toHaveTextContent(
      "Xin chào, Lan Anh!",
    );
  });

  it("honours a custom salutation", async () => {
    const user = userEvent.setup();
    render(<GreetingCard greeting="Chào buổi sáng" />);

    await user.type(screen.getByLabelText("Tên của bạn"), "Lan");

    expect(screen.getByTestId("greeting-output")).toHaveTextContent(
      "Chào buổi sáng, Lan!",
    );
  });

  it("falls back to the default when the input is cleared", async () => {
    const user = userEvent.setup();
    render(<GreetingCard />);
    const input = screen.getByLabelText("Tên của bạn");

    await user.type(input, "Lan");
    await user.clear(input);

    expect(screen.getByTestId("greeting-output")).toHaveTextContent(
      "Xin chào, bạn!",
    );
  });

  it("keeps the input controlled by React", async () => {
    const user = userEvent.setup();
    render(<GreetingCard />);
    const input = screen.getByLabelText<HTMLInputElement>("Tên của bạn");

    await user.type(input, "L");

    expect(input.value).toBe("L");
  });
});
