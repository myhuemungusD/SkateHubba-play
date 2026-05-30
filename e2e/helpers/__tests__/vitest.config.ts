import { defineConfig } from "vitest/config";

/**
 * Isolated vitest config for e2e helper unit tests.
 *
 * The main `vite.config.ts` restricts include to `src/**` so it doesn't
 * scan the Playwright `e2e/` tree. This config exists solely so the
 * hermetic unit tests for helpers (e.g. `firestore-read.test.ts`) can be
 * executed without enabling a global include that would otherwise sweep
 * up the Playwright specs themselves.
 *
 * Run via:
 *   npx vitest run --config e2e/helpers/__tests__/vitest.config.ts
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["e2e/helpers/__tests__/**/*.test.ts"],
  },
});
