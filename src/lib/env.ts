import "./zodJitless";
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
  // Treat empty string as absent — Vercel exposes unset env vars as "" not undefined.
  VITE_RECAPTCHA_SITE_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Operator opt-in for App Check. Set to "true" in Vercel to turn on
  // initializeAppCheck() — reCAPTCHA v3 + Firebase App Check integration.
  // DEFAULTS TO OFF because an App Check enforcement misconfiguration
  // (Firebase Console setting flipped without the reCAPTCHA domain allowlist
  // being updated) will silently reject every Firestore read with
  // permission-denied and lock every signed-in user out of the app. Leaving
  // it off by default keeps the product usable; re-enable once the
  // Firebase Console + reCAPTCHA admin config is verified per
  // docs/PERMISSION_DENIED_RUNBOOK.md.
  VITE_APPCHECK_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Web-only App Check for the closet callables, used while the sitewide
  // switch above is off. "lazy" (the default) starts App Check only when a
  // closet action is about to call the server, so no other page loads
  // reCAPTCHA. "off" never starts it on web, and every closet call is then
  // rejected by the server. Ignored when VITE_APPCHECK_ENABLED is "true" and
  // in the native apps. See docs/APPCHECK_ROLLOUT.md.
  VITE_APPCHECK_WEB_MODE: z
    .string()
    .optional()
    .transform((v): "lazy" | "off" => (v === "off" ? "off" : "lazy")),

  // Extras switch for the Map, Clips feed and Verified Pro surfaces.
  // DEFAULTS TO OFF — only the literal string "true" re-enables them. Read at
  // call sites via isExtrasEnabled() in src/lib/featureFlags.ts.
  VITE_FEATURE_EXTRAS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Roll Dice (C-Lo). DEFAULTS TO OFF, and it is not part of the extras
  // switch. Read at call sites via isDiceEnabled() in src/lib/featureFlags.ts.
  VITE_FEATURE_DICE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Pro profile showcase + pro tools review UI. DEFAULTS TO OFF. Admins see
  // it regardless (review mode). Read via isProProfilesEnabled().
  VITE_FEATURE_PRO_PROFILES: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Pro blessing (pros turn other skaters pro). DEFAULTS TO OFF. Read via
  // isProBlessingEnabled(); the proBlessing callable has its own server gate.
  VITE_FEATURE_PRO_BLESSING: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // XP, levels, and the achievements ribbon. DEFAULTS TO OFF, and it is not
  // part of the extras switch. Read via isXpEnabled() in featureFlags.ts.
  VITE_FEATURE_XP_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Skate Runner (board-only grind game at /play/runner). DEFAULTS TO OFF.
  // Read via isRunnerEnabled() in featureFlags.ts.
  VITE_FEATURE_RUNNER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  // Closet: earned + purchased items, limited drops, trading. DEFAULTS TO OFF.
  // Read via isClosetEnabled() in featureFlags.ts. Traction gate: 100 finished
  // games (plan §13). Server switches: CLOSET_ENABLED, CLOSET_DROPS_ENABLED,
  // CLOSET_TRADING_ENABLED, CLOSET_BUCKS_PURCHASE_ENABLED.
  VITE_FEATURE_CLOSET_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  VITE_FEATURE_CLOSET_DROPS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  VITE_FEATURE_CLOSET_TRADING_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  VITE_FEATURE_CLOSET_BUCKS_PURCHASE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  VITE_FEATURE_SHOE_360: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  VITE_FEATURE_MAP_CHECKINS: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  VITE_FEATURE_SPOT_PRESENCE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  VITE_FEATURE_TIPS: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  VITE_FEATURE_TURN_LENGTH: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Sign in with Apple button. DEFAULTS TO OFF until the Firebase Apple
  // provider is enabled. Read via isAppleSignInEnabled() in featureFlags.ts.
  VITE_FEATURE_APPLE_SIGNIN_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Searchable trick picker. DEFAULTS TO OFF. Read via isTrickPickerEnabled().
  VITE_FEATURE_TRICK_PICKER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Referee nomination on new games. DEFAULTS TO OFF so a missing env var
  // cannot put a judge on a new game. Read via isRefereeEnabled().
  VITE_FEATURE_REFEREE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Public-clip moderation. DEFAULTS TO OFF until the server function is
  // deployed. Read via isClipModerationEnabled() in featureFlags.ts.
  VITE_FEATURE_CLIP_MODERATION_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Spot group chats. DEFAULTS TO OFF. Read via isSpotChatsEnabled().
  VITE_FEATURE_SPOT_CHATS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Admin console: bans list, user search, feature switches viewer (admin claim only). DEFAULTS TO OFF. Read via isAdminConsoleEnabled().
  VITE_FEATURE_ADMIN_CONSOLE: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Admin ops: disputes queue with final ruling + admin audit log (admin claim only). DEFAULTS TO OFF. Read via isAdminOpsEnabled().
  VITE_FEATURE_ADMIN_OPS: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Pro review queue + gold clip authoring for verified pros (never admin powers). DEFAULTS TO OFF. Read via isProCallsEnabled().
  VITE_FEATURE_PRO_CALLS: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Pro challenges, pro props and pro-featured clips (verified pros only, never admin powers). DEFAULTS TO OFF. Read via isProCommunityEnabled().
  VITE_FEATURE_PRO_COMMUNITY: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Admin analytics and announcements (in-app banner + push). Admin-claim only. DEFAULTS TO OFF. Read via isAdminInsightsEnabled().
  VITE_FEATURE_ADMIN_INSIGHTS: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Customizable profiles. DEFAULTS TO OFF. Read via isProfileCustomEnabled().
  VITE_FEATURE_PROFILE_CUSTOM: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Pro Clip Reel + Pro Spots. DEFAULTS TO OFF. Read via isProShowcaseEnabled().
  VITE_FEATURE_PRO_SHOWCASE: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Closet Studio clothes editor. DEFAULTS TO OFF. Read via isClosetStudioEnabled().
  VITE_FEATURE_CLOSET_STUDIO: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Skate clip editor (speed ramps, looks, music, SFX, 4K export). DEFAULTS
  // TO OFF. Read via isClipEditorEnabled() in featureFlags.ts.
  VITE_FEATURE_CLIP_EDITOR: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // ── Optional: third-party integrations ──────────────────────────────
  VITE_MAPBOX_TOKEN: z.string().optional(),
  // Format validation (mapbox://styles/ prefix or https URL) deliberately
  // lives in src/lib/mapbox.ts, not here: an invalid override should fall
  // back to the default dark style with a Sentry warning, not trip
  // safeParseEnv → null → the "Setup Required" lockout for an opt-in
  // cosmetic flag.
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
