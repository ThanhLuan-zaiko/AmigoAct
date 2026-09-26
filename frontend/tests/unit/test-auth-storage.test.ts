/**
 * Unit tests for `lib/auth-storage.ts` — token persistence, including the
 * off-browser (SSR) branches via a stubbed-away `window`.
 *
 * Layer: **unit**
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearToken,
  getToken,
  saveToken,
  TOKEN_STORAGE_KEY,
} from "@/lib/auth-storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth token storage", () => {
  it("returns null when nothing is stored", () => {
    expect(getToken()).toBeNull();
  });

  it("round-trips a token through localStorage", () => {
    saveToken("jwt.abc.def");
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe("jwt.abc.def");
    expect(getToken()).toBe("jwt.abc.def");
  });

  it("clears a stored token", () => {
    saveToken("jwt");
    clearToken();
    expect(getToken()).toBeNull();
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("returns null instead of throwing when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(getToken()).toBeNull();
  });

  it("does not throw on save when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => saveToken("jwt")).not.toThrow();
  });

  it("does not throw on clear when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => clearToken()).not.toThrow();
  });
});

describe("off-browser behaviour", () => {
  it("getToken returns null without a window", () => {
    vi.stubGlobal("window", undefined);
    expect(getToken()).toBeNull();
  });

  it("saveToken is a no-op without a window", () => {
    vi.stubGlobal("window", undefined);
    expect(() => saveToken("jwt")).not.toThrow();
  });

  it("clearToken is a no-op without a window", () => {
    vi.stubGlobal("window", undefined);
    expect(() => clearToken()).not.toThrow();
  });
});
