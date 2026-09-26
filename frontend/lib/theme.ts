/**
 * Theme model — light/dark with OS sync and manual override.
 *
 * Rules (see `docs/ui-design.md`):
 *   - Initial theme follows `prefers-color-scheme` unless the user picked one
 *     manually — the manual choice is stored and always wins.
 *   - OS changes apply only while no manual choice exists.
 *   - The dark theme is activated by a `dark` class on `<html>` (the inline
 *     bootstrap script in `app/layout.tsx` applies it before first paint).
 *
 * Framework-free and SSR-safe: every function no-ops off the browser.
 */

export type Theme = "light" | "dark";

/**
 * `localStorage` key for the manual choice.
 *
 * Keep in sync with the inline script literal in `app/layout.tsx` — the
 * script runs before hydration and cannot import this module.
 */
export const THEME_STORAGE_KEY = "amigoact-theme";

/** Media query the OS preference is read from. */
export const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Resolve the effective theme: a valid stored choice wins, otherwise the OS
 * preference decides. Anything unrecognized falls through to the OS.
 */
export function resolveTheme(
  stored: string | null,
  prefersDark: boolean,
): Theme {
  if (stored === "dark" || stored === "light") {
    return stored;
  }
  return prefersDark ? "dark" : "light";
}

/** Whether the OS currently prefers dark. `false` off-browser. */
export function systemPrefersDark(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia(PREFERS_DARK_QUERY).matches;
}

/** Read the stored manual choice, or `null` when absent/invalid/off-browser. */
export function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "dark" || raw === "light" ? raw : null;
  } catch {
    return null;
  }
}

/** Persist a manual choice. */
export function persistTheme(theme: Theme): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private-mode storage can throw; the choice just won't persist.
  }
}

/** Toggle the `dark` class on `<html>` to match the given theme. */
export function applyThemeToDocument(theme: Theme): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle("dark", theme === "dark");
}
