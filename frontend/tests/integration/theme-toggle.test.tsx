/**
 * Integration tests for the theme system — ThemeProvider + ThemeToggle
 * rendered in jsdom and driven by clicks and OS-preference changes.
 * `matchMedia` is stubbed (jsdom has none); localStorage is real.
 *
 * Layer: **integration**
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { stubMatchMedia } from "@/tests/helpers/match-media";

afterEach(() => {
  vi.unstubAllGlobals();
});

const isDark = () => document.documentElement.classList.contains("dark");

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("theme initialization", () => {
  it("follows a light OS preference", () => {
    stubMatchMedia(false);
    renderToggle();

    expect(isDark()).toBe(false);
    expect(
      screen.getByRole("button", { name: "Chuyển sang giao diện tối" }),
    ).toBeInTheDocument();
  });

  it("follows a dark OS preference", () => {
    stubMatchMedia(true);
    renderToggle();

    expect(isDark()).toBe(true);
    expect(
      screen.getByRole("button", { name: "Chuyển sang giao diện sáng" }),
    ).toBeInTheDocument();
  });

  it("a stored manual choice wins over the OS preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    stubMatchMedia(true); // OS wants dark — the stored "light" must win.
    renderToggle();

    expect(isDark()).toBe(false);
  });

  it("works when matchMedia is unavailable at all", () => {
    renderToggle(); // no stub — jsdom has no matchMedia
    expect(isDark()).toBe(false);
  });
});

describe("manual toggle", () => {
  it("flips the dark class and persists the choice", async () => {
    const user = userEvent.setup();
    stubMatchMedia(false);
    renderToggle();

    await user.click(
      screen.getByRole("button", { name: "Chuyển sang giao diện tối" }),
    );

    expect(isDark()).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(
      screen.getByRole("button", { name: "Chuyển sang giao diện sáng" }),
    ).toBeInTheDocument();
  });

  it("toggles back to light", async () => {
    const user = userEvent.setup();
    stubMatchMedia(true);
    renderToggle();

    await user.click(
      screen.getByRole("button", { name: "Chuyển sang giao diện sáng" }),
    );

    expect(isDark()).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});

describe("OS preference changes", () => {
  it("follows the OS while no manual choice exists", () => {
    const media = stubMatchMedia(false);
    renderToggle();
    expect(isDark()).toBe(false);

    act(() => media.setPrefersDark(true));
    expect(isDark()).toBe(true);

    act(() => media.setPrefersDark(false));
    expect(isDark()).toBe(false);
  });

  it("ignores the OS once the user has chosen", async () => {
    const user = userEvent.setup();
    const media = stubMatchMedia(false);
    renderToggle();

    await user.click(
      screen.getByRole("button", { name: "Chuyển sang giao diện tối" }),
    );
    expect(isDark()).toBe(true);

    // The OS flipping back must not move the theme anymore.
    act(() => media.setPrefersDark(false));
    expect(isDark()).toBe(true);
  });
});
