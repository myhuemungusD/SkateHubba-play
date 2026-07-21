import { defineConfig } from "vitest/config";

/**
 * Standalone config for the functions package. Its mere presence stops Vitest
 * from walking up and inheriting the app's root vite.config.ts (jsdom env +
 * a setupFiles path that only exists for the web app). Node environment, and
 * only this package's tests.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
