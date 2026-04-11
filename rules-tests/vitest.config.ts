import { defineConfig } from "vitest/config";

/**
 * Separate vitest config for Firestore rules tests.
 *
 * These tests require a live Firestore emulator on :8080, so they're
 * deliberately isolated from the main unit suite (`vite.config.ts`). Run
 * via `npm run test:rules`, which wraps this in `firebase emulators:exec`.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["**/*.rules.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // rules-unit-testing opens emulator connections on each context; keep
    // tests serial so they don't race each other on the shared port.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
