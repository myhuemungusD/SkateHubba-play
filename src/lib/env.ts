import { z } from "zod";

/**
 * Runtime validation for `import.meta.env` via Zod.
 *
 * Purpose: surface malformed or missing environment configuration at startup
 * with a precise error message — instead of waiting for the first Firebase
 * call to silently fail with an opaque 400. Schema mirrors `src/vite-env.d.ts`;
 * keep them in sync when adding new `VITE_*` variables.
 */

// Vite exposes env-file values as literal strings. Accept the strings
// "true"/"false" and coerce to a real boolean so consumers can write
// `env.VITE_USE_EMULATORS === true` without the string-equality foot-gun.
const booleanString = z.union([z.literal("true"), z.literal("false")]).transform((v) => v === "true");

const envSchema = z.object({
  // ── Required: Firebase ──────────────────────────────────────────────
  VITE_FIREBASE_API_KEY: z.string().min(1, "VITE_FIREBASE_API_KEY is required"),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1, "VITE_FIREBASE_AUTH_DOMAIN is required"),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1, "VITE_FIREBASE_PROJECT_ID is required"),
  VITE_FIREBASE_STORAGE_BUCKET: z.string().min(1, "VITE_FIREBASE_STORAGE_BUCKET is required"),
  VITE_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1, "VITE_FIREBASE_MESSAGING_SENDER_ID is required"),
  VITE_FIREBASE_APP_ID: z.string().min(1, "VITE_FIREBASE_APP_ID is required"),

  // ── Optional: Firebase add-ons ──────────────────────────────────────
  VITE_FIREBASE_VAPID_KEY: z.string().optional(),
  VITE_FIREBASE_MEASUREMENT_ID: z.string().optional(),
  VITE_RECAPTCHA_SITE_KEY: z.string().optional(),

  // ── Optional: third-party integrations ──────────────────────────────
  VITE_MAPBOX_TOKEN: z.string().optional(),
  VITE_MAPBOX_STYLE_URL: z.string().optional(),
  VITE_SENTRY_DSN: z.string().optional(),
  VITE_POSTHOG_KEY: z.string().optional(),
  VITE_POSTHOG_HOST: z.string().optional(),

  // ── Optional: build / runtime metadata ──────────────────────────────
  VITE_APP_URL: z.string().optional(),
  VITE_APP_VERSION: z.string().optional(),
  VITE_GIT_SHA: z.string().optional(),
  VERCEL: z.string().optional(),

  // ── Optional: local emulator toggle (string "true"/"false" → boolean)
  VITE_USE_EMULATORS: booleanString.optional(),

  // ── Vite built-ins we reference ─────────────────────────────────────
  DEV: z.boolean().optional(),
  PROD: z.boolean().optional(),
  MODE: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Strict validator — throws a formatted Error listing every failed field.
 * Exported for tests and consumers that want hard-fail semantics.
 */
export function parseEnv(raw: unknown): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

/**
 * Soft validator — returns `null` on failure instead of throwing.
 *
 * Used by `firebase.ts` so the app can still render its "Setup Required"
 * screen when Firebase env vars are absent (e.g. forks, first-boot previews)
 * rather than crashing at module load.
 */
export function safeParseEnv(raw: unknown): Env | null {
  const result = envSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Validated, strongly-typed view of `import.meta.env`.
 *
 * `null` when required env vars are missing/malformed — consumers must
 * handle that case (see `firebase.ts#firebaseReady`).
 */
export const env: Env | null = safeParseEnv(import.meta.env);
