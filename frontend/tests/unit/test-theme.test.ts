/**
 * Unit tests for `lib/theme.ts` — resolution precedence and SSR safety.
 *
 * Layer: **unit**
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyThemeToDocument,
  PREFERS_DARK_QUERY,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  systemPrefersDark,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveTheme", () => {
  it.each([
    ["dark", false, "dark"],
    ["dark", true, "dark"],
    ["light", false, "light"],
    ["light", true, "light"],
    [null, true, "dark"],
    [null, false, "light"],
    ["sepia", true, "dark"], // unrecognized values defer to the OS
  ] as const)("stored=%j prefersDark=%j → %j", (stored, prefersDark, expected) => {
    expect(resolveTheme(stored, prefersDark)).toBe(expected);
  });

  it("a manual choice always wins over the OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("readStoredTheme", () => {
  it("returns null when no choice is stored", () => {
    expect(readStoredTheme()).toBeNull();
  });

  it.each(["dark", "light"] as const)("returns the stored %s", (theme) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    expect(readStoredTheme()).toBe(theme);
  });

  it("returns null for a stored value that is not a theme", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readStoredTheme()).toBeNull();
  });

  it("returns null when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readStoredTheme()).toBeNull();
  });

  it("returns null off-browser", () => {
    vi.stubGlobal("window", undefined);
    expect(readStoredTheme()).toBeNull();
  });
});

describe("persistTheme", () => {
  it.each(["dark", "light"] as const)("stores %s", (theme) => {
    persistTheme(theme);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(theme);
  });

  it("swallows storage failures without throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => persistTheme("dark")).not.toThrow();
  });

  it("is a no-op off-browser", () => {
    vi.stubGlobal("window", undefined);
    expect(() => persistTheme("dark")).not.toThrow();
  });
});

describe("systemPrefersDark", () => {
  it("is false when matchMedia is unavailable", () => {
    expect(systemPrefersDark()).toBe(false);
  });

  it.each([true, false])("reflects the media query (%j)", (prefers) => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: prefers,
        media: query,
      })),
    );
    expect(systemPrefersDark()).toBe(prefers);
  });

  it("queries the dark-scheme media", () => {
    const stub = vi.fn(() => ({ matches: false, media: "" }));
    vi.stubGlobal("matchMedia", stub);
    systemPrefersDark();
    expect(stub).toHaveBeenCalledWith(PREFERS_DARK_QUERY);
  });
});

describe("applyThemeToDocument", () => {
  it("adds the dark class for the dark theme", () => {
    applyThemeToDocument("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes the dark class for the light theme", () => {
    document.documentElement.classList.add("dark");
    applyThemeToDocument("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("is a no-op off-browser", () => {
    vi.stubGlobal("document", undefined);
    expect(() => applyThemeToDocument("dark")).not.toThrow();
  });
});
