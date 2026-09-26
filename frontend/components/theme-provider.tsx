"use client";

/**
 * Theme state owner — the only component that reads/writes the theme.
 *
 * Mirrors the inline bootstrap script in `app/layout.tsx`: the lazy
 * initializer reads the same sources (localStorage first, then the OS
 * preference) so React's initial state always agrees with the `dark` class
 * the script applied. `useLayoutEffect` re-applies the class before paint —
 * required in dev, where StrictMode's remount resets `<html>` to only the
 * attributes JSX manages.
 */
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useState,
} from "react";

import {
  applyThemeToDocument,
  PREFERS_DARK_QUERY,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  systemPrefersDark,
  type Theme,
} from "@/lib/theme";

export interface ThemeContextValue {
  theme: Theme;
  /** Flip to the opposite theme and persist it as the manual choice. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    resolveTheme(readStoredTheme(), systemPrefersDark()),
  );
  const [hasManualChoice, setHasManualChoice] = useState(
    () => readStoredTheme() !== null,
  );

  // Apply before paint; also repairs the class after dev StrictMode remounts.
  useLayoutEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // Follow the OS only while the user has not chosen manually.
  useLayoutEffect(() => {
    if (
      hasManualChoice ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const media = window.matchMedia(PREFERS_DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setTheme(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [hasManualChoice]);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    persistTheme(next);
    setHasManualChoice(true);
    setTheme(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Read the current theme — throws outside `<ThemeProvider>`. */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
