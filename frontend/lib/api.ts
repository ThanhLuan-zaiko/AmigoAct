/**
 * The single HTTP client for the AmigoAct API.
 *
 * Every fetch from the app goes through {@link apiFetch} so error handling is
 * uniform: non-2xx responses become {@link ApiError} carrying the contract's
 * `{detail, code}` pair, transport failures become `network_error`, and a
 * 401 on an authenticated request fires the {@link setOnUnauthorized} hook so
 * the auth layer can end the session.
 *
 * Framework-free: no `next/*` or React imports.
 */
import { apiUrl } from "@/lib/config";

/** An API failure. `code` is the machine string the UI switches on. */
export class ApiError extends Error {
  /** HTTP status, or `0` when no response ever arrived. */
  readonly status: number;
  /** Machine code, e.g. `"invalid_credentials"`. */
  readonly code: string;
  /** English diagnostic from the server, or a local description. */
  readonly detail: string;

  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** Called once per authenticated request that gets a 401. */
export type UnauthorizedHandler = () => void;

let onUnauthorized: UnauthorizedHandler | null = null;

/**
 * Register the session-expiry hook. The auth provider wires this to logout;
 * `null` detaches it again on unmount.
 */
export function setOnUnauthorized(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

export interface ApiFetchOptions {
  /** HTTP method; defaults to GET, or POST when `body` is given. */
  method?: string;
  /** JSON-serialized request body. `undefined` means no body. */
  body?: unknown;
  /** JWT access token — sent as `Authorization: Bearer`. */
  token?: string;
  /** AbortSignal for cancellation (TanStack Query passes one). */
  signal?: AbortSignal;
}

/**
 * Fetch an API path and return the decoded JSON body.
 *
 * @returns `undefined` for 204 No Content, else the parsed body as `T`.
 * @throws {ApiError} on any non-2xx response, a non-JSON body, or a transport
 *   failure. Abort/timeout rejections from a caller-supplied signal propagate
 *   untouched so callers keep control of cancellation.
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const hasBody = options.body !== undefined;
  const headers = new Headers({ Accept: "application/json" });
  if (hasBody) {
    headers.set("Content-Type", "application/json");
  }
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method: options.method ?? (hasBody ? "POST" : "GET"),
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new ApiError(0, "network_error", describeCause(error));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await readJson(response);

  if (!response.ok) {
    // A 401 only ends a session when a token was actually sent — a tokenless
    // 401 (e.g. a failed login) carries no session to invalidate.
    if (response.status === 401 && options.token) {
      onUnauthorized?.();
    }
    throw toApiError(response.status, body);
  }
  if (body === undefined) {
    throw new ApiError(
      response.status,
      "unexpected_response",
      `HTTP ${response.status} returned a non-JSON body`,
    );
  }
  return body as T;
}

export interface ApiBlobOptions {
  /** JWT access token — sent as `Authorization: Bearer`. */
  token?: string;
  /** AbortSignal for cancellation (TanStack Query passes one). */
  signal?: AbortSignal;
}

/**
 * Fetch an API path that returns a binary body (e.g. the PDF certificate)
 * and return it as a `Blob`.
 *
 * Error semantics match {@link apiFetch}: non-2xx responses become
 * {@link ApiError} by parsing the JSON error body, transport failures
 * become `network_error`, and a 401 on a tokened request fires the
 * unauthorized hook.
 */
export async function apiFetchBlob(
  path: string,
  options: ApiBlobOptions = {},
): Promise<Blob> {
  const headers = new Headers({ Accept: "application/pdf, application/json" });
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method: "GET",
      headers,
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new ApiError(0, "network_error", describeCause(error));
  }

  if (!response.ok) {
    if (response.status === 401 && options.token) {
      onUnauthorized?.();
    }
    throw toApiError(response.status, await readJson(response));
  }
  return response.blob();
}

/** Decode the body, or `undefined` when it is empty or not JSON. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Build the ApiError for a failed response body. */
function toApiError(status: number, body: unknown): ApiError {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    const detail = record.detail;
    if (typeof detail === "string") {
      // The contract always pairs detail with code; a bare detail is still a
      // real API error, just an uncoded one.
      const code = typeof record.code === "string" ? record.code : "error";
      return new ApiError(status, code, detail);
    }
    if (Array.isArray(detail)) {
      // FastAPI request-validation failures: detail is a list of issues.
      const messages = detail
        .map((issue) =>
          typeof issue === "object" && issue !== null && "msg" in issue
            ? String((issue as { msg: unknown }).msg)
            : "",
        )
        .filter((msg) => msg.length > 0)
        .join("; ");
      return new ApiError(
        status,
        "validation_error",
        messages || "Request validation failed",
      );
    }
  }
  return new ApiError(
    status,
    "unexpected_response",
    `HTTP ${status} returned an unrecognized error body`,
  );
}

/** Loose name check — AbortSignal errors are DOMExceptions, not Errors. */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    ((error as { name: unknown }).name === "AbortError" ||
      (error as { name: unknown }).name === "TimeoutError")
  );
}

function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
