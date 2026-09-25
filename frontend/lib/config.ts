/**
 * Runtime configuration for the frontend.
 *
 * Values are read lazily so tests can override `process.env` between cases.
 */

export const DEFAULT_API_URL = "http://localhost:8000";

/** Absolute base URL of the AmigoAct API. */
export function getApiUrl(): string {
  // `||` also covers an empty string, which is how an unset NEXT_PUBLIC_*
  // variable arrives in a `.env` file.
  return process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
}

/** Join the API base URL with a path, avoiding double slashes. */
export function apiUrl(path: string): string {
  const base = getApiUrl().replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
