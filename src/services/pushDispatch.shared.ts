/**
 * SDK-agnostic constants + helpers for the push-dispatch / notification path.
 *
 * Contains ZERO Firebase imports so it can be consumed by both the web SDK
 * caller (`pushDispatch.ts` in the browser) AND the admin SDK caller
 * (`api/cron/sweep-expired-turns.ts` on Vercel). The values below MUST stay
 * in lockstep across both paths — they mirror the firestore.rules-side
 * payload caps (title/body lengths) and the rules-side per-user fcmTokens
 * cap (token count). Centralizing them here removes a silent drift risk:
 * change a cap in one path and the other was previously left behind.
 */

/** Collection the in-app notification feed reads. */
export const NOTIFICATIONS_COLLECTION = "notifications" as const;

/** Cross-readable per-user FCM token mirror. */
export const PUSH_TARGETS_COLLECTION = "pushTargets" as const;

/** Outbox the `firebase/firestore-send-fcm` extension drains. */
export const PUSH_DISPATCH_COLLECTION = "push_dispatch" as const;

/**
 * Per-dispatch token cap. Matches the per-user fcmTokens cap in
 * firestore.rules (≤10) so the worst-case fan-out is bounded: even if the
 * recipient signed in on every device they own, one game event triggers
 * at most 10 FCM API calls via the extension.
 */
export const MAX_TOKENS_PER_DISPATCH = 10;

/**
 * Hard caps on user-visible strings, mirrored on the /push_dispatch create
 * rule. The extension forwards these verbatim to FCM; without caps a
 * malicious sender could wedge multi-megabyte payloads through and burn
 * the recipient's quota.
 */
export const MAX_TITLE_LEN = 80;
export const MAX_BODY_LEN = 200;

/** Trim a user-visible string to its on-wire cap (pure; no allocation when fits). */
export function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
