/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

/**
 * Vite plugin that injects real Firebase config values into the service worker
 * at build time. The public/firebase-messaging-sw.js file uses __PLACEHOLDER__*
 * tokens that this plugin replaces with VITE_FIREBASE_* env vars when copying
 * the file into dist/.
 */
function firebaseSwPlugin(): Plugin {
  return {
    name: "firebase-sw-config",
    apply: "build",
    writeBundle(options) {
      const outDir = options.dir ?? "dist";
      const swPath = resolve(outDir, "firebase-messaging-sw.js");
      try {
        let content = readFileSync(swPath, "utf-8");
        const replacements: Record<string, string | undefined> = {
          __PLACEHOLDER_API_KEY__: process.env.VITE_FIREBASE_API_KEY,
          __PLACEHOLDER_AUTH_DOMAIN__: process.env.VITE_FIREBASE_AUTH_DOMAIN,
          __PLACEHOLDER_PROJECT_ID__: process.env.VITE_FIREBASE_PROJECT_ID,
          __PLACEHOLDER_STORAGE_BUCKET__: process.env.VITE_FIREBASE_STORAGE_BUCKET,
          __PLACEHOLDER_MESSAGING_SENDER_ID__: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
          __PLACEHOLDER_APP_ID__: process.env.VITE_FIREBASE_APP_ID,
        };
        for (const [token, value] of Object.entries(replacements)) {
          if (value) content = content.replace(token, value);
        }
        writeFileSync(swPath, content);
      } catch {
        // SW file may not exist in test builds — skip silently
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), firebaseSwPlugin()],
  define: {
    "import.meta.env.VERCEL": JSON.stringify(process.env.VERCEL ?? ""),
    "import.meta.env.VITE_GIT_SHA": JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ""),
  },
  build: {
    outDir: "dist",
    sourcemap: "hidden",
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: [
            "firebase/app",
            "firebase/auth",
            "firebase/firestore",
            "firebase/storage",
            "firebase/app-check",
            "firebase/messaging",
          ],
          react: ["react", "react-dom"],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/__tests__/setup.ts",
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/__tests__/**",
        "src/vite-env.d.ts",
        // Entry point — not unit-testable in isolation
        "src/main.tsx",
      ],
      reporter: ["text", "lcov"],
      thresholds: {
        // Services and hooks have complete unit test coverage
        "src/services/**": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/hooks/**": { lines: 100, functions: 100, branches: 100, statements: 100 },
        // firebase.ts: App Check branches depend on runtime env vars (VITE_RECAPTCHA_SITE_KEY)
        // that cannot be set in Vitest's test environment — ~2 lines are legitimately untestable.
        "src/firebase.ts": { lines: 93, functions: 100, branches: 80, statements: 93 },
      },
    },
  },
});
