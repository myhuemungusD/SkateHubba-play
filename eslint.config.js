import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "scripts/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
  // App code logs through src/services/logger.ts (structured output plus a
  // PII-redacted Sentry breadcrumb), never raw console.*. Exempt: the logger
  // itself, and trainingLabels.materialize.ts, which runs server-side in the
  // sweep cron (no import.meta.env) and writes one JSON line per event for
  // Vercel's log drain, matching the api/ cron convention.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/services/logger.ts", "src/services/trainingLabels.materialize.ts"],
    rules: { "no-console": "error" },
  },
  // Relaxed rules for test and mock files — test code commonly uses 'any',
  // Function types, and may intentionally import without using.
  {
    files: ["**/*.test.{ts,tsx}", "src/__mocks__/**", "src/__tests__/setup.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "no-console": "off",
    },
  },
  // The one plain (non-TypeScript) browser script in the repo — loaded
  // directly via a <script> tag, not bundled, so it never picks up the
  // DOM lib types the rest of the codebase gets through tsconfig. Without
  // an explicit global, `navigator` trips no-undef (the TS-specific rule
  // sets elsewhere disable that check for .ts/.tsx files; this is .js).
  {
    files: ["public/sw-cleanup.js"],
    languageOptions: { globals: { navigator: "readonly" } },
  },
  prettier,
);
