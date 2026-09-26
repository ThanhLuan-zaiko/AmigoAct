/**
 * Unit tests for `lib/api.ts` — ApiError mapping, headers, and the
 * onUnauthorized hook. `fetch` is stubbed; no real network is touched.
 *
 * Layer: **unit**
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch, apiFetchBlob, setOnUnauthorized } from "@/lib/api";
import { DEFAULT_API_URL } from "@/lib/config";

afterEach(() => {
  vi.unstubAllGlobals();
  setOnUnauthorized(null);
});

function stubFetch(response: Response) {
  const mock = vi.fn(async (..._args: Parameters<typeof fetch>) => response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function lastInit(mock: ReturnType<typeof stubFetch>): RequestInit {
  const init = mock.mock.calls.at(-1)?.[1];
  if (!init) {
    throw new Error("fetch was not called");
  }
  return init;
}

describe("apiFetch request shape", () => {
  it("GETs the apiUrl-joined path", async () => {
    const mock = stubFetch(Response.json({ ok: true }));
    await apiFetch("/api/health");
    expect(mock).toHaveBeenCalledWith(
      `${DEFAULT_API_URL}/api/health`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("POSTs a JSON body with a Content-Type header", async () => {
    const mock = stubFetch(Response.json({ ok: true }));
    await apiFetch("/api/x", { method: "POST", body: { a: 1 } });
    const init = lastInit(mock);
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Headers).get("Content-Type")).toBe(
      "application/json",
    );
  });

  it("defaults to POST when a body is given without a method", async () => {
    const mock = stubFetch(Response.json({ ok: true }));
    await apiFetch("/api/x", { body: { a: 1 } });
    expect(lastInit(mock).method).toBe("POST");
  });

  it("attaches the bearer token", async () => {
    const mock = stubFetch(Response.json({ ok: true }));
    await apiFetch("/api/x", { token: "jwt-1" });
    expect((lastInit(mock).headers as Headers).get("Authorization")).toBe(
      "Bearer jwt-1",
    );
  });

  it("forwards the caller's abort signal", async () => {
    const mock = stubFetch(Response.json({ ok: true }));
    const controller = new AbortController();
    await apiFetch("/api/x", { signal: controller.signal });
    expect(lastInit(mock).signal).toBe(controller.signal);
  });
});

describe("apiFetch success handling", () => {
  it("returns the decoded JSON body", async () => {
    stubFetch(Response.json({ hello: "world" }));
    await expect(apiFetch<{ hello: string }>("/x")).resolves.toEqual({
      hello: "world",
    });
  });

  it("returns undefined for 204 No Content", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(apiFetch("/x")).resolves.toBeUndefined();
  });

  it("throws unexpected_response for a non-JSON 2xx body", async () => {
    stubFetch(new Response("<html></html>", { status: 200 }));
    const error = await apiFetch("/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("unexpected_response");
  });
});

describe("apiFetch error mapping", () => {
  it("maps {detail, code} to ApiError fields", async () => {
    stubFetch(
      Response.json(
        { detail: "Invalid credentials", code: "invalid_credentials" },
        { status: 401 },
      ),
    );
    const error = await apiFetch("/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(401);
    expect(apiError.code).toBe("invalid_credentials");
    expect(apiError.detail).toBe("Invalid credentials");
    expect(apiError.message).toBe("Invalid credentials");
  });

  it("maps a FastAPI list-detail body to validation_error", async () => {
    stubFetch(
      Response.json(
        {
          detail: [
            { loc: ["body", "email"], msg: "field required", type: "missing" },
            { loc: ["body", "name"], msg: "too short", type: "too_short" },
          ],
        },
        { status: 422 },
      ),
    );
    const error = (await apiFetch("/x").catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("validation_error");
    expect(error.detail).toContain("field required");
    expect(error.detail).toContain("too short");
  });

  it("maps a non-JSON error body to unexpected_response", async () => {
    stubFetch(new Response("proxy exploded", { status: 502 }));
    const error = (await apiFetch("/x").catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(502);
    expect(error.code).toBe("unexpected_response");
  });

  it("keeps a string detail without a code as an uncoded error", async () => {
    stubFetch(Response.json({ detail: "plain failure" }, { status: 500 }));
    const error = (await apiFetch("/x").catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("error");
    expect(error.detail).toBe("plain failure");
  });

  it("wraps transport failures as network_error with status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const error = (await apiFetch("/x").catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.code).toBe("network_error");
    expect(error.detail).toContain("fetch failed");
  });

  it("rethrows abort rejections untouched", async () => {
    const abort = new DOMException("cancelled", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw abort;
      }),
    );
    await expect(apiFetch("/x")).rejects.toBe(abort);
  });
});

describe("apiFetchBlob", () => {
  it("returns the raw blob on success", async () => {
    const pdf = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    const mock = stubFetch(new Response(pdf, { status: 200 }));
    const blob = await apiFetchBlob("/api/records/r-1/certificate", {
      token: "jwt-1",
    });
    expect(blob.size).toBeGreaterThan(0);
    expect(mock).toHaveBeenCalledWith(
      `${DEFAULT_API_URL}/api/records/r-1/certificate`,
      expect.objectContaining({ method: "GET" }),
    );
    expect((lastInit(mock).headers as Headers).get("Authorization")).toBe(
      "Bearer jwt-1",
    );
  });

  it("maps a JSON error body to ApiError — the blob contract", async () => {
    stubFetch(
      Response.json(
        { detail: "Record not found", code: "record_not_found" },
        { status: 404 },
      ),
    );
    const error = (await apiFetchBlob("/x").catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.code).toBe("record_not_found");
  });

  it("fires the unauthorized hook on a tokened 401", async () => {
    const handler = vi.fn();
    setOnUnauthorized(handler);
    stubFetch(
      Response.json(
        { detail: "bad token", code: "token_invalid" },
        { status: 401 },
      ),
    );
    await apiFetchBlob("/x", { token: "jwt" }).catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("wraps transport failures as network_error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("connection refused");
      }),
    );
    const error = (await apiFetchBlob("/x").catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error.status).toBe(0);
    expect(error.code).toBe("network_error");
  });
});

describe("setOnUnauthorized", () => {
  it("fires on a 401 only when a token was attached", async () => {
    const handler = vi.fn();
    setOnUnauthorized(handler);
    stubFetch(
      Response.json(
        { detail: "bad token", code: "token_invalid" },
        { status: 401 },
      ),
    );

    // Tokenless 401 (e.g. invalid login) — no session to end.
    await apiFetch("/x").catch(() => {});
    expect(handler).not.toHaveBeenCalled();

    // Authenticated 401 — the session is dead.
    await apiFetch("/x", { token: "jwt" }).catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire on other error statuses", async () => {
    const handler = vi.fn();
    setOnUnauthorized(handler);
    stubFetch(
      Response.json({ detail: "x", code: "conflict" }, { status: 409 }),
    );
    await apiFetch("/x", { token: "jwt" }).catch(() => {});
    expect(handler).not.toHaveBeenCalled();
  });

  it("stops firing after being detached", async () => {
    const handler = vi.fn();
    setOnUnauthorized(handler);
    setOnUnauthorized(null);
    stubFetch(
      Response.json({ detail: "bad", code: "token_invalid" }, { status: 401 }),
    );
    await apiFetch("/x", { token: "jwt" }).catch(() => {});
    expect(handler).not.toHaveBeenCalled();
  });
});
