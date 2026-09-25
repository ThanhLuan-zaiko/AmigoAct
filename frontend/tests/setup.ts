/**
 * Global test setup shared by the `unit` and `integration` Vitest projects.
 *
 * The `regression` project runs in the `node` environment and deliberately
 * does not load this file — it has no jsdom globals to install.
 */
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

beforeEach(() => {
  // Deterministic clock-independent tests: freeze nothing by default, but make
  // sure a leaked env var from a previous file cannot leak into this one.
  delete process.env.AMIGOACT_API_URL;
});

afterEach(() => {
  cleanup();
});
