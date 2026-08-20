import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { signOut as fbSignOut, signInWithGoogle, resolveGoogleRedirect, deleteAccount } from "../services/auth";
import { getMfaChallenge, type MfaChallenge } from "../services/mfa";
import { removeCurrentFcmToken, refreshWebPushTokenIfGranted } from "../services/fcm";
import { isPushSupported, registerPushTokenIfGranted, unregisterPushToken } from "../services/pushNotifications";
import type { UserProfile } from "../services/users";
import { exportUserData, serializeUserData, userDataFilename } from "../services/userData";
import { getErrorCode, parseFirebaseError } from "../utils/helpers";
import { isBenignAuthCode, getAuthErrorMessage } from "../utils/authCodes";
import { analytics } from "../services/analytics";
import { logger, metrics } from "../services/logger";
import { captureException, setUser as setSentryUser } from "../lib/sentry";
import { identify as posthogIdentify, resetIdentity as posthogReset } from "../lib/posthog";
import { hashIdentity } from "../utils/pii";
import { useAnalyticsConsent } from "../hooks/useAnalyticsConsent";

// sessionStorage key that survives the sign-out/sign-in round-trip required
// after auth/requires-recent-login. We only need the uid — the Firestore wipe
// already ran, so the retry path just needs to know WHICH auth uid still has
// a live Firebase Auth record waiting to be deleted.
const PENDING_DELETE_KEY = "skate.pendingDeleteUid";

function readPendingDeleteUid(): string | null {
  try {
    return sessionStorage.getItem(PENDING_DELETE_KEY);
  } catch {
    // Private-mode Safari / disabled storage — recovery path unavailable but
    // not catastrophic (user can contact support or retry from a fresh tab).
    return null;
  }
}

function writePendingDeleteUid(uid: string): void {
  try {
    sessionStorage.setItem(PENDING_DELETE_KEY, uid);
  } catch {
    /* see readPendingDeleteUid — best-effort only */
  }
}

function clearPendingDeleteUid(): void {
  try {
    sessionStorage.removeItem(PENDING_DELETE_KEY);
  } catch {
    /* see readPendingDeleteUid — best-effort only */
  }
}

/** Which sign-in surface produced a pending second-factor challenge. Carried
 *  alongside the challenge so the completion event is attributed to the method
 *  the user actually used, not a guess. */
export type MfaMethod = "google" | "email";

export interface AuthContextValue {
  loading: boolean;
  user: ReturnType<typeof useAuth>["user"];
  activeProfile: UserProfile | null;
  setActiveProfile: (p: UserProfile | null) => void;
  refreshProfile: () => Promise<void>;
  reloadAuthUser: () => Promise<boolean>;
  handleGoogleSignIn: () => Promise<void>;
  googleLoading: boolean;
  googleError: string;
  setGoogleError: (e: string) => void;
  /**
   * Pending second-factor challenge captured from a sign-in rejection. Non-null
   * means the password/Google credential was accepted but Firebase is holding
   * the session until the user clears their second factor — AuthScreen swaps
   * the form for MfaVerifyCard while this is set.
   */
  mfaChallenge: MfaChallenge | null;
  /**
   * Capture a second-factor challenge from a caught sign-in error. Returns true
   * when the error WAS an MFA challenge (caller should stop its own error
   * handling), false for every other error (caller proceeds as before).
   *
   * `method` records which surface the credential came from so the eventual
   * `sign_in` event is attributed correctly once the challenge clears.
   */
  beginMfaChallenge: (err: unknown, method: MfaMethod) => boolean;
  /** Abandon the pending challenge and return to the normal sign-in form. */
  clearMfaChallenge: () => void;
  handleSignOut: () => Promise<void>;
  handleDeleteAccount: () => Promise<void>;
  handleDownloadData: () => Promise<void>;
  /**
   * Uid whose Firestore data has already been wiped but whose Firebase Auth
   * record is still alive — set when the first deleteAccount() call bounced
   * with auth/requires-recent-login. The banner component surfaces a
   * one-shot "Finish deletion" affordance when this matches the current
   * signed-in user; handleDeleteAccount consumes it on retry.
   */
  pendingDeleteUid: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { loading, user, profile, refreshProfile, reloadAuthUser } = useAuth();

  // Sync activeProfile from `profile` during render rather than via useEffect.
  // The previous useEffect-mirror introduced a one-render lag because effects
  // run bottom-up (NavigationContext's routing effect fired before the
  // AuthContext mirror), so direct deep-links (/map, /record, /player/:uid)
  // saw activeProfile=null in the gap between profile resolving and the
  // mirror committing — and got bounced through /profile → /lobby. Adjusting
  // state during render is the recommended React pattern for this case;
  // setActiveProfile is still exposed so ProfileSetup / sign-out / delete
  // flows can override the derived value imperatively.
  const [activeProfile, setActiveProfile] = useState<UserProfile | null>(profile);
  const [prevProfile, setPrevProfile] = useState<UserProfile | null>(profile);
  if (profile !== prevProfile) {
    setPrevProfile(profile);
    if (profile) setActiveProfile(profile);
  }
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null);
  // Set in the same commit as the challenge above; only read while one is
  // pending, so its initial value is never observed.
  const [mfaMethod, setMfaMethod] = useState<MfaMethod>("google");
  // Mirror of PENDING_DELETE_KEY in React state so the banner component can
  // re-render on capture / clear without polling storage.
  const [pendingDeleteUid, setPendingDeleteUid] = useState<string | null>(() => readPendingDeleteUid());

  // Resolve any pending Google redirect on mount
  useEffect(() => {
    resolveGoogleRedirect()
      .then((redirectUser) => {
        if (redirectUser) {
          logger.info("google_redirect_resolved", { uid: redirectUser.uid });
          analytics.signIn("google");
          metrics.signIn("google", redirectUser.uid);
        }
      })
      .catch((err) => {
        logger.warn("google_redirect_resolve_error", {
          message: parseFirebaseError(err),
        });
        const code = getErrorCode(err);
        // A pending second factor is an expected account state, not an outage:
        // hand it to the MFA card instead of the error banner, and keep it out
        // of Sentry. It is also NOT a sign-in failure — counting it as one made
        // every MFA user read as a rising failure rate on the dashboards. The
        // matching `sign_in` fires once the challenge clears (see the effect
        // below), so attempt/success stay paired.
        const redirectChallenge = getMfaChallenge(err);
        if (redirectChallenge) {
          logger.info("google_sign_in_mfa_required", { factorCount: redirectChallenge.hints.length });
          setMfaMethod("google");
          setMfaChallenge(redirectChallenge);
          return;
        }
        analytics.signInFailure("google", code || "redirect_error");
        metrics.signInFailure("google", code || "redirect_error");
        // Skip Sentry for benign user-environment failures (Safari private
        // mode, stale OAuth nonce) — they'd drown real outage signals.
        if (!isBenignAuthCode(code)) {
          captureException(err, { extra: { context: "resolveGoogleRedirect", code } });
        }
        if (code === "auth/account-exists-with-different-credential") {
          setGoogleError("This email is linked to a password account. Sign in with email/password instead.");
        } else {
          setGoogleError(getAuthErrorMessage(code) ?? "Google sign-in failed. Please try again.");
        }
      });
  }, []);

  const handleGoogleSignIn = useCallback(async () => {
    setGoogleError("");
    setGoogleLoading(true);
    logger.info("google_sign_in_started");
    analytics.signInAttempt("google");
    metrics.signInAttempt("google");
    try {
      const googleUser = await signInWithGoogle();
      if (googleUser) {
        logger.info("google_sign_in_completed", { uid: googleUser.uid });
        analytics.signIn("google");
        metrics.signIn("google", googleUser.uid);
      } else {
        logger.info("google_sign_in_redirect_initiated");
      }
    } catch (err: unknown) {
      const code = getErrorCode(err);
      // Second factor pending: the credential was fine, Firebase is just
      // holding the session. Surface the challenge UI rather than an error
      // banner, don't page Sentry, and don't record a sign-in failure — this is
      // a healthy account state, and the `sign_in` event fires once the
      // challenge clears.
      const challenge = getMfaChallenge(err);
      if (challenge) {
        logger.info("google_sign_in_mfa_required", { factorCount: challenge.hints.length });
        setMfaMethod("google");
        setMfaChallenge(challenge);
        return;
      }
      analytics.signInFailure("google", code || "unknown");
      metrics.signInFailure("google", code || "unknown");
      // User-driven dismissals don't warrant any UI — just breadcrumb.
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        logger.info("google_sign_in_dismissed", { code });
      } else if (code === "auth/account-exists-with-different-credential") {
        logger.warn("google_sign_in_credential_conflict", { code });
        captureException(err, { extra: { context: "handleGoogleSignIn", code } });
        setGoogleError("This email is linked to a password account. Sign in with email/password instead.");
      } else if (code === "auth/unauthorized-domain") {
        // Ops fix, not user fix — surface the runbook hint and page Sentry.
        logger.error("google_sign_in_unauthorized_domain", { code, origin: window.location.origin });
        captureException(err, { extra: { context: "handleGoogleSignIn", code, origin: window.location.origin } });
        setGoogleError(
          "This domain isn't authorized for Google sign-in. " +
            "Add it in Firebase Console → Authentication → Settings → Authorized domains.",
        );
      } else {
        const mapped = getAuthErrorMessage(code);
        if (mapped) {
          logger.warn("google_sign_in_known_error", { code });
        } else {
          logger.error("google_sign_in_error", { code, message: parseFirebaseError(err) });
        }
        if (!isBenignAuthCode(code)) {
          captureException(err, { extra: { context: "handleGoogleSignIn", code, origin: window.location.origin } });
        }
        setGoogleError(mapped ?? (err instanceof Error ? parseFirebaseError(err) : "Google sign-in failed"));
      }
    } finally {
      setGoogleLoading(false);
    }
  }, []);

  const beginMfaChallenge = useCallback((err: unknown, method: MfaMethod): boolean => {
    const challenge = getMfaChallenge(err);
    if (!challenge) return false;
    logger.info("mfa_challenge_captured", { factorCount: challenge.hints.length, method });
    setMfaMethod(method);
    setMfaChallenge(challenge);
    return true;
  }, []);

  const clearMfaChallenge = useCallback(() => setMfaChallenge(null), []);

  // A resolved session retires the challenge: the resolver is single-use, so
  // holding it once the user is signed in would re-render a dead card if they
  // ever returned to /auth in the same tab.
  //
  // This is also where the deferred `sign_in` event fires. The sign-in attempt
  // that provoked the challenge recorded neither success nor failure, so
  // without this an MFA user would be an attempt with no outcome. Guarded on a
  // challenge actually being pending, so ordinary sign-ins (which emit their
  // own event at the call site) are not double-counted.
  useEffect(() => {
    if (!user || !mfaChallenge) return;
    logger.info("mfa_sign_in_completed", { uid: user.uid, method: mfaMethod });
    analytics.signIn(mfaMethod);
    metrics.signIn(mfaMethod, user.uid);
    setMfaChallenge(null);
  }, [user, mfaChallenge, mfaMethod]);

  // Reactive analytics-consent gate. PostHog identify is only permitted once
  // the user has accepted the ConsentBanner (see PrivacyPolicy §Usage data:
  // "Analytics are only active after you accept the consent banner"). This
  // flips live, so an already-signed-in user who accepts later still gets
  // identified — the identity effect below is keyed on it.
  const analyticsConsented = useAnalyticsConsent();

  // Keep analytics + error-tracking identity in sync with Firebase auth
  // state. PostHog.reset() must fire on sign-out so the next anonymous
  // session doesn't inherit the previous user's distinct_id (which would
  // silently merge cohorts). Sentry uses the same surrogate for scoped issues.
  useEffect(() => {
    if (user) {
      const username = activeProfile?.username;
      // Hash the uid before it reaches PostHog / Sentry. hashIdentity is a
      // stable, deterministic surrogate, so the distinct_id stays consistent
      // per user (analytics continuity, sign-out reset still works) while the
      // raw Firebase identifier never leaves the app.
      const surrogateId = hashIdentity(user.uid);
      // Sentry is crash/error reporting under legitimate interest (PrivacyPolicy
      // §Error data — no consent gate; PII is stripped in main.tsx beforeSend),
      // so setUser stays unconditional. PostHog is analytics: gate on consent.
      setSentryUser({ id: surrogateId, ...(username ? { username } : {}) });
      if (analyticsConsented) {
        posthogIdentify(surrogateId, username ? { username } : undefined);
      }
    } else {
      posthogReset();
      setSentryUser(null);
    }
  }, [user, activeProfile?.username, analyticsConsented]);

  // Refresh the native push token after sign-in. Gated on isPushSupported()
  // so web users never hit the Capacitor plugin (which throws "unimplemented"
  // in the browser), and on the NON-PROMPTING variant so signing in can never
  // raise a cold OS permission dialog — the prompting path belongs to explicit
  // user action in the notification settings flow. Mirrors the web split
  // below (refreshWebPushTokenIfGranted). Best-effort — errors inside
  // registerPushTokenIfGranted are already swallowed and logged; this effect
  // must never block the login flow.
  useEffect(() => {
    if (!user) return;
    if (!isPushSupported()) return;
    const uid = user.uid;
    void registerPushTokenIfGranted(uid).catch((err: unknown) => {
      logger.warn("push_register_unhandled", { uid, message: parseFirebaseError(err) });
    });
  }, [user]);

  // Web push token refresh-on-login. Native registration is handled by the
  // Capacitor plugin branch above; this effect is web-only and runs when the
  // browser permission is already granted. Without this, users who granted
  // notifications in a prior session but later lost/rotated their FCM token
  // (new browser profile, cleared SW state, token invalidated server-side)
  // never re-register unless they manually revisit the push settings flow.
  // Best-effort only: failure to refresh the token must not block auth.
  useEffect(() => {
    if (!user) return;
    if (isPushSupported()) return; // native handled by registerPushToken
    if (globalThis.Notification?.permission !== "granted") return;
    const uid = user.uid;
    void refreshWebPushTokenIfGranted(uid).catch((err: unknown) => {
      logger.warn("web_push_register_unhandled", { uid, message: parseFirebaseError(err) });
    });
  }, [user]);

  // Invalidate pendingDeleteUid when a different auth user arrives (someone
  // else signs in on the same tab) — the banner must not prompt them to
  // finish deleting a stranger's account.
  useEffect(() => {
    if (!user || !pendingDeleteUid) return;
    if (user.uid !== pendingDeleteUid) {
      logger.info("delete_account_pending_retry_cleared", {
        uid: pendingDeleteUid,
        reason: "different_user_signed_in",
      });
      clearPendingDeleteUid();
      setPendingDeleteUid(null);
    }
  }, [user, pendingDeleteUid]);

  const handleSignOut = useCallback(async () => {
    logger.info("user_sign_out");
    // Scrub FCM/push tokens BEFORE fbSignOut — the owner-only rules on
    // users/{uid}/private/profile deny writes once the auth token is gone.
    // Gate on `user` (Firebase Auth source of truth), not activeProfile,
    // so the scrub still runs if the profile doc was deleted mid-session.
    if (user) {
      try {
        await removeCurrentFcmToken(user.uid);
      } catch (err) {
        logger.warn("sign_out_fcm_scrub_failed", { uid: user.uid, message: parseFirebaseError(err) });
      }
      try {
        await unregisterPushToken(user.uid);
      } catch (err) {
        logger.warn("sign_out_push_scrub_failed", { uid: user.uid, message: parseFirebaseError(err) });
      }
    }
    try {
      await fbSignOut();
    } catch (err) {
      logger.error("sign_out_error", { message: parseFirebaseError(err) });
    }
    setActiveProfile(null);
    setMfaChallenge(null);
  }, [user]);

  const handleDeleteAccount = useCallback(async () => {
    if (!activeProfile) {
      // Recovery path, and it is now genuinely recoverable. Two ways to land
      // here: the user bounced off auth/requires-recent-login and signed back
      // in, or a previous attempt erased the data but failed to delete the Auth
      // record — which leaves a signed-in user with no profile doc.
      //
      // This used to give up, because the client needed the username to release
      // the reservation and there was no profile left to read it from. The
      // server derives the username itself now, so a retry needs nothing but
      // the uid, and the remaining cascade re-runs as a no-op before deleting
      // the Auth user. Bailing here was what stranded the orphaned Auth record.
      const pending = readPendingDeleteUid();
      if (!pending || !user || pending !== user.uid) {
        return;
      }
      logger.info("delete_account_pending_retry_without_profile", { uid: pending });
      await deleteAccount(pending);
      clearPendingDeleteUid();
      setPendingDeleteUid(null);
      return;
    }
    // Snapshot identity once: the flow spans multiple async boundaries and
    // setActiveProfile(null) runs on success. Reading the profile object
    // after each await invites stale-closure / mid-flow state drift.
    const { uid, username } = activeProfile;
    logger.info("delete_account_start", { uid, username });
    // Capture the pending uid BEFORE the attempt, so a crash / browser kill
    // mid-delete is still recoverable on next load. It's cleared on success.
    // On auth/requires-recent-login the flag stays set so the "Finish
    // deletion" affordance surfaces after the user re-authenticates.
    writePendingDeleteUid(uid);
    setPendingDeleteUid(uid);
    logger.info("delete_account_pending_retry_captured", { uid });
    // Unregister native push BEFORE Auth deletion — the owner-only rule on
    // users/{uid}/private/profile denies the arrayRemove write once the
    // auth token is revoked, and deleteUserData's Phase 4 batch torches
    // the whole private doc anyway. Fire-and-forget: errors here must
    // never block deletion, and we don't want an extra await boundary
    // altering the observable ordering of the deleteAccount call.
    void unregisterPushToken(uid).catch((err: unknown) => {
      logger.warn("delete_account_push_scrub_failed", { uid, message: parseFirebaseError(err) });
    });
    let result: { authDeleted: boolean };
    try {
      // deleteAccount delegates to the server, which erases the data with
      // admin credentials and deletes the Auth user LAST. Any throw here
      // means the erasure did not happen and the account is untouched — the
      // profile is intact and the flow can be retried cleanly (server-side
      // phases are idempotent, so a retry resumes rather than double-deletes).
      // The username is not passed: the server reads it from the profile it is
      // deleting, so a caller can never name another user's reservation.
      result = await deleteAccount(uid);
    } catch (err) {
      const code = getErrorCode(err);
      logger.error("delete_account_auth_failed", { uid, code });
      captureException(err, {
        extra: {
          context: "deleteAccount failed — erasure did not run, account left intact",
          uid,
          username,
          code,
        },
      });
      if (code === "auth/requires-recent-login") {
        throw new Error(
          "For security, please sign out and sign back in, then tap Finish deletion to finish removing your account.",
          { cause: err },
        );
      }
      // Other failure modes (network, quota, etc.) — bubble the raw error
      // back. pending flag stays set so a retry still shows the banner.
      throw err;
    }
    logger.info("delete_account_auth_done", { uid });
    metrics.accountDeleted(uid);
    // The data is gone either way. Only clear the pending marker once the Auth
    // record is gone too — if it survived, keeping the marker is what leaves
    // the "Finish deletion" affordance reachable so the orphaned Auth record
    // can still be cleaned up by the user rather than only by an operator.
    if (result.authDeleted) {
      clearPendingDeleteUid();
      setPendingDeleteUid(null);
      logger.info("delete_account_pending_retry_cleared", { uid, reason: "first_attempt_success" });
    } else {
      logger.warn("delete_account_pending_retry_held", { uid, reason: "auth_record_survived" });
    }
    setActiveProfile(null);
  }, [activeProfile, user]);

  /**
   * GDPR Article 20 / CCPA data-portability export. Collects the user's data
   * from Firestore, packs it into a JSON bundle, and triggers a browser
   * download. Runs entirely client-side so there's no server dependency and
   * the same auth context that gates normal reads gates the export.
   */
  const handleDownloadData = useCallback(async () => {
    /* v8 ignore start -- null guard unreachable in tests; button hidden when profile is null */
    if (!activeProfile) return;
    /* v8 ignore stop */
    logger.info("download_data_start", { uid: activeProfile.uid });
    try {
      const bundle = await exportUserData(activeProfile.uid, activeProfile.username);
      const blob = new Blob([serializeUserData(bundle)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = userDataFilename(bundle);
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Defer revocation so Safari/WebKit doesn't cancel the download mid-
      // flight — modern Chrome/Firefox queue the save before click() returns,
      // but older WebKit historically races the blob fetch.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      logger.info("download_data_done", {
        uid: activeProfile.uid,
        games: bundle.games.length,
        clips: bundle.clips.length,
        reports: bundle.reports.length,
      });
    } catch (err) {
      captureException(err, {
        extra: { context: "download_data_failed", uid: activeProfile.uid },
      });
      throw err; // Lobby still surfaces the message to the user
    }
  }, [activeProfile]);

  const value: AuthContextValue = {
    loading,
    user,
    activeProfile,
    setActiveProfile,
    refreshProfile,
    reloadAuthUser,
    handleGoogleSignIn,
    googleLoading,
    googleError,
    setGoogleError,
    mfaChallenge,
    beginMfaChallenge,
    clearMfaChallenge,
    handleSignOut,
    handleDeleteAccount,
    handleDownloadData,
    pendingDeleteUid,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
