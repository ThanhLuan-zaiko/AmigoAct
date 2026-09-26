/**
 * Probe the backend's `/api/health` endpoint.
 *
 * Framework-free (no `next/*` imports) so it stays cheap to unit test. It is
 * consumed by `instrumentation.ts` at server startup; the result is only
 * ever logged, never rendered.
 */
import { apiUrl } from "@/lib/config";

/** Contract shape of `GET /api/health` — pinned by `tests/regression`. */
export interface HealthResponse {
  status: string;
  app: string;
  version: string;
  environment: string;
}

export type ApiHealthCheck =
  | { ok: true; app: string; version: string; environment: string }
  | { ok: false; reason: string };

export const HEALTH_TIMEOUT_MS = 3000;

/** GET `/api/health` with a bounded wait; never throws. */
export async function checkApiHealth(
  timeoutMs: number = HEALTH_TIMEOUT_MS,
): Promise<ApiHealthCheck> {
  try {
    const res = await fetch(apiUrl("/api/health"), {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: `HTTP ${res.status} ${res.statusText}`.trim(),
      };
    }
    const body: unknown = await res.json();
    if (!isHealthResponse(body)) {
      return { ok: false, reason: "unexpected response shape" };
    }
    return {
      ok: true,
      app: body.app,
      version: body.version,
      environment: body.environment,
    };
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }
}

function isHealthResponse(body: unknown): body is HealthResponse {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const record = body as Record<string, unknown>;
  return (
    record.status === "ok" &&
    typeof record.app === "string" &&
    typeof record.version === "string" &&
    typeof record.environment === "string"
  );
}

/** One-line reason for a failed probe, including the underlying cause. */
function describeError(err: unknown): string {
  // AbortSignal.timeout rejects with a DOMException, which is not an Error
  // subclass — check the name loosely instead of `instanceof`.
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? String(err.name)
      : "";
  if (name === "TimeoutError") {
    return "timed out";
  }
  if (err instanceof Error) {
    if (err.cause instanceof Error) {
      return `${err.message}: ${err.cause.message}`;
    }
    return err.message;
  }
  return String(err);
}
