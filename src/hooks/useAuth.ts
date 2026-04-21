import { useState, useEffect, useCallback, useRef } from "react";
import type { User } from "firebase/auth";
import { onAuthChange, reloadUser } from "../services/auth";
import { getUserProfile, getUserProfileOnAuth, type UserProfile } from "../services/users";
import { logger } from "../services/logger";
import { parseFirebaseError } from "../utils/helpers";
import { setUser as setSentryUser } from "../lib/sentry";

interface AuthState {
  loading: boolean;
  user: User | null;
  profile: UserProfile | null;
  refreshProfile: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const userRef = useRef<User | null>(null);

  // Keep a ref in sync so refreshProfile always uses latest user
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const refreshProfile = useCallback(async () => {
    const u = userRef.current;
    if (!u) {
      logger.debug("refresh_profile_skip_no_user");
      setProfile(null);
      return;
    }
    logger.debug("refresh_profile_start", { uid: u.uid });
    try {
      const p = await getUserProfile(u.uid);
      logger.debug("refresh_profile_result", { uid: u.uid, hasProfile: !!p, username: p?.username ?? null });
      setProfile(p);
    } catch (err) {
      // Firestore read may fail transiently — keep the existing profile rather
      // than clearing it, which would wrongly route the user to profile setup.
      logger.warn("refresh_profile_error", { uid: u.uid, error: parseFirebaseError(err) });
    }
  }, []);

  useEffect(() => {
    logger.debug("use_auth_subscribe");
    const unsub = onAuthChange(async (u) => {
      logger.debug("use_auth_change", { uid: u?.uid ?? null });
      setUser(u);
      userRef.current = u;
      setSentryUser(u ? { id: u.uid } : null);
      if (u) {
        // Keep loading=true while we fetch the profile so the routing effect
        // doesn't see a user with no profile and prematurely navigate to
        // ProfileSetup (causes a visible flicker for returning Google users).
        setLoading(true);
        try {
          // Cap the lookup at 20s so a hung Firestore request (App Check stall,
          // offline cache never catching up) can't wedge the spinner forever.
          // getUserProfile has its own withRetry budget (~3–5s) so the cap only
          // ever fires in pathological cases. The previous 10s cap was aggressive
          // enough to cut off cold-start round-trips on slow connections —
          // returning users were then falsely routed to /profile and asked to
          // re-register because their profile appeared missing.
          /* v8 ignore start -- safety timeout; can't trigger in unit tests without 20s delay */
          // getUserProfileOnAuth wraps the plain getUserProfile call with a
          // one-shot permission-denied retry to cover the auth-token
          // propagation race — onAuthStateChanged can fire a few hundred
          // milliseconds before Firestore has absorbed the fresh ID token,
          // at which point the first read throws and we'd wrongly treat
          // the user as profile-less.
          const p = await Promise.race([
            getUserProfileOnAuth(u),
            new Promise<null>((r) => setTimeout(() => r(null), 20_000)),
          ]);
          /* v8 ignore stop */
          logger.debug("use_auth_profile_loaded", { uid: u.uid, hasProfile: !!p, username: p?.username ?? null });
          setProfile(p);
        } catch (err) {
          // Profile may not exist yet (new user) or Firestore not ready.
          // We still null out here so the routing effect sends the user to
          // /profile, where ProfileSetup re-attempts the lookup and, on
          // repeated failure, shows a retry affordance instead of the
          // create-profile form. This guards returning users from being
          // led to re-register over the top of their existing profile.
          logger.warn("use_auth_profile_fetch_error", {
            uid: u.uid,
            error: parseFirebaseError(err),
          });
          setProfile(null);
        }
      } else {
        logger.debug("use_auth_signed_out");
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  // When the user returns to the tab after clicking a verification link in
  // another tab/browser, onAuthStateChanged does NOT fire.  We detect the
  // page becoming visible and force-refresh the auth token so the UI picks
  // up the updated emailVerified claim.
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      const u = userRef.current;
      if (!u || u.emailVerified) return;
      try {
        const verified = await reloadUser();
        if (verified) {
          logger.debug("visibility_reload_verified", { uid: u.uid });
          // Trigger a re-render with the refreshed user object.  Firebase
          // mutates the User in place on reload(), so we clone via the
          // getter to force React state to update.
          setUser(Object.assign(Object.create(Object.getPrototypeOf(u)), u));
        }
      } catch {
        // Network error while reloading — non-critical, will retry on next focus.
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return { loading, user, profile, refreshProfile };
}
