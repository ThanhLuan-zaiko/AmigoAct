/**
 * Unit tests for `lib/config.ts` — URL construction, no network involved.
 *
 * Layer: **unit**
 */
import { afterEach, describe, expect, it } from "vitest";

import { apiUrl, DEFAULT_API_URL, getApiUrl } from "@/lib/config";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_API_URL;
});

describe("getApiUrl", () => {
  it("returns the default when the env var is unset", () => {
    expect(getApiUrl()).toBe(DEFAULT_API_URL);
  });

  it("returns the default when the env var is empty", () => {
    process.env.NEXT_PUBLIC_API_URL = "";
    expect(getApiUrl()).toBe(DEFAULT_API_URL);
  });

  it("returns the configured URL when set", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.amigoact.dev";
    expect(getApiUrl()).toBe("https://api.amigoact.dev");
  });
});

describe("apiUrl", () => {
  it("joins a leading-slash path", () => {
    expect(apiUrl("/api/health")).toBe(`${DEFAULT_API_URL}/api/health`);
  });

  it("adds the missing leading slash", () => {
    expect(apiUrl("api/health")).toBe(`${DEFAULT_API_URL}/api/health`);
  });

  it("does not double up slashes from the base", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.amigoact.dev///";
    expect(apiUrl("/api/health")).toBe("https://api.amigoact.dev/api/health");
  });
});
