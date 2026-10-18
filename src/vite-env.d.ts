/// <reference types="vite/client" />

interface ContactInfo {
  name?: string[];
  email?: string[];
  tel?: string[];
}

interface ContactsManager {
  select(properties: string[], options?: { multiple?: boolean }): Promise<ContactInfo[]>;
  getProperties(): Promise<string[]>;
}

interface Navigator {
  contacts?: ContactsManager;
}

/** Optical zoom. Not in the DOM lib this project typechecks against. */
interface MediaTrackCapabilities {
  zoom?: DoubleRange;
}

interface MediaTrackConstraintSet {
  zoom?: ConstrainDouble;
}

interface MediaTrackSettings {
  zoom?: number;
}

interface Window {
  /** Set by public/lcp-shell.js when a pre-JS shell is on screen. */
  __skatehubbaLcpShell?: "home" | "auth" | "feed";
}

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FIREBASE_VAPID_KEY?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
  /** Opt-in switch for App Check enforcement. Parsed by zod in src/lib/env.ts;
   *  declared here so direct `import.meta.env.VITE_APPCHECK_ENABLED` reads
   *  remain typed. Keep in sync with src/lib/env.ts. */
  readonly VITE_APPCHECK_ENABLED?: string;
  /** Feature-freeze switch: "true" shows Map / Clips feed / Verified Pro.
   *  Unset (default) hides them. Read via src/lib/featureFlags.ts. */
  readonly VITE_FEATURE_EXTRAS_ENABLED?: string;
  /** Roll Dice switch: "true" shows /dice. Unset (default) hides it.
   *  Read via isDiceEnabled() — not the extras flag. */
  readonly VITE_FEATURE_DICE_ENABLED?: string;
  readonly VITE_FEATURE_PRO_PROFILES?: string;
  /** Pro blessing switch. Read via isProBlessingEnabled(). */
  readonly VITE_FEATURE_PRO_BLESSING?: string;
  /** XP and levels switch: "true" shows the chip, bar, level-up, and ribbon.
   *  Unset (default) hides them. Read via isXpEnabled() — not the extras flag. */
  readonly VITE_FEATURE_XP_ENABLED?: string;
  /** Skate Runner switch: "true" shows /play/runner and the lobby card.
   *  Unset (default) hides them. Read via isRunnerEnabled(). */
  readonly VITE_FEATURE_RUNNER_ENABLED?: string;

  /**
   * Closet (earned + purchased items, drops, trading) flag.
   * DEFAULTS TO OFF; literal "true" only. Server switch is CLOSET_ENABLED.
   * Plan: ../uploads/closet-drops-plan.md.
   */
  readonly VITE_FEATURE_CLOSET_ENABLED?: string;
  readonly VITE_FEATURE_CLOSET_DROPS_ENABLED?: string;
  readonly VITE_FEATURE_CLOSET_TRADING_ENABLED?: string;
  readonly VITE_FEATURE_CLOSET_BUCKS_PURCHASE_ENABLED?: string;
  readonly VITE_FEATURE_SHOE_360?: string;
  /** Sign in with Apple switch: "true" shows the button. Unset (default)
   *  hides it. Read via isAppleSignInEnabled(). */
  readonly VITE_FEATURE_APPLE_SIGNIN_ENABLED?: string;
  /** Trick picker switch: "true" replaces the free-text trick name. Unset
   *  (default) keeps the text field. Read via isTrickPickerEnabled(). */
  readonly VITE_FEATURE_TRICK_PICKER_ENABLED?: string;
  /** WTT (What's That Trick) switch: "true" enables Name It mode. Unset
   *  (default) hides it. Read via isWttEnabled(). */
  readonly VITE_FEATURE_WTT_ENABLED?: string;
  /** Feed modes switch: "true" shows Scroll / Name It / Vote / Judge toggle.
   *  Unset (default) keeps today's feed. Read via isFeedModesEnabled(). */
  readonly VITE_FEATURE_FEED_MODES_ENABLED?: string;
  /** Post your makes switch: "true" shows GameOver post flow. Unset (default)
   *  hides it. Read via isPostMakesEnabled(). */
  readonly VITE_FEATURE_POST_MAKES_ENABLED?: string;
  /** Referee nomination on new games: "true" shows the picker and lets
   *  createGame stamp a judge. Unset (default) forces the honor system.
   *  Read via isRefereeEnabled(). Does not affect games that already have one. */
  readonly VITE_FEATURE_REFEREE_ENABLED?: string;
  /** Public-clip moderation. "true" starts user uploads as pending.
   *  Unset (default) leaves uploads visible immediately. */
  readonly VITE_FEATURE_CLIP_MODERATION_ENABLED?: string;
  /** Spot group chats. "true" lets the UI surface per-spot chat rooms.
   *  Unset (default) hides them. Read via isSpotChatsEnabled(). */
  readonly VITE_FEATURE_SPOT_CHATS_ENABLED?: string;
  /** Skate clip editor. Literal "true" only; off by default. */
  readonly VITE_FEATURE_CLIP_EDITOR?: string;
  /** SMS 2FA enrollment. "true" shows SMS enrollment in Settings for email/password
   *  users. Unset (default) hides it. Read via isSms2faEnabled(). */
  readonly VITE_FEATURE_SMS_2FA_ENABLED?: string;
  /** Pro camera features (4K60, 120/240fps, lens switching, pre-roll, thermal mgmt).
   *  Literal "true" only; off by default. Read via isProCameraEnabled(). */
  readonly VITE_FEATURE_PRO_CAMERA?: string;
  readonly VITE_FEATURE_PROFILE_BANNER?: string;
  readonly VITE_FEATURE_PROFILE_CUSTOM?: string;
  /** Admin console: bans list, user search, feature switches viewer (admin claim only). Literal "true" only; off by default. */
  readonly VITE_FEATURE_ADMIN_CONSOLE?: string;
  /** Pro Clip Reel + Pro Spots. Literal "true" only; off by default. */
  readonly VITE_FEATURE_PRO_SHOWCASE?: string;
  /** Closet Studio clothes editor. Literal "true" only; off by default. */
  readonly VITE_FEATURE_CLOSET_STUDIO?: string;
  readonly VITE_MAPBOX_TOKEN?: string;
  /** Optional Mapbox Studio style URL. Falls back to mapbox://styles/mapbox/dark-v11. */
  readonly VITE_MAPBOX_STYLE_URL?: string;
  readonly VITE_USE_EMULATORS?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
  /** PostHog project API key (phc_...). Analytics is a no-op when absent. */
  readonly VITE_POSTHOG_KEY?: string;
  /** PostHog host URL. Defaults to https://us.i.posthog.com. */
  readonly VITE_POSTHOG_HOST?: string;
  /** Release tag stamped into Sentry + PostHog at build time. */
  readonly VITE_APP_VERSION?: string;
  /** Git commit SHA from the Vercel build environment. */
  readonly VITE_GIT_SHA?: string;
  readonly VERCEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
