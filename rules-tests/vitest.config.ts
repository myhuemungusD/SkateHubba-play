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
    // rules-unit-testing opens emulator connections on each context, and the
    // emulators are ONE shared process for the whole run: the storage suites
    // share a bucket (`clearStorageDeep` wipes known prefixes bucket-wide in
    // `beforeEach`) and the Firestore suites share :8080. Serial execution is
    // what makes that safe, and it is load-bearing — not a performance knob.
    //
    // This was `poolOptions: { forks: { singleFork: true } }`, which Vitest 4
    // REMOVED. It parsed fine and was silently ignored, so the suite had been
    // running fully parallel: storage suites deleted each other's fixtures
    // mid-test, and whole Firestore files failed to load a ruleset. The
    // Vitest 4 spelling is top-level `fileParallelism`, which also pins
    // `maxWorkers` to 1.
    pool: "forks",
    fileParallelism: false,
  },
});
