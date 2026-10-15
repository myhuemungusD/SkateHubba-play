import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
  GoogleAuthProvider,
  OAuthProvider,
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
import { auth, ensureAppCheck, requireAuth, isEmulatorMode } from "../firebase";
import { captureException } from "../lib/sentry";
import { getErrorCode, parseFirebaseError } from "../utils/helpers";
import { verificationContinueHost } from "../utils/verificationEmail";
import { logger } from "./logger";

export type AuthUser = User;

export { deleteAccount } from "./auth.deleteAccount";

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
  /**
   * Firebase Auth code from the failed send, or null when the send was
   * accepted. Empty string means the rejection carried no `code`. Acceptance
   * is not proof the message reached an inbox.
   */
  verificationErrorCode: string | null;
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
  await ensureAppCheck();
  logger.info("sign_up_attempt", { email });
  const cred = await createUserWithEmailAndPassword(requireAuth(), email, password);
  logger.info("sign_up_success", { uid: cred.user.uid, email: cred.user.email });
  let verificationEmailSent = false;
  let throttled = false;
  let verificationErrorCode: string | null = null;
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
        verificationErrorCode = retryCode;
        if (VERIFICATION_THROTTLED_CODES.has(retryCode)) throttled = true;
        logger.error("sign_up_verification_email_failed", {
          uid: cred.user.uid,
          error: retryCode || parseFirebaseError(retryErr),
          continueHost: verificationContinueHost(),
        });
        captureException(retryErr, {
          extra: {
            context: "sendEmailVerification on sign-up (fallback)",
            code: retryCode,
            continueHost: verificationContinueHost(),
          },
        });
      }
    } else {
      verificationErrorCode = code;
      if (VERIFICATION_THROTTLED_CODES.has(code)) throttled = true;
      logger.error("sign_up_verification_email_failed", {
        uid: cred.user.uid,
        error: code || parseFirebaseError(err),
        continueHost: verificationContinueHost(),
      });
      captureException(err, {
        extra: {
          context: "sendEmailVerification on sign-up",
          code,
          continueHost: verificationContinueHost(),
        },
      });
    }
  }
  return { user: cred.user, verificationEmailSent, throttled, verificationErrorCode };
}

/**
 * Sign in with an existing email/password. Rejects with a Firebase Auth
 * error code on failure (wrong password, user not found, etc). Callers
 * must not surface the raw error — translate via `parseFirebaseError` to
 * avoid leaking account-existence signals.
 */
export async function signIn(email: string, password: string): Promise<User> {
  await ensureAppCheck();
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
 * Throws `auth/no-current-user` when nobody is signed in — a resolved call
 * used to look like a successful send. Falls back to Firebase's default
 * continue-URI when the configured one is not in the authorized-domains list.
 * A resolved call means Identity Toolkit accepted the request, not that the
 * message reached an inbox.
 */
export async function resendVerification(): Promise<void> {
  const user = requireAuth().currentUser;
  if (!user) {
    logger.warn("resend_verification_no_user");
    throw Object.assign(new Error("No signed-in user to send a verification email to."), {
      code: "auth/no-current-user",
    });
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
      try {
        await sendEmailVerification(user);
        logger.info("resend_verification_sent_fallback", { uid: user.uid });
        return;
      } catch (retryErr) {
        const retryCode = getErrorCode(retryErr);
        logger.error("resend_verification_failed", {
          uid: user.uid,
          code: retryCode,
          continueHost: verificationContinueHost(),
        });
        captureException(retryErr, {
          extra: { context: "resendVerification fallback", code: retryCode, continueHost: verificationContinueHost() },
        });
        throw retryErr;
      }
    }
    logger.error("resend_verification_failed", {
      uid: user.uid,
      code,
      continueHost: verificationContinueHost(),
    });
    captureException(err, {
      extra: { context: "resendVerification", code, continueHost: verificationContinueHost() },
    });
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
  await ensureAppCheck();
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

/**
 * Apple's native cancel is ASAuthorizationError.canceled (code 1001). The
 * Capacitor plugin does not map that onto a Firebase auth code, so the JS
 * error is either code 1001 or a message that mentions 1001 / "cancel".
 * The UI already treats `auth/popup-closed-by-user` as a silent dismiss.
 */
function isAppleUserCancel(err: unknown): boolean {
  const code = getErrorCode(err);
  if (code === "1001" || code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return true;
  }
  if (typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === 1001) {
    return true;
  }
  const text = parseFirebaseError(err);
  return /\b1001\b/.test(text) || /cancel/i.test(text);
}

function appleCancelError(err: unknown): Error {
  const wrapped = new Error("Apple sign-in was cancelled");
  return Object.assign(wrapped, { code: "auth/popup-closed-by-user", cause: err });
}

function makeAppleProvider(): OAuthProvider {
  const provider = new OAuthProvider("apple.com");
  provider.addScope("email");
  provider.addScope("name");
  return provider;
}

/**
 * Sign in with Apple.
 *
 * Required by App Store guideline 4.8 wherever Google sign-in is offered.
 * Native uses `@capacitor-firebase/authentication` (AuthenticationServices
 * plus the plugin's nonce) and exchanges the Apple identity token for a
 * Firebase credential. Web uses the same popup-then-redirect fallback as
 * Google. No Cloud Function or Firestore rule change: this is Firebase's
 * built-in `apple.com` provider, and the user document path is unchanged.
 *
 * Returns the signed-in User, or null when a web redirect was started.
 */
export async function signInWithApple(): Promise<User | null> {
  await ensureAppCheck();
  const a = requireAuth();

  if (Capacitor.isNativePlatform()) {
    logger.info("apple_sign_in_native_attempt");
    try {
      const { credential } = await FirebaseAuthentication.signInWithApple();
      const idToken = credential?.idToken;
      const nonce = credential?.nonce;
      if (!idToken || !nonce) {
        throw new Error("Apple sign-in returned no idToken");
      }
      const appleCred = makeAppleProvider().credential({ idToken, rawNonce: nonce });
      const result = await signInWithCredential(a, appleCred);
      logger.info("apple_sign_in_native_success", { uid: result.user.uid, email: result.user.email });
      return result.user;
    } catch (err: unknown) {
      if (isAppleUserCancel(err)) {
        logger.info("apple_sign_in_native_dismissed", { code: getErrorCode(err) || "1001" });
        throw appleCancelError(err);
      }
      const code = getErrorCode(err);
      logger.error("apple_sign_in_native_error", { code, message: parseFirebaseError(err) });
      throw err;
    }
  }

  const provider = makeAppleProvider();
  logger.info("apple_sign_in_popup_attempt");
  try {
    const cred = await signInWithPopup(a, provider);
    logger.info("apple_sign_in_popup_success", { uid: cred.user.uid, email: cred.user.email });
    return cred.user;
  } catch (err: unknown) {
    const code = getErrorCode(err);
    if (POPUP_FALLBACK_CODES.has(code)) {
      logger.info("apple_sign_in_popup_fallback_redirect", { code });
      await signInWithRedirect(a, provider);
      return null;
    }
    logger.error("apple_sign_in_popup_error", { code, message: parseFirebaseError(err) });
    throw err;
  }
}

/**
 * Firebase stores a pending redirect in sessionStorage under
 * `firebase:pendingRedirect:{apiKey}:[DEFAULT]` (browserSessionPersistence).
 * Absent on a normal visit, so we must not boot reCAPTCHA just to ask.
 */
function hasPendingGoogleRedirect(): boolean {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) return false;
  try {
    return sessionStorage.getItem(`firebase:pendingRedirect:${apiKey}:[DEFAULT]`) === "true";
  } catch (err) {
    logger.warn("pending_redirect_probe_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
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
  // App Check only when a redirect is actually in flight. Warming it on
  // every load pulls reCAPTCHA into the Lighthouse trace.
  if (hasPendingGoogleRedirect()) await ensureAppCheck();
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
