import { describeApiError } from "@/lib/errors";

/**
 * Inline error region (`role="alert"`) for API and validation failures.
 *
 * Accepts either an `ApiError`-style thrown value (translated through
 * `describeApiError`) or a plain string for local validation messages —
 * both render as Vietnamese copy. Renders nothing for `null`/`undefined`
 * so callers can pass error state directly.
 */
export function ErrorBanner({ error }: { error: unknown }) {
  if (error === null || error === undefined || error === "") {
    return null;
  }
  const message = typeof error === "string" ? error : describeApiError(error);
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    >
      {message}
    </p>
  );
}
