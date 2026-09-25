import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the AmigoAct frontend.
 *
 * Tests are split into three named projects that mirror the backend layering
 * contract in `docs/testing.md`:
 *
 *   unit        pure functions / hooks, no React rendering required
 *   integration components, routes and lib modules rendered together in jsdom
 *   regression  locks in behaviour that already shipped
 *
 * Run one layer at a time with `--project unit|integration|regression`.
 */
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
    coverage: {
      provider: "istanbul",
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      include: [
        "app/**/*.{ts,tsx}",
        "components/**/*.{ts,tsx}",
        "lib/**/*.{ts,tsx}",
      ],
      exclude: [
        "app/layout.tsx",
        "**/*.d.ts",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/__tests__/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    projects: [
      {
        plugins: [tsconfigPaths(), react()],
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./tests/setup.ts"],
          restoreMocks: true,
          include: ["tests/unit/**/*.test.{ts,tsx}"],
        },
      },
      {
        plugins: [tsconfigPaths(), react()],
        test: {
          name: "integration",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./tests/setup.ts"],
          restoreMocks: true,
          include: ["tests/integration/**/*.test.{ts,tsx}"],
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "regression",
          environment: "node",
          globals: true,
          include: ["tests/regression/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
