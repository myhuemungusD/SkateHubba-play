import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { signOut as fbSignOut, signInWithGoogle, resolveGoogleRedirect, deleteAccount } from "../services/auth";
import { removeCurrentFcmToken } from "../services/fcm";
import { deleteUserData } from "../services/users";
import type { UserProfile } from "../services/users";
import { exportUserData, serializeUserData, userDataFilename } from "../services/userData";
import { getErrorCode, parseFirebaseError } from "../utils/helpers";
import { analytics } from "../services/analytics";
import { logger, metrics } from "../services/logger";
import { captureException, setUser as setSentryUser } from "../lib/sentry";
import { identify as posthogIdentify, resetIdentity as posthogReset } from "../lib/posthog";

export interface AuthContextValue {
  loading: boolean;
  user: ReturnType<typeof useAuth>["user"];
  profile: UserProfile | null;
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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { loading, user, profile, refreshProfile } = useAuth();

  const [activeProfile, setActiveProfile] = useState<UserProfile | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState("");

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
        setGoogleError("Google sign-in failed. Please try again.");
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
      } else if (code === "auth/too-many-requests") {
        logger.warn("google_sign_in_rate_limited", { code });
        setGoogleError("Too many attempts. Please wait a few minutes and try again.");
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

  // Sync profile
  useEffect(() => {
    if (profile) setActiveProfile(profile);
  }, [profile]);

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

  const handleSignOut = useCallback(async () => {
    logger.info("user_sign_out");
    // Scrub this device's FCM token from the signed-in user's private
    // profile BEFORE revoking the auth token — otherwise the owner-only
    // rules on users/{uid}/private/profile deny the write. Without this
    // scrub the next account signed in on this device would inherit
    // push notifications meant for the previous user.
    //
    // The try/catch is defense-in-depth: removeCurrentFcmToken currently
    // delegates to removeFcmToken which swallows write failures internally,
    // so this catch is unreachable today. Kept so a future refactor that
    // propagates errors can't accidentally strand the user on a "still
    // signed in" screen when the scrub fails.
    if (activeProfile) {
      try {
        await removeCurrentFcmToken(activeProfile.uid);
      } catch (err) {
        logger.warn("sign_out_fcm_scrub_failed", { uid: activeProfile.uid, message: parseFirebaseError(err) });
      }
    }
    try {
      await fbSignOut();
    } catch (err) {
      logger.error("sign_out_error", { message: parseFirebaseError(err) });
    }
    setActiveProfile(null);
  }, [activeProfile]);

  const handleDeleteAccount = useCallback(async () => {
    /* v8 ignore start -- null guard unreachable in tests; delete button hidden when profile is null */
    if (!activeProfile) return;
    /* v8 ignore stop */
    const uid = activeProfile.uid;
    const username = activeProfile.username;
    logger.info("delete_account_start", { uid, username });
    // Delete Firestore data BEFORE the Firebase Auth account. The auth delete
    // revokes the user's ID token, which would make every subsequent
    // rules-gated Firestore delete fail with permission-denied and silently
    // orphan the user's data. If the data delete fails here, the auth
    // account is still intact so the user can retry.
    try {
      await deleteUserData(uid, username);
      logger.info("delete_account_firestore_done", { uid });
    } catch (firestoreErr) {
      logger.error("delete_account_firestore_failed", {
        uid,
        username,
        error: firestoreErr instanceof Error ? firestoreErr.message : String(firestoreErr),
      });
      captureException(firestoreErr, {
        extra: { context: "deleteUserData before auth deletion", uid, username },
      });
      throw firestoreErr;
    }
    try {
      await deleteAccount();
    } catch (err) {
      const code = getErrorCode(err);
      logger.error("delete_account_auth_failed_after_data", { uid, code });
      // Data is already gone. If auth-delete needs a recent login the user
      // must re-authenticate to finish; surface a recoverable error rather
      // than leaving the auth account permanently orphaned.
      if (code === "auth/requires-recent-login") {
        throw new Error("Your data was deleted. Sign out and back in, then retry to finish removing your account.", {
          cause: err,
        });
      }
      captureException(err, {
        extra: { context: "deleteAccount after data deletion — auth orphaned", uid },
      });
      throw err;
    }
    logger.info("delete_account_auth_done", { uid });
    metrics.accountDeleted(uid);
    setActiveProfile(null);
  }, [activeProfile]);

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
    profile,
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
