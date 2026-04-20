/**
 * Classify Firebase Auth error codes for outage-detection purposes.
 *
 * Benign codes = expected user-driven failures (wrong password, popup closed,
 * email already registered). These should NOT go to Sentry as exceptions
 * because they'd drown real infra alerts in user-error noise — they still get
 * logged as breadcrumbs via the logger.
 *
 * Everything else — auth/internal-error, auth/network-request-failed,
 * auth/user-disabled, auth/operation-not-allowed, quota/timeout/config codes,
 * and unknown codes — is captured so a Sentry issue-count spike fires the
 * outage alert.
 */
const BENIGN_AUTH_CODES: ReadonlySet<string> = new Set([
  "auth/wrong-password",
  "auth/user-not-found",
  "auth/invalid-credential",
  "auth/invalid-email",
  "auth/email-already-in-use",
  "auth/weak-password",
  "auth/missing-password",
  "auth/missing-email",
  "auth/account-exists-with-different-credential",
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/popup-blocked",
  "auth/credential-already-in-use",
]);

export function isBenignAuthCode(code: string): boolean {
  return BENIGN_AUTH_CODES.has(code);
}
