import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests run against Firebase Emulators (Auth :9099, Firestore :8080, Storage :9199).
 *
 * Start emulators before running tests:
 *   npx firebase-tools emulators:start --only auth,firestore,storage --project demo-skatehubba
 *
 * Or use the one-shot wrapper which starts/stops emulators automatically:
 *   npm run test:e2e
 */
export default defineConfig({
  globalSetup: "./e2e/global-setup.ts",
  testDir: "./e2e",
  // Tests share emulator state, so run sequentially to avoid cross-test interference.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Start the Vite dev server pointed at the Firebase Emulators.
  // The emulators must already be running (started by `firebase emulators:exec`
  // or manually via `npx firebase-tools emulators:start`).
  webServer: {
    command: "npx vite --port 5173",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      ...process.env,
      VITE_FIREBASE_API_KEY: "demo-key",
      VITE_FIREBASE_AUTH_DOMAIN: "demo-skatehubba.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "demo-skatehubba",
      VITE_FIREBASE_STORAGE_BUCKET: "demo-skatehubba.appspot.com",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
      VITE_FIREBASE_APP_ID: "1:000000000000:web:demo",
      VITE_USE_EMULATORS: "true",
    },
  },
});
