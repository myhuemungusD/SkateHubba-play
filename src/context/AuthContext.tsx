import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { signOut as fbSignOut, signInWithGoogle, resolveGoogleRedirect, deleteAccount } from "../services/auth";
import { deleteUserData } from "../services/users";
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

  const [activeProfile, setActiveProfile] = useState<UserProfile | null>(null);
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
    try {
      await fbSignOut();
    } catch (err) {
      logger.error("sign_out_error", { message: parseFirebaseError(err) });
    }
    setActiveProfile(null);
  }, []);

  const handleDeleteAccount = useCallback(async () => {
    // Recovery path: after the Firestore wipe + auth/requires-recent-login
    // bounce the user signed out and back in, so their profile doc is gone
    // and activeProfile is null — but the auth account is still alive with
    // a matching pendingDeleteUid stored from the first attempt. Resume the
    // auth-delete-only branch instead of bailing out.
    if (!activeProfile) {
      const pending = readPendingDeleteUid();
      if (!pending || !user || pending !== user.uid) {
        // Either no pending capture, or the signed-in user isn't the one
        // mid-deletion — nothing we can safely do here.
        return;
      }
      logger.info("delete_account_pending_retry_resumed", { uid: pending });
      try {
        await deleteAccount();
      } catch (err) {
        const code = getErrorCode(err);
        logger.error("delete_account_auth_failed", { uid: pending, code, resume: true });
        captureException(err, {
          extra: {
            context: "deleteAccount retry after Firestore wipe — data deleted, auth alive",
            uid: pending,
            code,
            resume: true,
          },
        });
        if (code === "auth/requires-recent-login") {
          // Still not recent enough — tell the user to sign out and sign
          // back in again. The pending flag stays set so the next retry
          // finds it.
          throw new Error("For security, please sign out and sign back in, then tap Finish deletion again.", {
            cause: err,
          });
        }
        throw err;
      }
      logger.info("delete_account_auth_done", { uid: pending, resume: true });
      metrics.accountDeleted(pending);
      clearPendingDeleteUid();
      setPendingDeleteUid(null);
      logger.info("delete_account_pending_retry_cleared", { uid: pending, reason: "resume_success" });
      return;
    }
    // Snapshot identity once: the flow spans multiple async boundaries and
    // setActiveProfile(null) runs on success. Reading the profile object
    // after each await invites stale-closure / mid-flow state drift.
    const { uid, username } = activeProfile;
    logger.info("delete_account_start", { uid, username });
    // GDPR: Firestore data MUST be deleted first. Once the Firebase Auth
    // account is gone the auth token is revoked, so any subsequent Firestore
    // writes fail security rules silently and the user's docs (profile,
    // username reservation, clips, blocked users, fcmTokens, etc.) are
    // orphaned. deleteUserData is idempotent — missing docs are no-ops and
    // per-doc clip/video failures are swallowed — so it is safe to retry
    // after an auth/requires-recent-login bounce.
    try {
      await deleteUserData(uid, username);
    } catch (firestoreErr) {
      logger.error("delete_account_firestore_failed", {
        uid,
        username,
        code: getErrorCode(firestoreErr),
        error: firestoreErr instanceof Error ? firestoreErr.message : String(firestoreErr),
      });
      captureException(firestoreErr, {
        extra: {
          context: "deleteUserData before auth deletion — account preserved for retry",
          uid,
          username,
        },
      });
      throw firestoreErr;
    }
    logger.info("delete_account_firestore_done", { uid });
    // Capture the pending uid NOW, before the auth-delete attempt, so a
    // crash / browser kill between Firestore wipe and auth delete is
    // still recoverable on next load. It's cleared on full success below.
    writePendingDeleteUid(uid);
    setPendingDeleteUid(uid);
    logger.info("delete_account_pending_retry_captured", { uid });
    try {
      await deleteAccount();
    } catch (err) {
      const code = getErrorCode(err);
      logger.error("delete_account_auth_failed", { uid, code });
      // Firestore was wiped but auth is still alive — the "reverse orphan"
      // state. Alert Sentry on every variant so operators can detect users
      // stranded mid-deletion, including the expected requires-recent-login
      // bounce (harmless on its own, but a spike signals the reauth UX is
      // failing to funnel users back through the retry).
      captureException(err, {
        extra: {
          context: "deleteAccount after Firestore wipe — data deleted, auth alive",
          uid,
          username,
          code,
        },
      });
      if (code === "auth/requires-recent-login") {
        // The user needs to sign out, sign back in, and re-trigger the flow.
        // The pending-delete capture above lets the retry skip deleteUserData
        // (data is already gone) and lets the banner surface even after
        // activeProfile goes null on sign-back-in.
        throw new Error(
          "For security, please sign out and sign back in, then tap Finish deletion to finish removing your account.",
          { cause: err },
        );
      }
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
    pendingDeleteUid,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
