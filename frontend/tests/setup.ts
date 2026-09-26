/**
 * Global test setup shared by the `unit` and `integration` Vitest projects.
 *
 * The `regression` project runs in the `node` environment and deliberately
 * does not load this file — it has no jsdom globals to install.
 *
 * `next/navigation` is mocked suite-wide: jsdom has no App Router, and every
 * client component touching `useRouter`/`usePathname`/`useSearchParams`
 * would otherwise throw "invariant expected app router to be mounted".
 * Tests steer the mock via the `mockNavigation*` helpers below (import from
 * `@/tests/setup`) — per-test resets happen in `beforeEach`.
 */
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

const mockNavigationRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
};

let mockNavigationPathname = "/";
let mockNavigationSearch = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => mockNavigationRouter,
  usePathname: () => mockNavigationPathname,
  useSearchParams: () => mockNavigationSearch,
  useParams: () => ({}),
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  permanentRedirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

/** The shared mocked App Router — `replace`/`push` assertions go here. */
export function getMockRouter() {
  return mockNavigationRouter;
}

/** Set the path returned by `usePathname()` for this test. */
export function setMockPathname(pathname: string): void {
  mockNavigationPathname = pathname;
}

/** Set the query string (with or without `?`) for `useSearchParams()`. */
export function setMockSearchString(search: string): void {
  mockNavigationSearch = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
}

beforeEach(() => {
  // Deterministic clock-independent tests: freeze nothing by default, but make
  // sure a leaked env var from a previous file cannot leak into this one.
  delete process.env.AMIGOACT_API_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
  mockNavigationPathname = "/";
  mockNavigationSearch = new URLSearchParams();
  if (typeof window !== "undefined") {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  }
});

afterEach(() => {
  cleanup();
});
