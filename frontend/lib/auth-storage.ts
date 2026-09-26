/**
 * JWT access-token persistence.
 *
 * The token lives in `localStorage` under {@link TOKEN_STORAGE_KEY}. Every
 * function is SSR-safe: on the server (or when storage is unavailable, e.g.
 * private browsing) they are no-ops that return `null`.
 *
 * Framework-free: no `next/*` or React imports.
 */

export const TOKEN_STORAGE_KEY = "amigoact-token";

/** Read the stored token, or `null` when absent/unreadable. */
export function getToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persist a token after login/register. */
export function saveToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Storage can throw in private mode; the session just won't persist.
  }
}

/** Remove the token on logout. */
export function clearToken(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Same caveat as saveToken.
  }
}
