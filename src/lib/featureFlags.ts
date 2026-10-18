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

/**
 * Per-user tester override. When the signed-in uid is listed in the Firestore
 * doc config/featureTesters, services/featureTesters.ts stores that uid under
 * this key and reloads once; from then on every VITE_FEATURE_* flag reads as
 * on in this browser. Sign-out or a non-tester sign-in clears it.
 *
 * Client flags only hide UI, so a hand-edited key just shows screens whose
 * server calls still refuse non-testers (*_TESTER_UIDS / rules gate those).
 */
export const FEATURE_TESTER_STORAGE_KEY = "sh_feature_tester_uid";

export function isFeatureTesterOverrideActive(): boolean {
  try {
    return Boolean(globalThis.localStorage?.getItem(FEATURE_TESTER_STORAGE_KEY));
  } catch {
    return false;
  }
}

/** A VITE_FEATURE_* value is on when it is the literal "true" or this browser is a tester's. */
function flagOn(raw: unknown): boolean {
  return parseFlag(raw) || isFeatureTesterOverrideActive();
}

/** True when the Map / Clips feed / Verified Pro surfaces should render. */
export function isExtrasEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_EXTRAS_ENABLED);
}

/**
 * Roll Dice (street dice / C-Lo). Separate from the extras switch: it ships
 * off, and turning extras on must not surface it. Literal "true" only.
 */
export function isDiceEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_DICE_ENABLED);
}

/**
 * Skate Runner (/play/runner). Separate from the extras switch and from
 * S.K.A.T.E. scores. Literal "true" only — a missing env var cannot ship it.
 */
export function isRunnerEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_RUNNER_ENABLED);
}

/**
 * XP, levels, and the achievements ribbon. Separate from the extras switch:
 * extras are already on in production, and turning them on must not surface
 * levels. Literal "true" only. The server switch is XP_ENABLED.
 */
export function isXpEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_XP_ENABLED);
}

/**
 * Sign in with Apple. Off until the Firebase Apple provider is enabled.
 * Literal "true" only — the website and Android stay on Google + email
 * until then. The iOS store build sets this so App Review sees the button.
 */
export function isAppleSignInEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_APPLE_SIGNIN_ENABLED);
}

/**
 * Nominating a referee on a NEW game. Off for launch simplicity: every new
 * dispute goes to the community vote (pendingReview → communityReview).
 * Literal "true" only. Existing games that already have a judge are
 * unaffected — this flag is read only at create time.
 */
export function isRefereeEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_REFEREE_ENABLED);
}

/**
 * Searchable trick picker. Off until the catalog has been tried on a phone.
 * Literal "true" only. While off, setters still type a trick name and no
 * structured trick fields are required.
 */
export function isTrickPickerEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_TRICK_PICKER_ENABLED);
}

/**
 * Public-clip moderation. Off until the Video Intelligence function is
 * deployed. Anything except the literal string "true" keeps uploads
 * visible immediately, which is today's behavior.
 */
export function isClipModerationEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_CLIP_MODERATION_ENABLED);
}

/**
 * Pro profile showcase (hero, bio, sponsors, signature tricks, "Play a pro")
 * and the admin Pro tools tab. Off in production; while off, admins still see
 * it so the content can be reviewed before it goes public. Literal "true" only.
 */
export function isProProfilesEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_PRO_PROFILES);
}

/**
 * What's That Trick (WTT) — Name It mode in the clips feed. Off until
 * option generation and vote tallying are tested. Literal "true" only.
 * Server switch: WTT_ENABLED / WTT_TESTER_UIDS.
 */
export function isWttEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_WTT_ENABLED);
}

/**
 * Post your makes from GameOver screen. Off until consent flow is tested.
 * Literal "true" only.
 */
export function isPostMakesEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_POST_MAKES_ENABLED);
}

/**
 * Feed mode switcher (Scroll / Name It / Vote / Judge). Off until modes
 * are implemented and tested. Literal "true" only.
 */
export function isFeedModesEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_FEED_MODES_ENABLED);
}

/**
 * Pro blessing: a verified pro turns another skater pro (the only non-admin
 * way to get the badge). Off by default; the proBlessing callable has its own
 * server switch (PRO_BLESSING_ENABLED / PRO_BLESSING_TESTER_UIDS), which is
 * the real gate. Literal "true" only.
 */
export function isProBlessingEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_PRO_BLESSING);
}

/**
 * Closet: earned + purchased items, limited drops, trading, Hubba Bucks.
 * Off by default; the server switches (CLOSET_ENABLED, CLOSET_DROPS_ENABLED,
 * CLOSET_TRADING_ENABLED, CLOSET_BUCKS_PURCHASE_ENABLED) are the real gates.
 * Traction gate: 100 finished games before public launch (plan §13).
 * Literal "true" only.
 */
export function isClosetEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_CLOSET_ENABLED);
}

export function isClosetDropsEnabled(): boolean {
  return isClosetEnabled() && flagOn(import.meta.env.VITE_FEATURE_CLOSET_DROPS_ENABLED);
}

export function isClosetTradingEnabled(): boolean {
  return isClosetEnabled() && flagOn(import.meta.env.VITE_FEATURE_CLOSET_TRADING_ENABLED);
}

export function isClosetBucksPurchaseEnabled(): boolean {
  return isClosetEnabled() && flagOn(import.meta.env.VITE_FEATURE_CLOSET_BUCKS_PURCHASE_ENABLED);
}

/**
 * Skate clip editor: speed ramps, landing-marker trim, VX/VHS looks, color
 * presets, line cuts, trick captions, beat-synced music, skate SFX and
 * full-quality export (native AVFoundation on iOS). Literal "true" only.
 */
export function isClipEditorEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_CLIP_EDITOR);
}

/**
 * SMS 2FA enrollment. Off by default; when on, email/password users can enroll
 * SMS as a second factor in Settings (via phone number). Never shown to
 * Google/Apple users (they already have 2-step from their IdP). Literal "true" only.
 */
export function isSms2faEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_SMS_2FA_ENABLED);
}

/**
 * Pro camera features: 4K60, 120/240fps slow-mo, lens switching (0.5x/1x/2x),
 * tap-to-focus with AE/AF lock, quality selector, cinematic stabilization,
 * thermal management, 2.5s pre-roll buffer, native AVFoundation fisheye,
 * and performance metrics. Literal "true" only; off by default.
 */
export function isProCameraEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_PRO_CAMERA);
}

/**
 * Spot group chats. Off by default; when on, each spot gets a group chat with
 * moderation (report, block, word filter, rate limits). Literal "true" only.
 */
export function isSpotChatsEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_SPOT_CHATS_ENABLED);
}

/** Profile banner (background) photo on the profile screen. Literal "true" only; off by default. */
export function isProfileBannerEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_PROFILE_BANNER);
}

/**
 * Customizable profiles: theme colors + gradient, banner crop, section
 * order, pinned clips, closet showcase, links/sponsors, favorite tricks,
 * theme song. Builds on the profile banner. Literal "true" only; off by default.
 */
export function isProfileCustomEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_PROFILE_CUSTOM);
}

/**
 * Closet Studio: paint-style clothes editor for the avatar (fill, brush,
 * eraser, layers, symmetry, stickers, text, import). Mike White designs are
 * the starter templates. Literal "true" only; off by default. See
 * docs/CLOSET_STUDIO.md.
 */
export function isClosetStudioEnabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_CLOSET_STUDIO);
}

/**
 * 360 shoe viewer for signature shoes (item detail + profile showcase).
 * Literal "true" only; off by default. Testers get it via the override.
 */
export function isShoe360Enabled(): boolean {
  return flagOn(import.meta.env.VITE_FEATURE_SHOE_360);
}
