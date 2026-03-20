/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VERCEL": JSON.stringify(process.env.VERCEL ?? ""),
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
