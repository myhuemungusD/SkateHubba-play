import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  getIdTokenResult,
  type User,
  type ActionCodeSettings,
} from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { auth, requireAuth, isEmulatorMode } from "../firebase";
import { captureException } from "../lib/sentry";
import { getErrorCode, parseFirebaseError } from "../utils/helpers";
import { logger } from "./logger";

export type AuthUser = User;

/**
 * Build actionCodeSettings so Firebase email links redirect back to our app.
 * In production this will be your Vercel domain; in dev it falls back to localhost.
 */
function getActionCodeSettings(): ActionCodeSettings {
  const url = import.meta.env.VITE_APP_URL || window.location.origin;
  return { url, handleCodeInApp: false };
}

/**
 * Subscribe to Firebase Auth state changes. The callback fires immediately
 * with the current user (or null) and then again on every sign-in / sign-out.
 * Returns an unsubscribe function. Safe to call before Firebase initialises —
 * the callback will be invoked once with null in that case.
 */
export function onAuthChange(cb: (user: User | null) => void) {
  if (!auth) {
    logger.warn("auth_change_no_firebase", { reason: "auth instance is null" });
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (user) => {
    logger.debug("auth_state_changed", {
      uid: user?.uid ?? null,
      email: user?.email ?? null,
      emailVerified: user?.emailVerified ?? null,
      providerId: user?.providerData?.[0]?.providerId ?? null,
    });
    cb(user);
  });
}

export interface SignUpResult {
  user: User;
  verificationEmailSent: boolean;
  /**
   * True when Firebase Auth throttled the verification-email send
   * (`auth/too-many-requests` or `auth/quota-exceeded`). Lets the caller
   * distinguish "retry available after a cooldown" — e.g. surface a
   * banner with a retry timer — from a permanent send failure. Only
   * meaningful when `verificationEmailSent` is `false`; always `false`
   * on a successful send.
   */
  throttled: boolean;
}

/**
 * Firebase Auth error codes that signal a temporary send-side throttle
 * on `sendEmailVerification` — the account is created, the send just
 * needs a cooldown before it will accept another attempt.
 */
const VERIFICATION_THROTTLED_CODES = new Set<string>(["auth/too-many-requests", "auth/quota-exceeded"]);

/**
 * Create a new email/password account and send a verification email.
 *
 * Resolves with `verificationEmailSent: false` if the verification email fails
 * (e.g. the continue-URI is not in Firebase's authorized domains). The caller
 * should surface a non-blocking warning — the account is still created and the
 * user can request another verification email via {@link resendVerification}.
 *
 * When the send fails specifically because Firebase throttled the request
 * (`auth/too-many-requests` / `auth/quota-exceeded`) the result also carries
 * `throttled: true` so the UI can distinguish "retry after a cooldown" from
 * a permanent send failure and surface the retry affordance accordingly.
 *
 * Rejects with a Firebase Auth error code on sign-up failure (email in use,
 * weak password, etc). Callers should translate codes via `parseFirebaseError`.
 */
export async function signUp(email: string, password: string): Promise<SignUpResult> {
  logger.info("sign_up_attempt", { email });
  const cred = await createUserWithEmailAndPassword(requireAuth(), email, password);
  logger.info("sign_up_success", { uid: cred.user.uid, email: cred.user.email });
  let verificationEmailSent = false;
  let throttled = false;
  try {
    await sendEmailVerification(cred.user, getActionCodeSettings());
    verificationEmailSent = true;
    logger.info("sign_up_verification_email_sent", { uid: cred.user.uid });
  } catch (err) {
    const code = getErrorCode(err);
    // Retry without actionCodeSettings if the continue-URI is rejected
    if (code === "auth/unauthorized-continue-uri" || code === "auth/invalid-continue-uri") {
      try {
        await sendEmailVerification(cred.user);
        verificationEmailSent = true;
        logger.info("sign_up_verification_email_sent_fallback", { uid: cred.user.uid });
      } catch (retryErr) {
        const retryCode = getErrorCode(retryErr);
        if (VERIFICATION_THROTTLED_CODES.has(retryCode)) throttled = true;
        logger.error("sign_up_verification_email_failed", {
          uid: cred.user.uid,
          error: retryCode || parseFirebaseError(retryErr),
        });
        captureException(retryErr, { extra: { context: "sendEmailVerification on sign-up (fallback)" } });
      }
    } else {
      if (VERIFICATION_THROTTLED_CODES.has(code)) throttled = true;
      logger.error("sign_up_verification_email_failed", {
        uid: cred.user.uid,
        error: code || parseFirebaseError(err),
      });
      captureException(err, { extra: { context: "sendEmailVerification on sign-up" } });
    }
  }
  return { user: cred.user, verificationEmailSent, throttled };
}

/**
 * Sign in with an existing email/password. Rejects with a Firebase Auth
 * error code on failure (wrong password, user not found, etc). Callers
 * must not surface the raw error — translate via `parseFirebaseError` to
 * avoid leaking account-existence signals.
 */
export async function signIn(email: string, password: string): Promise<User> {
  logger.info("sign_in_attempt", { email });
  const cred = await signInWithEmailAndPassword(requireAuth(), email, password);
  logger.info("sign_in_success", { uid: cred.user.uid, emailVerified: cred.user.emailVerified });
  return cred.user;
}

/** Sign the current user out. No-op if no user is signed in. */
export async function signOut(): Promise<void> {
  logger.info("sign_out");
  // On native (iOS/Android), Google sign-in goes through the platform-native
  // Google Sign-In SDK via @capacitor-firebase/authentication. The Firebase
  // Web SDK signOut below does NOT clear that native session, so without this
  // branch the user can't switch Google accounts and the cached session
  // survives account deletion. Best-effort: a plugin failure must not block
  // the web-SDK signOut that follows.
  if (Capacitor.isNativePlatform()) {
    try {
      await FirebaseAuthentication.signOut();
    } catch (err) {
      logger.warn("sign_out_native_plugin_failed", {
        code: getErrorCode(err),
        message: parseFirebaseError(err),
      });
    }
  }
  await fbSignOut(requireAuth());
  logger.info("sign_out_success");
}

/**
 * Request a password-reset email. By design, Firebase does not reveal whether
 * the address has an account — callers should show the same confirmation
 * message regardless of outcome to prevent account enumeration.
 */
export async function resetPassword(email: string): Promise<void> {
  logger.info("password_reset_attempt", { email });
  try {
    await sendPasswordResetEmail(requireAuth(), email, getActionCodeSettings());
  } catch (err) {
    const code = getErrorCode(err);
    if (code === "auth/unauthorized-continue-uri" || code === "auth/invalid-continue-uri") {
      logger.warn("password_reset_with_settings_failed", { email, code });
      await sendPasswordResetEmail(requireAuth(), email);
      logger.info("password_reset_sent_fallback", { email });
      return;
    }
    throw err;
  }
  logger.info("password_reset_sent", { email });
}

/**
 * Force-refresh the current user's Auth token so that claims like
 * `emailVerified` reflect the latest server state.  Call this when
 * the user returns to the app after clicking a verification link
 * in another tab/browser.
 *
 * Returns the updated emailVerified value, or null if no user is signed in.
 */
export async function reloadUser(): Promise<boolean | null> {
  const user = requireAuth().currentUser;
  if (!user) return null;
  await user.reload();
  if (user.emailVerified) {
    // user.reload() updates the local User object but does NOT refresh the
    // cached ID token (JWT).  Firestore security rules read email_verified
    // from the JWT, so without this call game-creation would be denied even
    // though the UI shows the user as verified.
    await user.getIdToken(/* forceRefresh= */ true);
  }
  return user.emailVerified;
}

/**
 * Whether the signed-in user carries the `admin` custom claim.
 *
 * The claim is minted out of band (`scripts/set-admin-claim.mjs`) and is what
 * `firestore.rules` checks on every admin-console write path, so this read is
 * purely a UI affordance: it decides whether to render the console, never
 * whether a write is allowed. A user who flips the returned boolean in a
 * debugger gets a console whose every action is rejected server-side.
 *
 * Reads the cached ID token (`forceRefresh: false`) — a network round-trip on
 * every render guard is not worth it. The consequence is that a freshly
 * granted or revoked claim only lands after the token refreshes (up to an
 * hour, or immediately on sign-out/sign-in), which is why the granting script
 * prints that reminder.
 *
 * Returns `false` when signed out, when Firebase is not initialised, and on
 * any token-read failure: no claim readable means no console.
 */
export async function getAdminClaim(): Promise<boolean> {
  try {
    const user = requireAuth().currentUser;
    if (!user) return false;
    const result = await getIdTokenResult(user, /* forceRefresh= */ false);
    // ParsedToken is an `any`-valued index signature; re-type it as unknown so
    // the comparison below is checked rather than silently permissive.
    const claims = result.claims as Record<string, unknown>;
    return claims.admin === true;
  } catch (err) {
    logger.warn("admin_claim_read_failed", { error: parseFirebaseError(err) });
    return false;
  }
}

/**
 * Resend the email-verification link for the currently signed-in user.
 * Silently no-ops if no user is signed in. Falls back to Firebase's default
 * continue-URI when the configured one is not in the authorized-domains list.
 */
export async function resendVerification(): Promise<void> {
  const user = requireAuth().currentUser;
  if (!user) {
    logger.warn("resend_verification_no_user");
    return;
  }
  logger.info("resend_verification", { uid: user.uid });
  try {
    await sendEmailVerification(user, getActionCodeSettings());
  } catch (err) {
    const code = getErrorCode(err);
    logger.warn("resend_verification_with_settings_failed", { uid: user.uid, code });
    // If the continue-URI is rejected (not in Firebase authorized domains)
    // or invalid, retry without actionCodeSettings — Firebase will use its
    // default redirect URL (the firebaseapp.com handler).
    if (code === "auth/unauthorized-continue-uri" || code === "auth/invalid-continue-uri") {
      await sendEmailVerification(user);
      logger.info("resend_verification_sent_fallback", { uid: user.uid });
      return;
    }
    throw err;
  }
  logger.info("resend_verification_sent", { uid: user.uid });
}

function makeGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  // Always show the account chooser so users can switch accounts
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

/**
 * Error codes that should trigger a redirect fallback. User-abort codes
 * (`auth/popup-closed-by-user`, `auth/cancelled-popup-request`) are
 * deliberately excluded — redirecting on those loops the user back to
 * Google's OAuth page after they explicitly cancelled.
 */
const POPUP_FALLBACK_CODES = new Set<string>([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported",
]);

/**
 * Sign in with Google.
 *
 * On iOS/Android (Capacitor native shell) this delegates to
 * `@capacitor-firebase/authentication`, which uses the platform-native Google
 * Sign-In SDK. `signInWithPopup` is a web-only API — calling it inside a
 * Capacitor WebView fails with `auth/operation-not-supported-in-this-environment`
 * and leaves the user with no sign-in path at all. Native returns an OAuth id
 * token which we hand to `signInWithCredential` to populate the same Firebase
 * Auth state a popup flow would produce.
 *
 * On the web, this keeps the popup-first / redirect-fallback behaviour
 * untouched: popup on desktop, redirect fallback when popups are blocked
 * (mobile Safari, in-app browsers, storage-partitioned contexts).
 *
 * Returns the signed-in User, or null if a redirect was initiated (web only —
 * `onAuthStateChanged` will fire automatically once the user returns from
 * Google's OAuth page).
 */
export async function signInWithGoogle(): Promise<User | null> {
  const a = requireAuth();

  // ── Native path (iOS / Android) ─────────────────────────────────────
  if (Capacitor.isNativePlatform()) {
    logger.info("google_sign_in_native_attempt");
    try {
      const { credential } = await FirebaseAuthentication.signInWithGoogle();
      if (!credential?.idToken) {
        throw new Error("Google sign-in returned no idToken");
      }
      const googleCred = GoogleAuthProvider.credential(credential.idToken, credential.accessToken);
      const result = await signInWithCredential(a, googleCred);
      logger.info("google_sign_in_native_success", { uid: result.user.uid, email: result.user.email });
      return result.user;
    } catch (err: unknown) {
      const code = getErrorCode(err);
      logger.error("google_sign_in_native_error", { code, message: parseFirebaseError(err) });
      throw err;
    }
  }

  // ── Web path (popup first, redirect fallback) ──────────────────────
  const provider = makeGoogleProvider();
  logger.info("google_sign_in_popup_attempt");
  try {
    const cred = await signInWithPopup(a, provider);
    logger.info("google_sign_in_popup_success", { uid: cred.user.uid, email: cred.user.email });
    return cred.user;
  } catch (err: unknown) {
    const code = getErrorCode(err);
    if (POPUP_FALLBACK_CODES.has(code)) {
      logger.info("google_sign_in_popup_fallback_redirect", { code });
      await signInWithRedirect(a, provider);
      return null;
    }
    logger.error("google_sign_in_popup_error", { code, message: parseFirebaseError(err) });
    throw err;
  }
}

/** Server-side erasure endpoint. See `api/account/delete.ts`. */
const ACCOUNT_DELETE_PATH = "/api/account/delete";

/**
 * Error carrying a `code`, so `getErrorCode` can branch on it exactly as it
 * does for a real Firebase Auth error.
 */
class CodedError extends Error {
  readonly code: string;
  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.code = code;
  }
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

  const idToken = await user.getIdToken();

  // On the web a relative URL is correct and same-origin, so CORS never engages.
  // On native it is not: the Capacitor webview origin is `capacitor://localhost`
  // (iOS) / `https://localhost` (Android), so a relative path resolves to the
  // webview itself and there is no API there. `window.location.origin` is the
  // same dead end. The deployed origin must be supplied at build time, and if
  // it wasn't, failing here is far better than firing a request that cannot
  // succeed — this is the App-Store-required delete flow.
  const configuredBase = import.meta.env.VITE_APP_URL || "";
  if (!configuredBase && Capacitor.isNativePlatform()) {
    logger.error("delete_account_missing_app_url", { uid });
    throw new CodedError(
      "account-delete/misconfigured",
      "Account deletion is unavailable in this build. Please contact support.",
    );
  }
  const base = configuredBase;

  let res: Response;
  try {
    res = await fetch(`${base}${ACCOUNT_DELETE_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch (err) {
    // Network-level failure: nothing was deleted, so this is cleanly retryable.
    logger.error("delete_account_request_failed", { uid, error: parseFirebaseError(err) });
    throw new CodedError("account-delete/network", "Could not reach the server. Please try again.", err);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
    const serverCode = typeof body?.code === "string" ? body.code : "unknown";
    const message =
      typeof body?.message === "string" ? body.message : "Could not delete your account. Please try again.";
    logger.error("delete_account_rejected", { uid, status: res.status, serverCode });

    if (serverCode === "requires_recent_login" || serverCode === "invalid_token") {
      // Re-authenticating is the remedy for both, and the caller already has a
      // dedicated branch (plus a "Finish deletion" affordance) for this code.
      throw new CodedError("auth/requires-recent-login", message);
    }
    captureException(new Error(`account delete failed: ${serverCode}`), {
      level: "error",
      extra: { context: "server-side account deletion rejected", uid, status: res.status, serverCode },
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
      extra: { context: "server erased all data; Auth deletion failed and needs a sweep", uid },
    });
  }

  // The server deleted the Auth user, so the cached session is already dead.
  // Clear it explicitly rather than waiting for the next token refresh to fail.
  await fbSignOut(requireAuth()).catch((err: unknown) => {
    logger.warn("delete_account_signout_failed", { uid, error: parseFirebaseError(err) });
  });

  logger.info("delete_account_success", { uid, authDeleted });
  return { authDeleted };
}

/**
 * Call once on app mount to resolve any pending Google redirect sign-in.
 * Safe to call when no redirect is in progress (returns null).
 */
export async function resolveGoogleRedirect(): Promise<User | null> {
  if (!auth) {
    logger.warn("resolve_google_redirect_no_auth");
    return null;
  }
  // Skip getRedirectResult when running against emulators — Google redirects
  // never happen in emulator mode and getRedirectResult can hang in CI.
  if (isEmulatorMode) {
    logger.debug("resolve_google_redirect_skip_emulator");
    return null;
  }
  logger.debug("resolve_google_redirect_start");
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) {
      logger.info("resolve_google_redirect_success", { uid: result.user.uid, email: result.user.email });
    } else {
      logger.debug("resolve_google_redirect_no_pending");
    }
    return result?.user ?? null;
  } catch (err) {
    const code = getErrorCode(err);
    logger.error("resolve_google_redirect_error", { code, message: parseFirebaseError(err) });
    // Rethrow so the caller's Sentry/benign filter and UI handling can run.
    // Capturing here would bypass that filter (auth/missing-or-invalid-nonce,
    // auth/timeout etc. would always reach Sentry as outage noise).
    throw err;
  }
}
