/**
 * Stub `window.matchMedia` for theme tests — jsdom does not implement it.
 * Returns a driver to fire `prefers-color-scheme` changes like the OS would.
 */
import { vi } from "vitest";

export interface MatchMediaStub {
  /** Current `matches` value backing the stub. */
  mql: { matches: boolean };
  /** Flip the OS preference and notify listeners. */
  setPrefersDark: (next: boolean) => void;
}

export function stubMatchMedia(prefersDark: boolean): MatchMediaStub {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches: prefersDark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (
      _type: string,
      callback: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.add(callback);
    },
    removeEventListener: (
      _type: string,
      callback: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.delete(callback);
    },
    // Deprecated aliases some code still calls.
    addListener: (callback: (event: MediaQueryListEvent) => void) => {
      listeners.add(callback);
    },
    removeListener: (callback: (event: MediaQueryListEvent) => void) => {
      listeners.delete(callback);
    },
    dispatchEvent: () => true,
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((_query: string) => mql as unknown as MediaQueryList),
  );
  return {
    mql,
    setPrefersDark(next: boolean) {
      mql.matches = next;
      for (const callback of listeners) {
        callback({ matches: next } as MediaQueryListEvent);
      }
    },
  };
}
