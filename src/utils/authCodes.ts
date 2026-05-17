/**
 * Classify Firebase Auth error codes for outage-detection purposes.
 *
 * Benign codes = expected user-driven or user-environment failures (wrong
 * password, popup closed, Safari private-browsing storage blocked). These
 * should NOT go to Sentry as exceptions because they'd drown real infra
 * alerts in user-error noise — they still get logged as breadcrumbs via
 * the logger.
 *
 * Everything else — auth/internal-error, auth/network-request-failed,
 * auth/user-disabled, auth/operation-not-allowed, quota codes, and unknown
 * codes — is captured so a Sentry issue-count spike fires the outage alert.
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
  // User-environment failures: Safari Private Browsing, storage-partitioned
  // 3p contexts, stale OAuth tabs. Not actionable by ops.
  "auth/web-storage-unsupported",
  "auth/missing-or-invalid-nonce",
  "auth/timeout",
]);

export function isBenignAuthCode(code: string): boolean {
  return BENIGN_AUTH_CODES.has(code);
}

/**
 * Map a Firebase Auth error code to a user-facing message.
 *
 * Returns null for codes the caller should handle itself (e.g. context-sensitive
 * like `auth/email-already-in-use` which AuthScreen pairs with an inline
 * recovery action). Returns null for unknown codes so the caller can fall back
 * to its own generic message + capture the unknown code to Sentry.
 *
 * Centralised so AuthScreen (email path) and AuthContext (Google path) share
 * the same wording — drift between the two surfaces is the kind of thing that
 * makes a screenshot ambiguous.
 */
export function getAuthErrorMessage(code: string): string | null {
  switch (code) {
    case "auth/account-exists-with-different-credential":
      return "This email is linked to Google. Tap 'Continue with Google' below.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "Invalid email or password";
    case "auth/weak-password":
      return "Password too weak (6+ chars)";
    case "auth/user-disabled":
      return "This account has been disabled. Please contact support if you think this is a mistake.";
    case "auth/user-token-expired":
    case "auth/requires-recent-login":
      return "Your session expired. Please sign in again.";
    case "auth/operation-not-allowed":
      return "Email sign-in is temporarily disabled. Try Continue with Google above.";
    case "auth/missing-password":
    case "auth/missing-email":
      return "Please fill in both email and password.";
    case "auth/web-storage-unsupported":
      return "Your browser is blocking storage. Disable private browsing or try a different browser.";
    case "auth/too-many-requests":
    case "auth/quota-exceeded":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "auth/network-request-failed":
    case "auth/timeout":
      return "Network error — check your connection and try again.";
    case "auth/internal-error":
      // Firebase wraps App Check rejections, reCAPTCHA failures, and transient
      // Identity Toolkit 500s into this catch-all — surface the retry message,
      // not "auth/internal-error".
      return "Sign-in is temporarily unavailable. Please try again in a moment.";
    case "auth/missing-or-invalid-nonce":
      return "Sign-in token expired. Please reload the page and try again.";
    default:
      return null;
  }
}
