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
import { auth, requireAuth } from "../firebase";
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

export async function signUp(email: string, password: string): Promise<User> {
  logger.info("sign_up_attempt", { email });
  const cred = await createUserWithEmailAndPassword(requireAuth(), email, password);
  logger.info("sign_up_success", { uid: cred.user.uid, email: cred.user.email });
  // Fire-and-forget verification email — failure is non-blocking (user can
  // resend from the lobby banner) but we want visibility in Sentry.
  sendEmailVerification(cred.user, getActionCodeSettings()).catch((err) => {
    logger.error("sign_up_verification_email_failed", { uid: cred.user.uid, error: getErrorCode(err) || String(err) });
    captureException(err, { extra: { context: "sendEmailVerification on sign-up" } });
  });
  return cred.user;
}

export async function signIn(email: string, password: string): Promise<User> {
  logger.info("sign_in_attempt", { email });
  const cred = await signInWithEmailAndPassword(requireAuth(), email, password);
  logger.info("sign_in_success", { uid: cred.user.uid, emailVerified: cred.user.emailVerified });
  return cred.user;
}

export async function signOut(): Promise<void> {
  logger.info("sign_out");
  await fbSignOut(requireAuth());
  logger.info("sign_out_success");
}

export async function resetPassword(email: string): Promise<void> {
  logger.info("password_reset_attempt", { email });
  await sendPasswordResetEmail(requireAuth(), email, getActionCodeSettings());
  logger.info("password_reset_sent", { email });
}

export async function resendVerification(): Promise<void> {
  const user = requireAuth().currentUser;
  if (user) {
    logger.info("resend_verification", { uid: user.uid });
    await sendEmailVerification(user, getActionCodeSettings());
    logger.info("resend_verification_sent", { uid: user.uid });
  } else {
    logger.warn("resend_verification_no_user");
  }
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
    if (code === "auth/popup-blocked") {
      logger.info("google_sign_in_popup_blocked_fallback_redirect");
      // Redirect flow: page navigates to Google; onAuthStateChanged resolves on return
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
