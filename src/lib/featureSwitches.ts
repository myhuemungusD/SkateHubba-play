/** Every client feature switch. Keep in sync with featureFlags.ts (a test checks). */
export const FEATURE_SWITCH_KEYS = [
  "VITE_FEATURE_ADMIN_CONSOLE",
  "VITE_FEATURE_APPLE_SIGNIN_ENABLED",
  "VITE_FEATURE_CLIP_EDITOR",
  "VITE_FEATURE_CLIP_MODERATION_ENABLED",
  "VITE_FEATURE_CLOSET_BUCKS_PURCHASE_ENABLED",
  "VITE_FEATURE_CLOSET_DROPS_ENABLED",
  "VITE_FEATURE_CLOSET_ENABLED",
  "VITE_FEATURE_CLOSET_STUDIO",
  "VITE_FEATURE_CLOSET_TRADING_ENABLED",
  "VITE_FEATURE_DICE_ENABLED",
  "VITE_FEATURE_EXTRAS_ENABLED",
  "VITE_FEATURE_FEED_MODES_ENABLED",
  "VITE_FEATURE_POST_MAKES_ENABLED",
  "VITE_FEATURE_PROFILE_BANNER",
  "VITE_FEATURE_PROFILE_CUSTOM",
  "VITE_FEATURE_PRO_BLESSING",
  "VITE_FEATURE_PRO_CAMERA",
  "VITE_FEATURE_PRO_PROFILES",
  "VITE_FEATURE_PRO_SHOWCASE",
  "VITE_FEATURE_REFEREE_ENABLED",
  "VITE_FEATURE_RUNNER_ENABLED",
  "VITE_FEATURE_SHOE_360",
  "VITE_FEATURE_SMS_2FA_ENABLED",
  "VITE_FEATURE_SPOT_CHATS_ENABLED",
  "VITE_FEATURE_TRICK_PICKER_ENABLED",
  "VITE_FEATURE_WTT_ENABLED",
  "VITE_FEATURE_XP_ENABLED",
  "VITE_FEATURE_ADMIN_OPS",
  "VITE_FEATURE_PRO_CALLS",
  "VITE_FEATURE_PRO_COMMUNITY",
] as const;

export interface FeatureSwitchState {
  key: string;
  /** Plain name, e.g. "PRO SHOWCASE". */
  label: string;
  /** On for everyone in this build (env var is the literal "true"). */
  on: boolean;
}

/** Build-time state of every switch, from the env this bundle was built with. */
export function readFeatureSwitches(env: Record<string, unknown> = import.meta.env): FeatureSwitchState[] {
  return FEATURE_SWITCH_KEYS.map((key) => ({
    key,
    label: key
      .replace(/^VITE_FEATURE_/, "")
      .replace(/_ENABLED$/, "")
      .replace(/_/g, " "),
    on: env[key] === "true",
  }));
}
