import { signOut as fbSignOut } from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { requireAuth } from "../firebase";
import { captureException, captureMessage } from "../lib/sentry";
import { errorKind } from "../utils/errors";
import { hashUid } from "../utils/pii";
import { logger } from "./logger";
import { reportRevokeFailure, revokeAppleTokensIfNeeded } from "./auth.appleRevoke";

/** Server-side erasure endpoint. See `api/account/delete.ts`. */
const ACCOUNT_DELETE_PATH = "/api/account/delete";

/**
 * Error carrying a `code`, so `getErrorCode` can branch on it exactly as it
 * does for a real Firebase Auth error.
 */
export class CodedError extends Error {
  readonly code: string;
  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.code = code;
  }
}

/** Where the user can disconnect SkateHubba from their Apple Account by hand. */
export const APPLE_SETTINGS_PATH = "Settings → your name → Sign-In & Security → Sign in with Apple";

/**
 * Shown when the user closes the Apple sheet during a delete. Plain and
 * iOS-only on purpose: the sheet only appears on iPhone/iPad, and this copy
 * must not mention any other platform (Guideline 2.3.10).
 */
export const APPLE_CANCEL_MESSAGE =
  "Deleting your account needs a quick confirmation with Apple. Nothing was deleted. " +
  "Tap Try Again and confirm with Apple to finish. " +
  `You can also remove SkateHubba in ${APPLE_SETTINGS_PATH}.`;

/**
 * Shown when Apple confirmed but the revoke itself didn't land (Apple or
 * Firebase error, or the 8 s network budget ran out). Same rules as the
 * cancel copy: iOS-only wording, nothing deleted, a way to finish.
 */
export const APPLE_REVOKE_FAILED_MESSAGE =
  "We couldn't disconnect SkateHubba from your Apple Account, so nothing was deleted. " +
  "Check your connection and tap Try Again. " +
  `You can also remove SkateHubba in ${APPLE_SETTINGS_PATH}. ` +
  "Still stuck? Email privacy@skatehubba.com to ask us to delete your account.";

/**
 * The user closed the Apple sheet: stop with nothing deleted, every time.
 * The delete only goes ahead once Apple confirms, so the Apple link is
 * really revoked. Reported at info level under its own tag: a cancel is a
 * user choice, not a revoke failure.
 */
function stopOnAppleCancel(uid: string): never {
  logger.info("delete_account_apple_cancelled", { uid });
  captureMessage("apple_revoke_cancelled", { level: "info", tags: { apple_revoke: "cancelled" } });
  throw new CodedError("account-delete/cancelled", APPLE_CANCEL_MESSAGE);
}

/**
 * The revoke didn't land: stop with nothing deleted. Deleting anyway would
 * leave SkateHubba in the user's "Apps Using Apple ID" list with no account
 * behind it (Guideline 5.1.1(v)). The helper already sent one Sentry warning
 * with the reason, so this only logs. No "delete anyway" path (Jason, 2026-10-28).
 */
function stopOnAppleRevokeFailure(uid: string): never {
  logger.warn("delete_account_apple_revoke_failed", { uid });
  throw new CodedError("account-delete/apple-revoke-failed", APPLE_REVOKE_FAILED_MESSAGE);
}

const misconfigured = () =>
  new CodedError(
    "account-delete/misconfigured",
    "Account deletion is unavailable in this build. Please contact support.",
  );

/**
 * URL of the erasure endpoint, or null when it can't be reached from this build.
 *
 * On the web a relative URL is correct and same-origin, so CORS never engages.
 * On native it is not: the Capacitor webview origin is `capacitor://localhost`
 * (iOS) / `https://localhost` (Android), so a relative path resolves to the
 * webview itself and there is no API there. `window.location.origin` is the
 * same dead end. The deployed origin must be supplied at build time, and if
 * it wasn't, callers fail up front rather than fire a request that cannot
 * succeed — this is the App-Store-required delete flow.
 */
export function accountDeleteUrl(): string | null {
  const base = import.meta.env.VITE_APP_URL || "";
  if (!base && Capacitor.isNativePlatform()) return null;
  return `${base}${ACCOUNT_DELETE_PATH}`;
}

/**
 * Permanently delete the signed-in account by delegating to the server.
 *
 * WHY THIS IS NOT DONE ON THE CLIENT: it cannot be. The previous implementation
 * called `deleteUser(user)` first and then wiped Firestore from the client.
 * `deleteUser` internally clears the refresh token and calls `signOut`, so the
 * cascade ran with `auth.currentUser === null` and a null token. Every rule on
 * that path requires `request.auth != null`, so the first query failed
 * `permission-denied` before a single document was deleted — and because
 * `permission-denied` is classified permanent by `withRetry`, there was one
 * attempt and no retry. The failure was then swallowed so the user was told
 * deletion succeeded. In practice every account deletion orphaned all of the
 * user's personal data.
 *
 * Flipping the order client-side does not fix it either: wiping Firestore first
 * and then bouncing on `auth/requires-recent-login` leaves a live Auth account
 * with no profile. Both client orderings are broken, which is why erasure moved
 * behind an admin-credentialed endpoint that deletes data first and the Auth
 * user last.
 *
 * Contract:
 *  - Resolves only when the server has erased the data. The Auth user is gone
 *    too in the normal case; if only the final Auth delete failed the data is
 *    still gone, so this still resolves and the local session is cleared.
 *  - Throws `auth/requires-recent-login` when the sign-in is too old, so the
 *    existing re-auth affordance keeps working unchanged. Note a forced token
 *    refresh does not help — `auth_time` reflects the original sign-in, which
 *    is exactly the property the recency check is testing.
 *  - Throws on any other failure. The account is untouched and the flow is
 *    safe to retry; every phase server-side is idempotent.
 *
 * The username is intentionally NOT sent: the server reads it from the profile
 * it is about to delete, so a caller cannot name someone else's reservation to
 * release. For the same reason there is no uid parameter on the wire — the
 * server derives identity solely from the verified ID token.
 */
export async function deleteAccount(uid: string): Promise<{ authDeleted: boolean }> {
  const user = requireAuth().currentUser;
  if (!user) throw new Error("Not signed in");
  if (user.uid !== uid) {
    // Defensive: the caller snapshots uid before the flow starts, so a
    // mismatch here means identity drift mid-delete — refuse rather than
    // delete the wrong account.
    throw new Error("Auth uid does not match requested delete uid");
  }
  logger.info("delete_account_attempt", { uid });

  // Guideline 5.1.1(v): revoke Sign in with Apple tokens before the account
  // goes. Only "revoked" (or not an Apple account) lets the delete go ahead.
  // Closing the Apple sheet stops here with nothing deleted (see
  // stopOnAppleCancel), and so does a revoke that didn't land: a sheet error,
  // no code, a REST error or the 8 s timeout (see stopOnAppleRevokeFailure).
  // Deleting after a failed revoke would leave the app in the user's
  // "Apps Using Apple ID" list. Nothing is deleted yet, so Try Again is safe.
  // The revoke helper swallows its own errors, but we still wrap defensively:
  // a thrown revoke counts as a failed one.
  const revoke = await revokeAppleTokensIfNeeded(user).catch((err: unknown) => {
    logger.warn("delete_account_apple_revoke_threw", { uid, error: errorKind(err) });
    reportRevokeFailure("threw");
    return "failed" as const;
  });
  if (revoke === "cancelled") stopOnAppleCancel(uid);
  if (revoke === "failed") stopOnAppleRevokeFailure(uid);

  const idToken = await user.getIdToken();

  const url = accountDeleteUrl();
  if (!url) {
    logger.error("delete_account_missing_app_url", { uid });
    throw misconfigured();
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch (err) {
    // Network-level failure: nothing was deleted, so this is cleanly retryable.
    logger.error("delete_account_request_failed", { uid, error: errorKind(err) });
    throw new CodedError("account-delete/network", "Could not reach the server. Please try again.", err);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
    // A body without a string code is a crash or a proxy page (a function that
    // failed to load returns Vercel's own HTML 500), not one of our handler's
    // answers. Name it by its HTTP status so triage can tell a 500 from a 502
    // or a 429 instead of every one of them collapsing into "unknown".
    const serverCode = typeof body?.code === "string" ? body.code : `http-${res.status}`;
    const message =
      typeof body?.message === "string" ? body.message : "Could not delete your account. Please try again.";
    logger.error("delete_account_rejected", { uid, status: res.status, serverCode });

    if (serverCode === "requires_recent_login" || serverCode === "invalid_token") {
      // Re-authenticating is the remedy for both, and the caller already has a
      // dedicated branch for this code (it tells the user to sign out, sign
      // back in and delete again).
      throw new CodedError("auth/requires-recent-login", message);
    }
    captureException(new Error(`account delete failed: ${serverCode}`), {
      level: "error",
      // Sentry is a third-party processor: identify the account only by the
      // short hashUid the server's delete logs use (api/account/delete.ts), so
      // a client event and its server log line correlate. Never the raw uid.
      extra: {
        context: "server-side account deletion rejected",
        uidHash: hashUid(uid),
        status: res.status,
        serverCode,
      },
    });
    throw new CodedError(`account-delete/${serverCode}`, message);
  }

  const result = (await res.json().catch(() => null)) as { authDeleted?: unknown } | null;
  const authDeleted = result?.authDeleted !== false;
  if (!authDeleted) {
    // Data is erased but the Auth record survived. Not a user-facing failure —
    // there is nothing left to protect — but it must not pass silently, because
    // a sign-in would land in profile setup with no explanation. The caller
    // keeps the pending-delete marker on this result so the retry affordance
    // stays reachable; a retry re-runs the (now empty) cascade and deletes the
    // Auth record.
    logger.warn("delete_account_auth_survived", { uid });
    captureException(new Error("account data erased but Auth user survived"), {
      level: "warning",
      extra: { context: "server erased all data; Auth deletion failed and needs a sweep", uidHash: hashUid(uid) },
    });
  }

  // The server deleted the Auth user, so the cached session is already dead.
  // Clear it explicitly rather than waiting for the next token refresh to fail.
  await fbSignOut(requireAuth()).catch((err: unknown) => {
    logger.warn("delete_account_signout_failed", { uid, error: errorKind(err) });
  });

  logger.info("delete_account_success", { uid, authDeleted });
  return { authDeleted };
}
