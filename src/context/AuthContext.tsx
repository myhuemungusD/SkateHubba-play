import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { signOut as fbSignOut, signInWithGoogle, resolveGoogleRedirect, deleteAccount } from "../services/auth";
import { removeCurrentFcmToken } from "../services/fcm";
import { isPushSupported, registerPushToken, unregisterPushToken } from "../services/pushNotifications";
import type { UserProfile } from "../services/users";
import { exportUserData, serializeUserData, userDataFilename } from "../services/userData";
import { getErrorCode, parseFirebaseError } from "../utils/helpers";
import { analytics } from "../services/analytics";
import { logger, metrics } from "../services/logger";
import { captureException, setUser as setSentryUser } from "../lib/sentry";
import { identify as posthogIdentify, resetIdentity as posthogReset } from "../lib/posthog";

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

export interface AuthContextValue {
  loading: boolean;
  user: ReturnType<typeof useAuth>["user"];
  activeProfile: UserProfile | null;
  setActiveProfile: (p: UserProfile | null) => void;
  refreshProfile: () => Promise<void>;
  handleGoogleSignIn: () => Promise<void>;
  googleLoading: boolean;
  googleError: string;
  setGoogleError: (e: string) => void;
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
  const { loading, user, profile, refreshProfile } = useAuth();

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
        analytics.signInFailure("google", code || "redirect_error");
        metrics.signInFailure("google", code || "redirect_error");
        captureException(err, { extra: { context: "resolveGoogleRedirect" } });
        // Surface the same actionable copy as the popup-error path so a Safari /
        // mobile user who completed the OAuth redirect but landed back in a
        // failure state gets a hint at what's wrong (storage partition, expired
        // nonce, account disabled) instead of "try again" on a permanent issue.
        if (code === "auth/user-disabled") {
          setGoogleError("This account has been disabled. Please contact support if you think this is a mistake.");
        } else if (code === "auth/web-storage-unsupported") {
          setGoogleError(
            "Your browser is blocking sign-in storage. Disable private browsing or try a different browser.",
          );
        } else if (code === "auth/missing-or-invalid-nonce") {
          setGoogleError("Sign-in token expired. Please reload the page and try again.");
        } else if (code === "auth/account-exists-with-different-credential") {
          setGoogleError("This email is linked to a password account. Sign in with email/password instead.");
        } else {
          setGoogleError("Google sign-in failed. Please try again.");
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
      analytics.signInFailure("google", code || "unknown");
      metrics.signInFailure("google", code || "unknown");
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        logger.info("google_sign_in_dismissed", { code });
      } else if (code === "auth/account-exists-with-different-credential") {
        logger.warn("google_sign_in_credential_conflict", { code });
        captureException(err, { extra: { context: "handleGoogleSignIn", code } });
        setGoogleError("This email is linked to a password account. Sign in with email/password instead.");
      } else if (code === "auth/too-many-requests" || code === "auth/quota-exceeded") {
        logger.warn("google_sign_in_rate_limited", { code });
        setGoogleError("Too many attempts. Please wait a few minutes and try again.");
      } else if (code === "auth/user-disabled") {
        logger.warn("google_sign_in_user_disabled", { code });
        setGoogleError("This account has been disabled. Please contact support if you think this is a mistake.");
      } else if (code === "auth/web-storage-unsupported") {
        // Safari Private Browsing, locked-down WKWebViews, and storage-partitioned
        // 3p contexts surface here. Without explicit messaging the user thinks
        // sign-in just silently failed.
        logger.warn("google_sign_in_web_storage_unsupported", { code });
        setGoogleError(
          "Your browser is blocking sign-in storage. Disable private browsing or try a different browser.",
        );
      } else if (code === "auth/missing-or-invalid-nonce") {
        // Identity-token nonce mismatch — usually a stale tab or replay of an
        // expired OAuth response. Reloading clears the cached state.
        logger.warn("google_sign_in_nonce_invalid", { code });
        setGoogleError("Sign-in token expired. Please reload the page and try again.");
      } else if (code === "auth/timeout" || code === "auth/network-request-failed") {
        logger.warn("google_sign_in_network_error", { code });
        setGoogleError("Network error — check your connection and try again.");
      } else if (code === "auth/unauthorized-domain") {
        logger.error("google_sign_in_unauthorized_domain", { code, origin: window.location.origin });
        captureException(err, { extra: { context: "handleGoogleSignIn", code, origin: window.location.origin } });
        setGoogleError(
          "This domain isn't authorized for Google sign-in. " +
            "Add it in Firebase Console → Authentication → Settings → Authorized domains.",
        );
      } else if (code === "auth/internal-error") {
        // App Check rejection, reCAPTCHA failure, or transient Identity Toolkit 500.
        logger.error("google_sign_in_internal_error", { code, origin: window.location.origin });
        captureException(err, { extra: { context: "handleGoogleSignIn", code, origin: window.location.origin } });
        setGoogleError("Sign-in is temporarily unavailable. Please try again in a moment.");
      } else {
        logger.error("google_sign_in_error", { code, message: parseFirebaseError(err) });
        captureException(err, { extra: { context: "handleGoogleSignIn", code } });
        setGoogleError(err instanceof Error ? parseFirebaseError(err) : "Google sign-in failed");
      }
    } finally {
      setGoogleLoading(false);
    }
  }, []);

  // Keep analytics + error-tracking identity in sync with Firebase auth
  // state. PostHog.reset() must fire on sign-out so the next anonymous
  // session doesn't inherit the previous user's distinct_id (which would
  // silently merge cohorts). Sentry uses the same uid for scoped issues.
  useEffect(() => {
    if (user) {
      const username = activeProfile?.username;
      posthogIdentify(user.uid, username ? { username } : undefined);
      setSentryUser({ id: user.uid, ...(username ? { username } : {}) });
    } else {
      posthogReset();
      setSentryUser(null);
    }
  }, [user, activeProfile?.username]);

  // Register for native push notifications after sign-in. Gated on
  // isPushSupported() so web users never hit the Capacitor plugin (which
  // throws "unimplemented" in the browser). Best-effort — errors inside
  // registerPushToken are already swallowed and logged; this effect must
  // never block the login flow.
  useEffect(() => {
    if (!user) return;
    if (!isPushSupported()) return;
    const uid = user.uid;
    void registerPushToken(uid).catch((err: unknown) => {
      logger.warn("push_register_unhandled", { uid, message: parseFirebaseError(err) });
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
  }, [user]);

  const handleDeleteAccount = useCallback(async () => {
    if (!activeProfile) {
      // Recovery path: the user bounced off auth/requires-recent-login on a
      // previous attempt, signed out and back in. Auth is still alive; no
      // Firestore data was touched (reverse order: auth deletion runs first,
      // Firestore second). We need the username to wipe the reservation, so
      // if the profile didn't reload there's nothing safe to do here — the
      // retry falls through to a plain sign-out from the user's perspective.
      const pending = readPendingDeleteUid();
      if (!pending || !user || pending !== user.uid) {
        return;
      }
      // We still have the pending marker but no profile doc to read the
      // username from. Without the username we can't clean up the username
      // reservation. Clear the flag and bail — the user will need to
      // re-trigger from the account screen once their profile reloads, or
      // contact support if the profile is permanently gone.
      logger.warn("delete_account_pending_retry_no_profile", { uid: pending });
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
    try {
      // deleteAccount runs Auth deletion FIRST, then Firestore wipe with
      // retry. Any throw here means Auth deletion failed and NO Firestore
      // data was touched — the user's profile is intact and the flow can
      // be retried cleanly after re-auth.
      await deleteAccount(uid, username);
    } catch (err) {
      const code = getErrorCode(err);
      logger.error("delete_account_auth_failed", { uid, code });
      captureException(err, {
        extra: {
          context: "deleteAccount failed — Auth deletion bounced, Firestore data preserved",
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
    clearPendingDeleteUid();
    setPendingDeleteUid(null);
    logger.info("delete_account_pending_retry_cleared", { uid, reason: "first_attempt_success" });
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
    handleGoogleSignIn,
    googleLoading,
    googleError,
    setGoogleError,
    handleSignOut,
    handleDeleteAccount,
    handleDownloadData,
    pendingDeleteUid,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
