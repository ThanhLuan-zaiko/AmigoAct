/**
 * Routed `fetch` stub for integration tests.
 *
 * Handlers are keyed `"METHOD /api/path"` (path without query — the parsed
 * `query` is exposed on the recorded call). A handler may be a static
 * `{status?, body}` spec or a function receiving the call; returning
 * `undefined` produces a `204 No Content`, returning a `Response` passes it
 * through verbatim (binary bodies). Unmatched requests fail loudly with a
 * 500 so a missing mock is a test bug, not silent data.
 */
import { vi } from "vitest";

export interface MockCall {
  method: string;
  path: string;
  query: URLSearchParams;
  /** Decoded JSON request body, or undefined when none was sent. */
  body: unknown;
  init: RequestInit;
}

export interface MockReply {
  status?: number;
  body?: unknown;
}

/**
 * A handler is a static reply, or a function of the recorded call. Returning
 * a `Response` passes it through untouched — needed for binary endpoints
 * (the PDF certificate) that must not be JSON-wrapped.
 */
export type MockHandler =
  | MockReply
  | ((call: MockCall) => MockReply | Response | undefined);

/**
 * Install the routed stub on global `fetch`. Returns the recorded calls —
 * assert on them to verify request bodies/URLs.
 */
export function mockApi(handlers: Record<string, MockHandler>): MockCall[] {
  const calls: MockCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const parsed = new URL(url);
      const method = (init?.method ?? "GET").toUpperCase();
      let body: unknown;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      const call: MockCall = {
        method,
        path: parsed.pathname,
        query: parsed.searchParams,
        body,
        init: init ?? {},
      };
      calls.push(call);

      const handler = handlers[`${method} ${parsed.pathname}`];
      if (handler === undefined) {
        return Response.json(
          {
            detail: `no mock for ${method} ${parsed.pathname}`,
            code: "unexpected_response",
          },
          { status: 500 },
        );
      }
      const reply = typeof handler === "function" ? handler(call) : handler;
      if (reply instanceof Response) {
        return reply;
      }
      if (reply === undefined || reply.status === 204) {
        return new Response(null, { status: 204 });
      }
      return Response.json(reply.body ?? {}, { status: reply.status ?? 200 });
    }),
  );
  return calls;
}

/** Find recorded calls for a method+path. */
export function callsTo(
  calls: MockCall[],
  method: string,
  path: string,
): MockCall[] {
  return calls.filter((c) => c.method === method && c.path === path);
}
