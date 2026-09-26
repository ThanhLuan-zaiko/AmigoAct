"use client";

import { useSyncExternalStore } from "react";
import { FiMoon, FiSun } from "react-icons/fi";

import { useTheme } from "@/components/theme-provider";

/** `useSyncExternalStore` mounted flag: false on SSR/hydration, true after. */
const subscribeToNothing = () => () => {};

/**
 * Manual theme switch, per `docs/ui-design.md`.
 *
 * Both icons are always rendered and CSS (`dark:`) picks which shows — so the
 * markup is identical in SSR and on the client, even pre-hydration when the
 * inline script has already set the `dark` class.
 *
 * The aria-label is trickier: the SSR render cannot know the resolved theme
 * (the OS preference lives in the browser), and React does not patch a
 * mismatched `aria-label` during hydration — the stale SSR value would stay
 * frozen. So SSR and hydration render the neutral label, and the directional
 * label lands on the first post-hydration render.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const goesDark = theme === "light";
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        mounted
          ? goesDark
            ? "Chuyển sang giao diện tối"
            : "Chuyển sang giao diện sáng"
          : "Chuyển đổi giao diện"
      }
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
    >
      <FiMoon aria-hidden="true" className="h-4 w-4 dark:hidden" />
      <FiSun aria-hidden="true" className="hidden h-4 w-4 dark:block" />
    </button>
  );
}
