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
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore", "firebase/storage"],
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
        // firebase.ts and App.tsx have unavoidable gaps (browser APIs, compile-time constants)
        "src/firebase.ts": { lines: 100, functions: 100, branches: 90, statements: 100 },
        "src/App.tsx": { lines: 80, functions: 75, branches: 75, statements: 80 },
      },
    },
  },
});
