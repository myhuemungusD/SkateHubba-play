/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { deferAppEntry, deferAppStylesheet } from "./scripts/deferAppCss";

/**
 * Vite plugin that injects real Firebase config values into the service worker
 * at build time. The public/firebase-messaging-sw.js file uses __PLACEHOLDER__*
 * tokens that this plugin replaces with VITE_FIREBASE_* env vars when copying
 * the file into dist/.
 */
function deferAppCssPlugin(): Plugin {
  return {
    name: "defer-app-css",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return deferAppEntry(deferAppStylesheet(html));
      },
    },
  };
}

function firebaseSwPlugin(): Plugin {
  return {
    name: "firebase-sw-config",
    apply: "build",
    writeBundle(options) {
      const outDir = options.dir ?? "dist";
      const swPath = resolve(outDir, "firebase-messaging-sw.js");
      let content: string;
      try {
        content = readFileSync(swPath, "utf-8");
      } catch {
        // SW file may not exist in test builds — skip silently
        return;
      }
      {
        const replacements: Record<string, string | undefined> = {
          __PLACEHOLDER_API_KEY__: process.env.VITE_FIREBASE_API_KEY,
          __PLACEHOLDER_AUTH_DOMAIN__: process.env.VITE_FIREBASE_AUTH_DOMAIN,
          __PLACEHOLDER_PROJECT_ID__: process.env.VITE_FIREBASE_PROJECT_ID,
          __PLACEHOLDER_STORAGE_BUCKET__: process.env.VITE_FIREBASE_STORAGE_BUCKET,
          __PLACEHOLDER_MESSAGING_SENDER_ID__: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
          __PLACEHOLDER_APP_ID__: process.env.VITE_FIREBASE_APP_ID,
        };
        const unreplaced: string[] = [];
        for (const [token, value] of Object.entries(replacements)) {
          if (value) {
            content = content.replace(token, value);
          } else if (content.includes(token)) {
            unreplaced.push(token);
          }
        }
        if (unreplaced.length > 0) {
          const message = `[firebase-sw-config] ${unreplaced.length} placeholder(s) not replaced in SW (missing env vars): ${unreplaced.join(", ")}`;
          // Store/release builds must never ship a service worker with dead
          // placeholder config — background web push would silently break.
          // REQUIRE_SW_CONFIG=1 turns the warning into a hard build failure.
          // Set in android-aab.yml, ios-release.yml, and release.yml; the Vercel production
          // deploy needs it added as a project env var (dashboard) to get the
          // same guarantee. Local builds without a .env keep working with the
          // query-string fallback the SW ships.
          if (process.env.REQUIRE_SW_CONFIG) {
            throw new Error(message);
          }
          console.warn(`${message} — set REQUIRE_SW_CONFIG=1 to make this fatal.`);
        }
        writeFileSync(swPath, content);
      }
    },
  };
}

/**
 * Browser Sentry DSN fallback for the Vercel PRODUCTION build only.
 *
 * The browser reads VITE_SENTRY_DSN (src/main.tsx), but the Vercel project
 * stores the DSN as SENTRY_DSN — a Sensitive var, so its value cannot be read
 * back out to copy into a second variable. Vercel does expose it to the build,
 * so when VITE_SENTRY_DSN is unset on a production build, inline SENTRY_DSN
 * instead. A DSN is a public client identifier (it ships in every Sentry-
 * enabled bundle), so inlining it is expected. Preview builds, local builds
 * and the native release workflows (which pass VITE_SENTRY_DSN explicitly)
 * are unaffected; an explicit VITE_SENTRY_DSN always wins.
 */
const browserSentryDsnFallback =
  !process.env.VITE_SENTRY_DSN && process.env.VERCEL_ENV === "production" ? (process.env.SENTRY_DSN ?? "").trim() : "";

export default defineConfig({
  plugins: [tailwindcss(), react(), firebaseSwPlugin(), deferAppCssPlugin()],
  define: {
    ...(browserSentryDsnFallback
      ? { "import.meta.env.VITE_SENTRY_DSN": JSON.stringify(browserSentryDsnFallback) }
      : {}),
    "import.meta.env.VERCEL": JSON.stringify(process.env.VERCEL ?? ""),
    "import.meta.env.VITE_GIT_SHA": JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ""),
    // Release identifier stamped at build time. Prefer an explicit
    // VITE_APP_VERSION (set by the Release workflow to the git tag, e.g.
    // "v1.2.0") so Sentry's source-map upload and the running app agree on
    // the same release string. Falls back to the package.json version
    // so preview deployments still report a meaningful identifier.
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(
      process.env.VITE_APP_VERSION ?? JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8")).version,
    ),
  },
  build: {
    outDir: "dist",
    sourcemap: "hidden",
    // Modern browsers only. Drops the legacy polyfill/transform output that
    // Lighthouse was counting as unused JavaScript.
    target: "es2022",
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Specific packages first so auth/firestore/storage/app-check can
          // load on the route that needs them instead of one shared chunk.
          if (id.includes("node_modules/firebase/app-check") || id.includes("node_modules/@firebase/app-check")) {
            return "firebase-app-check";
          }
          if (id.includes("node_modules/firebase/firestore") || id.includes("node_modules/@firebase/firestore")) {
            return "firebase-firestore";
          }
          if (id.includes("node_modules/firebase/storage") || id.includes("node_modules/@firebase/storage")) {
            return "firebase-storage";
          }
          if (id.includes("node_modules/firebase/auth") || id.includes("node_modules/@firebase/auth")) {
            return "firebase-auth";
          }
          if (id.includes("node_modules/firebase/messaging") || id.includes("node_modules/@firebase/messaging")) {
            return "firebase-messaging";
          }
          if (id.includes("node_modules/firebase/") || id.includes("node_modules/@firebase/")) {
            return "firebase-core";
          }
          if (id.includes("node_modules/react-dom/") || id.includes("node_modules/react/")) {
            return "react";
          }
          // three + r3f + drei are shared by the skate runner and the 360 shoe
          // viewer; both are lazy, so one named chunk loads only on those routes.
          if (/node_modules\/(three|three-stdlib|@react-three|camera-controls|maath)\//.test(id)) {
            return "three-vendor";
          }
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
    // Undo vi.stubEnv / vi.stubGlobal after every test so a stub can never
    // leak into the next test (see 878-hesher.md, nativeVideo flake).
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      // api/ is the Vercel serverless side (account delete, crons, player
      // meta, well-known files). Its tests live in src/ (vitest's include
      // above), so measure it here too or it can drop to 0% unseen.
      include: ["src/**/*.{ts,tsx}", "api/**/*.ts"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/__tests__/**",
        // Shared test helpers — not production code, never imported outside tests
        "src/**/__tests__/**/*test-helpers*.ts",
        // Type declarations and manual module mocks carry no runtime code
        // of their own to cover.
        "src/**/*.d.ts",
        "src/**/__mocks__/**",
        // Entry point — not unit-testable in isolation
        "src/main.tsx",
      ],
      // json-summary feeds scripts/check-coverage-per-file.mjs, the per-file
      // half of the UI floors below (the globs are aggregate-only).
      reporter: ["text", "lcov", "json-summary"],
      thresholds: {
        // Whole-repo floor. Every number below is a ratchet, set by one rule:
        // floor = the minimum over at least 5 full coverage runs, truncated to
        // one decimal. Coverage must be deterministic run to run (fake timers
        // and manual rAF queues, never real-time races), so the min is stable.
        // Truncating leaves a few items of slack in the big globs, so this is
        // a ratchet, not a strict no-drop gate; the per-file gate
        // (scripts/check-coverage-per-file.mjs) backs it up. Raise them as
        // coverage climbs; never lower one to make a PR pass. Goal: 100
        // everywhere.
        //
        // Known swing: in about 1 full run in 10, coverage-v8 attributes
        // src/components/onboarding/TutorialOverlay.tsx's counts to the wrong
        // functions (negative branch counts in coverage-final.json), always
        // the same way: 8 fewer branches. That is a tooling fault, not test
        // timing, so the global and components branch floors include it.
        lines: 91.4,
        functions: 91.7,
        branches: 91.4,
        statements: 90.4,
        // Fully covered: keep it that way.
        "src/services/**": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/hooks/**": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/types/**": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/utils/**": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/firebase.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
        // Ratchet floors for everything not at 100 yet. These are AGGREGATE
        // floors: a single file can sit at 0% and still pass. The per-file
        // rule lives in scripts/check-coverage-per-file.mjs (run by
        // `npm run test:coverage`), because vitest's `perFile` is global and
        // would trip on every pre-existing under-covered file at once.
        "src/App.tsx": { lines: 74.4, functions: 59.8, branches: 77.3, statements: 72.5 },
        "src/boot/**": { lines: 88.8, functions: 85.7, branches: 85.8, statements: 88.4 },
        "src/components/**": { lines: 97.4, functions: 96, branches: 92.1, statements: 95.6 },
        "src/constants/**": { lines: 97.8, functions: 98.3, branches: 90.4, statements: 96 },
        "src/context/**": { lines: 93.6, functions: 89.9, branches: 93.7, statements: 93.2 },
        "src/lib/**": { lines: 85.4, functions: 89.1, branches: 84, statements: 85.4 },
        "src/runner/**": { lines: 49.5, functions: 41.6, branches: 56.8, statements: 48 },
        "src/screens/**": { lines: 98.2, functions: 97.1, branches: 94.3, statements: 97 },
        // src/closet360 (one 3D viewer file) measures 0 today, so a floor would
        // be a no-op; it is the first target of the coverage plan instead.
      },
    },
  },
});
