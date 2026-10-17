/**
 * Build-time feature flags.
 *
 * Extras switch. The launch feature freeze was lifted 2026-10-10: the spot
 * Map (/map, /spots/:id), the Clips feed (/feed) and Verified Pro (badge +
 * admin grant panel) are live in production, where Vercel sets
 * VITE_FEATURE_EXTRAS_ENABLED=true (Production + Preview). ONE switch:
 *
 *   VITE_FEATURE_EXTRAS_ENABLED=true   → extras visible (production)
 *   unset / anything else              → extras hidden (code default)
 *
 * Defaults to OFF so a missing Vercel env var fails closed to the core
 * game loop. Toggle by setting the var to the literal string "true" in the
 * Vercel project and redeploying (VITE_* values are inlined at build time).
 *
 * Read through a function rather than a module-level constant so tests can
 * flip it with `vi.stubEnv` without re-importing modules. In a production
 * build Vite statically replaces the `import.meta.env.*` access, so the
 * call is effectively a constant.
 *
 * Schema mirror lives in src/lib/env.ts + src/vite-env.d.ts — keep in sync.
 */

/** Strict "true"-only parse, matching VITE_APPCHECK_ENABLED's convention. */
export function parseFlag(raw: unknown): boolean {
  return raw === "true";
}

/** True when the Map / Clips feed / Verified Pro surfaces should render. */
export function isExtrasEnabled(): boolean {
  return parseFlag(import.meta.env.VITE_FEATURE_EXTRAS_ENABLED);
}

/**
 * Roll Dice (street dice / C-Lo). Separate from the extras switch: it ships
 * off, and turning extras on must not surface it. Literal "true" only.
 */
export function isDiceEnabled(): boolean {
  return parseFlag(import.meta.env.VITE_FEATURE_DICE_ENABLED);
}

/**
 * XP, levels, and the achievements ribbon. Separate from the extras switch:
 * extras are already on in production, and turning them on must not surface
 * levels. Literal "true" only. The server switch is XP_ENABLED.
 */
export function isXpEnabled(): boolean {
  return parseFlag(import.meta.env.VITE_FEATURE_XP_ENABLED);
}

/**
 * Sign in with Apple. Off until the Firebase Apple provider is enabled.
 * Literal "true" only — the website and Android stay on Google + email
 * until then. The iOS store build sets this so App Review sees the button.
 */
export function isAppleSignInEnabled(): boolean {
  return parseFlag(import.meta.env.VITE_FEATURE_APPLE_SIGNIN_ENABLED);
}

/**
 * Nominating a referee on a NEW game. Off for launch simplicity: every new
 * dispute goes to the community vote (pendingReview → communityReview).
 * Literal "true" only. Existing games that already have a judge are
 * unaffected — this flag is read only at create time.
 */
export function isRefereeEnabled(): boolean {
  return parseFlag(import.meta.env.VITE_FEATURE_REFEREE_ENABLED);
}

/**
 * Public-clip moderation. Off until the Video Intelligence function is
 * deployed. Anything except the literal string "true" keeps uploads
 * visible immediately, which is today's behavior.
 */
export function isClipModerationEnabled(): boolean {
  return parseFlag(import.meta.env.VITE_FEATURE_CLIP_MODERATION_ENABLED);
}

/**
 * Pro profile showcase (hero, bio, sponsors, signature tricks, "Play a pro")
 * and the admin Pro tools tab. Off in production; while off, admins still see
 * it so the content can be reviewed before it goes public. Literal "true" only.
 */
export function isProProfilesEnabled(): boolean {
  return parseFlag(import.meta.env.VITE_FEATURE_PRO_PROFILES);
}

/**
 * Pro blessing: a verified pro turns another skater pro (the only non-admin
 * way to get the badge). Off by default; the proBlessing callable has its own
 * server switch (PRO_BLESSING_ENABLED / PRO_BLESSING_TESTER_UIDS), which is
 * the real gate. Literal "true" only.
 */
export function isProBlessingEnabled(): boolean {
  return parseFlag(import.meta.env.VITE_FEATURE_PRO_BLESSING);
}

/**
 * Spot group chats (per-spot chat rooms with moderation). Off by default and
 * independent of the extras switch: the rules ship with the service layer,
 * but no UI may surface chats until this is the literal "true".
 * See docs/SPOT_CHATS.md.
 */
export function isSpotChatsEnabled(): boolean {
  return parseFlag(import.meta.env.VITE_FEATURE_SPOT_CHATS_ENABLED);
}
