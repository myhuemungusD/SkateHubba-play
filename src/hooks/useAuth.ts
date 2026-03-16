import { useState, useEffect, useCallback, useRef } from "react";
import type { User } from "firebase/auth";
import { onAuthChange } from "../services/auth";
import { getUserProfile, type UserProfile } from "../services/users";
import { logger } from "../services/logger";
import { parseFirebaseError } from "../utils/helpers";

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
      if (u) {
        // Keep loading=true while we fetch the profile so the routing effect
        // doesn't see a user with no profile and prematurely navigate to
        // ProfileSetup (causes a visible flicker for returning Google users).
        setLoading(true);
        try {
          const p = await getUserProfile(u.uid);
          logger.debug("use_auth_profile_loaded", { uid: u.uid, hasProfile: !!p, username: p?.username ?? null });
          setProfile(p);
        } catch (err) {
          // Profile may not exist yet (new user) or Firestore not ready
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

  return { loading, user, profile, refreshProfile };
}
