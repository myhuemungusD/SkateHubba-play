import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAppleSignInEnabled,
  isClipEditorEnabled,
  isClosetStudioEnabled,
  isClipModerationEnabled,
  isDiceEnabled,
  isExtrasEnabled,
  isProCameraEnabled,
  isProfileBannerEnabled,
  isProfileCustomEnabled,
  isAdminInsightsEnabled,
  isProCommunityEnabled,
  isProCallsEnabled,
  isAdminOpsEnabled,
  isAdminConsoleEnabled,
  isProShowcaseEnabled,
  FEATURE_TESTER_STORAGE_KEY,
  isRefereeEnabled,
  isSpotChatsEnabled,
  isRunnerEnabled,
  isTrickPickerEnabled,
  isXpEnabled,
  parseFlag,
} from "../featureFlags";

describe("isSpotChatsEnabled (VITE_FEATURE_SPOT_CHATS_ENABLED)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to off so chats stay hidden without the env var", () => {
    expect(import.meta.env.VITE_FEATURE_SPOT_CHATS_ENABLED).toBeUndefined();
    expect(isSpotChatsEnabled()).toBe(false);
  });

  it.each([
    ["1", false],
    ["yes", false],
    ["True", false],
    ["true", true],
  ])("parses %j as %s", (raw, expected) => {
    vi.stubEnv("VITE_FEATURE_SPOT_CHATS_ENABLED", raw);
    expect(isSpotChatsEnabled()).toBe(expected);
  });
});

describe("parseFlag", () => {
  it("accepts only the literal string 'true'", () => {
    expect(parseFlag("true")).toBe(true);
  });

  it.each([undefined, null, "", "false", "TRUE", "True", "1", "yes", true])("treats %j as off", (raw) => {
    // A typo or a boolean-ish value in the Vercel UI must never resurface a
    // frozen feature — same strict contract as VITE_APPCHECK_ENABLED.
    expect(parseFlag(raw)).toBe(false);
  });
});

describe("isExtrasEnabled (VITE_FEATURE_EXTRAS_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF when the env var is unset — the production default", () => {
    expect(import.meta.env.VITE_FEATURE_EXTRAS_ENABLED).toBeUndefined();
    expect(isExtrasEnabled()).toBe(false);
  });

  it("is OFF when the env var is an empty string (how Vercel exposes unset vars)", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "");
    expect(isExtrasEnabled()).toBe(false);
  });

  it("is ON when the env var is 'true'", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    expect(isExtrasEnabled()).toBe(true);
  });

  it("re-reads the env on every call so the flag can flip without a reload in tests", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    expect(isExtrasEnabled()).toBe(true);
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "false");
    expect(isExtrasEnabled()).toBe(false);
  });
});

describe("isDiceEnabled (VITE_FEATURE_DICE_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF when the env var is unset — the production default", () => {
    expect(import.meta.env.VITE_FEATURE_DICE_ENABLED).toBeUndefined();
    expect(isDiceEnabled()).toBe(false);
  });

  it("stays off for anything other than the literal string true", () => {
    vi.stubEnv("VITE_FEATURE_DICE_ENABLED", "TRUE");
    expect(isDiceEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_DICE_ENABLED", "true");
    expect(isDiceEnabled()).toBe(true);
  });

  it("does not follow the extras flag", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    expect(isDiceEnabled()).toBe(false);
  });
});

describe("isRunnerEnabled (VITE_FEATURE_RUNNER_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF when the env var is unset — the production default", () => {
    expect(import.meta.env.VITE_FEATURE_RUNNER_ENABLED).toBeUndefined();
    expect(isRunnerEnabled()).toBe(false);
  });

  it("stays off for anything other than the literal string true", () => {
    vi.stubEnv("VITE_FEATURE_RUNNER_ENABLED", "TRUE");
    expect(isRunnerEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_RUNNER_ENABLED", "true");
    expect(isRunnerEnabled()).toBe(true);
  });

  it("does not follow the extras or dice flags", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    vi.stubEnv("VITE_FEATURE_DICE_ENABLED", "true");
    expect(isRunnerEnabled()).toBe(false);
  });
});

describe("isXpEnabled (VITE_FEATURE_XP_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF when the env var is unset — the production default", () => {
    expect(import.meta.env.VITE_FEATURE_XP_ENABLED).toBeUndefined();
    expect(isXpEnabled()).toBe(false);
  });

  it("stays off for anything other than the literal string true", () => {
    vi.stubEnv("VITE_FEATURE_XP_ENABLED", "TRUE");
    expect(isXpEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_XP_ENABLED", "true");
    expect(isXpEnabled()).toBe(true);
  });

  it("does not follow the extras flag", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    expect(isXpEnabled()).toBe(false);
  });
});

describe("isAppleSignInEnabled (VITE_FEATURE_APPLE_SIGNIN_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF when the env var is unset — the production default", () => {
    expect(import.meta.env.VITE_FEATURE_APPLE_SIGNIN_ENABLED).toBeUndefined();
    expect(isAppleSignInEnabled()).toBe(false);
  });

  it("stays off for anything other than the literal string true", () => {
    vi.stubEnv("VITE_FEATURE_APPLE_SIGNIN_ENABLED", "TRUE");
    expect(isAppleSignInEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_APPLE_SIGNIN_ENABLED", "");
    expect(isAppleSignInEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_APPLE_SIGNIN_ENABLED", "true");
    expect(isAppleSignInEnabled()).toBe(true);
  });

  it("does not follow the extras or dice flags", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    vi.stubEnv("VITE_FEATURE_DICE_ENABLED", "true");
    expect(isAppleSignInEnabled()).toBe(false);
  });
});

describe("isRefereeEnabled (VITE_FEATURE_REFEREE_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF when the env var is unset — the production default", () => {
    expect(import.meta.env.VITE_FEATURE_REFEREE_ENABLED).toBeUndefined();
    expect(isRefereeEnabled()).toBe(false);
  });

  it("stays off for anything other than the literal string true", () => {
    vi.stubEnv("VITE_FEATURE_REFEREE_ENABLED", "TRUE");
    expect(isRefereeEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_REFEREE_ENABLED", "");
    expect(isRefereeEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_REFEREE_ENABLED", "false");
    expect(isRefereeEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_REFEREE_ENABLED", "true");
    expect(isRefereeEnabled()).toBe(true);
  });

  it("does not follow the extras, dice, or apple flags", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    vi.stubEnv("VITE_FEATURE_DICE_ENABLED", "true");
    vi.stubEnv("VITE_FEATURE_APPLE_SIGNIN_ENABLED", "true");
    expect(isRefereeEnabled()).toBe(false);
  });
});

describe("isClipModerationEnabled (VITE_FEATURE_CLIP_MODERATION_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF when the env var is unset — uploads stay visible", () => {
    expect(import.meta.env.VITE_FEATURE_CLIP_MODERATION_ENABLED).toBeUndefined();
    expect(isClipModerationEnabled()).toBe(false);
  });

  it("stays off for anything other than the literal string true", () => {
    vi.stubEnv("VITE_FEATURE_CLIP_MODERATION_ENABLED", "TRUE");
    expect(isClipModerationEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_CLIP_MODERATION_ENABLED", "true");
    expect(isClipModerationEnabled()).toBe(true);
  });
});

describe("isTrickPickerEnabled (VITE_FEATURE_TRICK_PICKER_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF when the env var is unset — the production default", () => {
    expect(import.meta.env.VITE_FEATURE_TRICK_PICKER_ENABLED).toBeUndefined();
    expect(isTrickPickerEnabled()).toBe(false);
  });

  it("stays off for anything other than the literal string true", () => {
    vi.stubEnv("VITE_FEATURE_TRICK_PICKER_ENABLED", "TRUE");
    expect(isTrickPickerEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_TRICK_PICKER_ENABLED", "true");
    expect(isTrickPickerEnabled()).toBe(true);
  });

  it("does not follow the other feature flags", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    vi.stubEnv("VITE_FEATURE_REFEREE_ENABLED", "true");
    expect(isTrickPickerEnabled()).toBe(false);
  });
});

describe("isClipEditorEnabled (VITE_FEATURE_CLIP_EDITOR)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF when the env var is unset", () => {
    expect(import.meta.env.VITE_FEATURE_CLIP_EDITOR).toBeUndefined();
    expect(isClipEditorEnabled()).toBe(false);
  });

  it("stays off for anything other than the literal string true", () => {
    vi.stubEnv("VITE_FEATURE_CLIP_EDITOR", "1");
    expect(isClipEditorEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_CLIP_EDITOR", "true");
    expect(isClipEditorEnabled()).toBe(true);
  });
});

describe("isProCameraEnabled (VITE_FEATURE_PRO_CAMERA)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is OFF when the env var is unset", () => {
    expect(import.meta.env.VITE_FEATURE_PRO_CAMERA).toBeUndefined();
    expect(isProCameraEnabled()).toBe(false);
  });

  it("stays off for anything other than the literal string true", () => {
    vi.stubEnv("VITE_FEATURE_PRO_CAMERA", "TRUE");
    expect(isProCameraEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_PRO_CAMERA", "enabled");
    expect(isProCameraEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_PRO_CAMERA", "true");
    expect(isProCameraEnabled()).toBe(true);
  });
});

describe("isProfileBannerEnabled (VITE_FEATURE_PROFILE_BANNER)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off unless the env var is the literal string true", () => {
    expect(isProfileBannerEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_PROFILE_BANNER", "TRUE");
    expect(isProfileBannerEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_PROFILE_BANNER", "true");
    expect(isProfileBannerEnabled()).toBe(true);
  });
});

describe("isProfileCustomEnabled (VITE_FEATURE_PROFILE_CUSTOM)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off unless the env var is the literal string true", () => {
    expect(isProfileCustomEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_PROFILE_CUSTOM", "1");
    expect(isProfileCustomEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_PROFILE_CUSTOM", "true");
    expect(isProfileCustomEnabled()).toBe(true);
  });

  it("turns on for a feature tester", () => {
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "u1");
    try {
      expect(isProfileCustomEnabled()).toBe(true);
    } finally {
      localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
    }
  });
});

describe("isSpotChatsEnabled tester override", () => {
  it("turns on for a feature tester", () => {
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "u1");
    try {
      expect(isSpotChatsEnabled()).toBe(true);
    } finally {
      localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
    }
  });
});

describe("isClosetStudioEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off unless the env var is the literal string true", () => {
    expect(isClosetStudioEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_CLOSET_STUDIO", "1");
    expect(isClosetStudioEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_CLOSET_STUDIO", "true");
    expect(isClosetStudioEnabled()).toBe(true);
  });

  it("turns on for a feature tester", () => {
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "u1");
    try {
      expect(isClosetStudioEnabled()).toBe(true);
    } finally {
      localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
    }
  });
});

describe("isShoe360Enabled", () => {
  it("is on only for the literal true", async () => {
    const { isShoe360Enabled } = await import("../featureFlags");
    vi.stubEnv("VITE_FEATURE_SHOE_360", "true");
    expect(isShoe360Enabled()).toBe(true);
    vi.stubEnv("VITE_FEATURE_SHOE_360", "1");
    expect(isShoe360Enabled()).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("isSpotPresenceEnabled", () => {
  it("is on only for the literal true", async () => {
    const { isSpotPresenceEnabled } = await import("../featureFlags");
    vi.stubEnv("VITE_FEATURE_SPOT_PRESENCE", "true");
    expect(isSpotPresenceEnabled()).toBe(true);
    vi.stubEnv("VITE_FEATURE_SPOT_PRESENCE", "1");
    expect(isSpotPresenceEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("isMapCheckinsEnabled", () => {
  it("is on only for the literal true", async () => {
    const { isMapCheckinsEnabled } = await import("../featureFlags");
    vi.stubEnv("VITE_FEATURE_MAP_CHECKINS", "true");
    expect(isMapCheckinsEnabled()).toBe(true);
    vi.stubEnv("VITE_FEATURE_MAP_CHECKINS", "1");
    expect(isMapCheckinsEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("isProShowcaseEnabled (VITE_FEATURE_PRO_SHOWCASE)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
  });

  it("is off by default and on only for literal true", () => {
    expect(isProShowcaseEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_PRO_SHOWCASE", "1");
    expect(isProShowcaseEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_PRO_SHOWCASE", "true");
    expect(isProShowcaseEnabled()).toBe(true);
  });

  it("turns on for a feature tester", () => {
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "u1");
    expect(isProShowcaseEnabled()).toBe(true);
  });
});

describe("isAdminConsoleEnabled (VITE_FEATURE_ADMIN_CONSOLE)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
  });
  it("is off by default and on only for literal true", () => {
    expect(isAdminConsoleEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_ADMIN_CONSOLE", "1");
    expect(isAdminConsoleEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_ADMIN_CONSOLE", "true");
    expect(isAdminConsoleEnabled()).toBe(true);
  });
  it("turns on for a feature tester", () => {
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "u1");
    expect(isAdminConsoleEnabled()).toBe(true);
  });
});

describe("isAdminOpsEnabled (VITE_FEATURE_ADMIN_OPS)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
  });
  it("is off by default and on only for literal true", () => {
    expect(isAdminOpsEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_ADMIN_OPS", "1");
    expect(isAdminOpsEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_ADMIN_OPS", "true");
    expect(isAdminOpsEnabled()).toBe(true);
  });
  it("turns on for a feature tester", () => {
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "u1");
    expect(isAdminOpsEnabled()).toBe(true);
  });
});

describe("isProCallsEnabled (VITE_FEATURE_PRO_CALLS)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
  });
  it("is off by default and on only for literal true", () => {
    expect(isProCallsEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_PRO_CALLS", "1");
    expect(isProCallsEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_PRO_CALLS", "true");
    expect(isProCallsEnabled()).toBe(true);
  });
  it("turns on for a feature tester", () => {
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "u1");
    expect(isProCallsEnabled()).toBe(true);
  });
});

describe("isProCommunityEnabled (VITE_FEATURE_PRO_COMMUNITY)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
  });
  it("is off by default and on only for literal true", () => {
    expect(isProCommunityEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_PRO_COMMUNITY", "1");
    expect(isProCommunityEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_PRO_COMMUNITY", "true");
    expect(isProCommunityEnabled()).toBe(true);
  });
  it("turns on for a feature tester", () => {
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "u1");
    expect(isProCommunityEnabled()).toBe(true);
  });
});

describe("isAdminInsightsEnabled (VITE_FEATURE_ADMIN_INSIGHTS)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
  });
  it("is off by default and on only for literal true", () => {
    expect(isAdminInsightsEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_ADMIN_INSIGHTS", "1");
    expect(isAdminInsightsEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_ADMIN_INSIGHTS", "true");
    expect(isAdminInsightsEnabled()).toBe(true);
  });
  it("turns on for a feature tester", () => {
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "u1");
    expect(isAdminInsightsEnabled()).toBe(true);
  });
});

describe("isTurnLengthEnabled (VITE_FEATURE_TURN_LENGTH)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
  });
  it("is off by default and on only for literal true", async () => {
    const { isTurnLengthEnabled } = await import("../featureFlags");
    expect(isTurnLengthEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_TURN_LENGTH", "1");
    expect(isTurnLengthEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_TURN_LENGTH", "true");
    expect(isTurnLengthEnabled()).toBe(true);
  });
  it("turns on for a feature tester (Jason and Mike via config/featureTesters)", async () => {
    const { isTurnLengthEnabled } = await import("../featureFlags");
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "DVpY1kJYXsYEJN8j3jr3r0wITl72");
    expect(isTurnLengthEnabled()).toBe(true);
  });
});

describe("isRandomChallengerEnabled (VITE_FEATURE_RANDOM_CHALLENGER)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
  });
  it("is off by default and on only for literal true", async () => {
    const { isRandomChallengerEnabled } = await import("../featureFlags");
    expect(isRandomChallengerEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_RANDOM_CHALLENGER", "1");
    expect(isRandomChallengerEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_RANDOM_CHALLENGER", "true");
    expect(isRandomChallengerEnabled()).toBe(true);
  });
});

describe("isFeedShareEnabled (VITE_FEATURE_FEED_SHARE)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
  });
  it("is off by default and on only for literal true", async () => {
    const { isFeedShareEnabled } = await import("../featureFlags");
    expect(isFeedShareEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_FEED_SHARE", "1");
    expect(isFeedShareEnabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_FEED_SHARE", "true");
    expect(isFeedShareEnabled()).toBe(true);
  });
  it("turns on for a web tester", async () => {
    const { isFeedShareEnabled } = await import("../featureFlags");
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "tester-uid");
    expect(isFeedShareEnabled()).toBe(true);
  });
});

describe("isLandingV2Enabled (VITE_FEATURE_LANDING_V2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
  });
  it("is off by default and on only for literal true", async () => {
    const { isLandingV2Enabled } = await import("../featureFlags");
    expect(isLandingV2Enabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_LANDING_V2", "1");
    expect(isLandingV2Enabled()).toBe(false);
    vi.stubEnv("VITE_FEATURE_LANDING_V2", "true");
    expect(isLandingV2Enabled()).toBe(true);
  });
  it("turns on for a web tester", async () => {
    const { isLandingV2Enabled } = await import("../featureFlags");
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "tester-uid");
    expect(isLandingV2Enabled()).toBe(true);
  });
});

describe("tester override in native store builds (App Store 2.3.1)", () => {
  afterEach(() => {
    localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
    delete (globalThis as { Capacitor?: unknown }).Capacitor;
  });

  it("turns flags on for a tester on the web", () => {
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "uid-1");
    expect(isDiceEnabled()).toBe(true);
  });

  it("never unlocks hidden features inside the iOS/Android shell", () => {
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "uid-1");
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    expect(isDiceEnabled()).toBe(false);
    expect(isRunnerEnabled()).toBe(false);
  });

  it("still honors the override when Capacitor reports a web platform", () => {
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "uid-1");
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => false };
    expect(isDiceEnabled()).toBe(true);
  });
});
