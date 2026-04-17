import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
  deleteUser,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  type User,
  type ActionCodeSettings,
} from "firebase/auth";
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
}

/**
 * Create a new email/password account and send a verification email.
 *
 * Resolves with `verificationEmailSent: false` if the verification email fails
 * (e.g. the continue-URI is not in Firebase's authorized domains). The caller
 * should surface a non-blocking warning — the account is still created and the
 * user can request another verification email via {@link resendVerification}.
 *
 * Rejects with a Firebase Auth error code on sign-up failure (email in use,
 * weak password, etc). Callers should translate codes via `parseFirebaseError`.
 */
export async function signUp(email: string, password: string): Promise<SignUpResult> {
  logger.info("sign_up_attempt", { email });
  const cred = await createUserWithEmailAndPassword(requireAuth(), email, password);
  logger.info("sign_up_success", { uid: cred.user.uid, email: cred.user.email });
  let verificationEmailSent = false;
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
        logger.error("sign_up_verification_email_failed", {
          uid: cred.user.uid,
          error: getErrorCode(retryErr) || parseFirebaseError(retryErr),
        });
        captureException(retryErr, { extra: { context: "sendEmailVerification on sign-up (fallback)" } });
      }
    } else {
      logger.error("sign_up_verification_email_failed", {
        uid: cred.user.uid,
        error: code || parseFirebaseError(err),
      });
      captureException(err, { extra: { context: "sendEmailVerification on sign-up" } });
    }
  }
  return { user: cred.user, verificationEmailSent };
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
  await sendPasswordResetEmail(requireAuth(), email, getActionCodeSettings());
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
 * Sign in with Google.
 * Uses popup on desktop; falls back to redirect when popups are blocked (mobile/Safari).
 * Returns the signed-in User, or null if a redirect was initiated (onAuthStateChanged
 * will fire automatically once the user returns from Google's OAuth page).
 */
export async function signInWithGoogle(): Promise<User | null> {
  const a = requireAuth();
  const provider = makeGoogleProvider();
  logger.info("google_sign_in_popup_attempt");
  try {
    const cred = await signInWithPopup(a, provider);
    logger.info("google_sign_in_popup_success", { uid: cred.user.uid, email: cred.user.email });
    return cred.user;
  } catch (err: unknown) {
    const code = getErrorCode(err);
    // Safari/WebKit throws popup-closed-by-user or cancelled-popup-request
    // instead of popup-blocked — fall back to redirect for all of these.
    const redirectCodes = new Set(["auth/popup-blocked", "auth/popup-closed-by-user", "auth/cancelled-popup-request"]);
    if (code && redirectCodes.has(code)) {
      logger.info("google_sign_in_popup_fallback_redirect", { code });
      await signInWithRedirect(a, provider);
      return null;
    }
    logger.error("google_sign_in_popup_error", { code, message: parseFirebaseError(err) });
    throw err;
  }
}

/**
 * Permanently delete the currently signed-in Firebase Auth account.
 *
 * IMPORTANT: Call deleteUserData() from users.ts first to clean up Firestore.
 * Firebase requires recent authentication; if this throws auth/requires-recent-login
 * the caller should sign the user out and ask them to re-authenticate.
 */
export async function deleteAccount(): Promise<void> {
  const user = requireAuth().currentUser;
  if (!user) throw new Error("Not signed in");
  logger.info("delete_account_attempt", { uid: user.uid });
  await deleteUser(user);
  logger.info("delete_account_success", { uid: user.uid });
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
    // Log redirect errors so they're visible in production — previously these
    // were silently swallowed, making Google-redirect failures impossible to debug.
    captureException(err, { extra: { context: "resolveGoogleRedirect" } });
    return null;
  }
}
