/**
 * Unit tests for `lib/health.ts` — the backend reachability probe.
 * `fetch` is stubbed; no real network is touched.
 *
 * Layer: **unit**
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_API_URL } from "@/lib/config";
import { checkApiHealth } from "@/lib/health";

const HEALTH_BODY = {
  status: "ok",
  app: "AmigoAct API",
  version: "0.1.0",
  environment: "development",
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_API_URL;
});

describe("checkApiHealth", () => {
  it("reports ok when the backend answers with the health contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(HEALTH_BODY)),
    );

    await expect(checkApiHealth()).resolves.toEqual({
      ok: true,
      app: "AmigoAct API",
      version: "0.1.0",
      environment: "development",
    });
    expect(fetch).toHaveBeenCalledWith(
      `${DEFAULT_API_URL}/api/health`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("honours NEXT_PUBLIC_API_URL for the probe target", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://api.internal:9000";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(HEALTH_BODY)),
    );

    await checkApiHealth();

    expect(fetch).toHaveBeenCalledWith(
      "http://api.internal:9000/api/health",
      expect.anything(),
    );
  });

  it("reports a non-2xx status as the reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );

    await expect(checkApiHealth()).resolves.toEqual({
      ok: false,
      reason: "HTTP 503",
    });
  });

  it("reports a malformed 200 body as an unexpected shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ status: "ok" })),
    );

    await expect(checkApiHealth()).resolves.toEqual({
      ok: false,
      reason: "unexpected response shape",
    });
  });

  it("surfaces the underlying cause of a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed", {
          cause: new Error("connect ECONNREFUSED 127.0.0.1:8100"),
        });
      }),
    );

    const result = await checkApiHealth();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("ECONNREFUSED");
    }
  });

  it("reports a timeout distinctly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("signal timed out", "TimeoutError");
      }),
    );

    await expect(checkApiHealth()).resolves.toEqual({
      ok: false,
      reason: "timed out",
    });
  });
});
