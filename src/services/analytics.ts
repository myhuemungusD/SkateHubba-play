/**
 * Lightweight analytics wrapper.
 *
 * Centralises event tracking so swapping or adding providers is a one-file
 * change. Events fan out to:
 *   1. Vercel Analytics — via `window.va`, injected by `<Analytics />` in
 *      main.tsx. Page views, lightweight custom events, zero cost on top of
 *      the existing Vercel platform.
 *   2. PostHog — via the lazy wrapper in `src/lib/posthog.ts`. Funnel
 *      analysis, cohorts, retention. Only active when `VITE_POSTHOG_KEY`
 *      is set at build time; otherwise the call is a no-op.
 *
 * Both destinations receive the same event name + properties. Providers
 * stay in sync because helpers below are the only surface components call.
 */
import { captureEvent as posthogCapture } from "../lib/posthog";
import { isAnalyticsAllowed } from "../lib/consent";
import { hashUid } from "../utils/pii";

type EventValue = string | number | boolean | null | undefined;
type EventProperties = Record<string, EventValue>;

/** Vercel Analytics injects `window.va` at runtime. */
interface WindowWithVa {
  va?: (command: string, payload: Record<string, unknown>) => void;
}

function sendToVercel(name: string, properties?: EventProperties): void {
  try {
    const w = window as unknown as WindowWithVa;
    if (typeof w.va === "function") {
      w.va("event", { name, ...properties });
    }
  } catch {
    // Analytics should never break the app.
  }
}

function sendToPosthog(name: string, properties?: EventProperties): void {
  try {
    posthogCapture(name, properties);
  } catch {
    // Analytics should never break the app.
  }
}

export function trackEvent(name: string, properties?: EventProperties): void {
  if (!isAnalyticsAllowed()) return;
  sendToVercel(name, properties);
  sendToPosthog(name, properties);
}

// Pre-defined event helpers for type safety. Keep event names stable —
// renaming breaks historical funnels in PostHog and makes dashboards lie.
export const analytics = {
  gameCreated: (gameId: string) => trackEvent("game_created", { gameId }),
  trickSet: (gameId: string, trickName: string) => trackEvent("trick_set", { gameId, trickName }),
  matchSubmitted: (gameId: string, landed: boolean) => trackEvent("match_submitted", { gameId, landed }),
  gameCompleted: (gameId: string, won: boolean) => trackEvent("game_completed", { gameId, won }),
  videoUploaded: (durationMs: number, sizeBytes: number) => trackEvent("video_uploaded", { durationMs, sizeBytes }),
  signUp: (method: string) => trackEvent("sign_up", { method }),
  signIn: (method: string) => trackEvent("sign_in", { method }),
  // ── Auth funnel denominators for outage detection ─────────────────────
  // Paired with signUp/signIn above, these let dashboards compute
  // success-rate ratios and alert when the rate cliff-drops. Without the
  // attempt counter we only see the numerator, so a 100% failure rate is
  // indistinguishable from zero traffic.
  signInAttempt: (method: string) => trackEvent("sign_in_attempt", { method }),
  signInFailure: (method: string, code: string) => trackEvent("sign_in_failure", { method, code }),
  signUpAttempt: (method: string) => trackEvent("sign_up_attempt", { method }),
  signUpFailure: (method: string, code: string) => trackEvent("sign_up_failure", { method, code }),
  // ── Map funnel ────────────────────────────────────────────────────────
  /** Top of funnel — fires once per MapPage mount. */
  mapViewed: () => trackEvent("map_viewed"),
  /** Fired when a user taps a marker and the SpotPreviewCard opens. */
  spotPreviewed: (spotId: string) => trackEvent("spot_previewed", { spotId }),
  /** Fired when ChallengeScreen mounts with a valid ?spot= URL param. */
  challengeFromSpot: (spotId: string) => trackEvent("challenge_from_spot", { spotId }),
  // ── Landing map teaser (marketing top-of-funnel) ──────────────────────
  /**
   * Fires once when the landing-page map teaser actually mounts (gated by
   * IntersectionObserver in Landing.tsx). Separate from `map_viewed` so the
   * marketing funnel — visit → see map → click pin → sign up — stays
   * distinct from the authenticated MapPage funnel.
   */
  landingMapViewed: () => trackEvent("landing_map_viewed"),
  /** Fires when a locked pin on the landing map teaser is clicked. */
  landingPinClicked: (spotId: string) => trackEvent("landing_pin_clicked", { spotId }),
  // ── Profile / stats / achievements rollout ────────────────────────────
  /**
   * Fires once per successful `deleteUserData` cascade. Not sampled —
   * account deletions are rare and we need every one for the GDPR audit
   * trail. `achievementsRemoved` is the count of subcollection docs the
   * batch wiped; `avatarRemoved` is true when at least one avatar object
   * was found and deleted from Storage.
   */
  accountDeleted: (uid: string, achievementsRemoved: number, avatarRemoved: boolean) =>
    trackEvent("account_deleted", { uid: hashUid(uid), achievementsRemoved, avatarRemoved }),
  // ── Avatar upload (PR-B, plan §6.3) ────────────────────────────────────
  /** Fires when the AvatarPicker hands a blob to the upload pipeline. */
  avatarUploadStarted: (source: "camera" | "gallery" | "url", originalSizeBytes: number, nsfwScore?: number) =>
    trackEvent("avatar_upload_started", { source, originalSizeBytes, nsfwScore }),
  /** Fires after `setProfileImageUrl` resolves. */
  avatarUploadCompleted: (uid: string, finalSizeBytes: number, durationMs: number) =>
    trackEvent("avatar_upload_completed", { uid: hashUid(uid), finalSizeBytes, durationMs }),
  /** Fires on every rejection — NSFW, oversize, transport, rule. */
  avatarUploadFailed: (errorCode: string, source: "camera" | "gallery" | "url", nsfwScore?: number) =>
    trackEvent("avatar_upload_failed", { errorCode, source, nsfwScore }),
  /** Fires after `deleteAvatar` resolves. */
  avatarDeleted: (uid: string) => trackEvent("avatar_deleted", { uid: hashUid(uid) }),
  // ── PR-C profile UX telemetry (plan §6.4 + §7.2) ──────────────────────
  /**
   * Fires once per `PlayerProfileScreen` mount. `viewerUid` is always the
   * current authenticated user; `profileUid` is whose profile is being
   * viewed; `isOwn` is the precomputed `viewerUid === profileUid`. The
   * `msToFirstPaint` proxy is the elapsed time between mount start and
   * the first effect firing — see PlayerProfileScreen wiring for the
   * measurement boundary.
   */
  profileViewed: (viewerUid: string, profileUid: string, isOwn: boolean, msToFirstPaint: number) =>
    trackEvent("profile_viewed", {
      viewerUid: hashUid(viewerUid),
      profileUid: hashUid(profileUid),
      isOwn,
      msToFirstPaint,
    }),
  /**
   * Fires when a stat tile is tapped. `statName` is the StatTileName from
   * `ProfileStatsGrid` (e.g. "wins", "losses", "games", "winRate").
   * Engagement signal is captured even before the per-tile delta popover
   * (audit C7) ships — the popover is deferred but the event is wired
   * now so the dashboard accumulates baseline data.
   */
  profileStatTileTapped: (statName: string, profileUid: string) =>
    trackEvent("profile_stat_tile_tapped", { statName, profileUid: hashUid(profileUid) }),
} as const;
