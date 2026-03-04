import { useState, useEffect, useCallback, useRef } from "react";
import type { User } from "firebase/auth";
import { onAuthChange } from "../services/auth";
import { getUserProfile, type UserProfile } from "../services/users";

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
      setProfile(null);
      return;
    }
    try {
      const p = await getUserProfile(u.uid);
      setProfile(p);
    } catch {
      // Firestore read may fail transiently
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthChange(async (u) => {
      setUser(u);
      userRef.current = u;
      if (u) {
        try {
          const p = await getUserProfile(u.uid);
          setProfile(p);
        } catch {
          // Profile may not exist yet (new user) or Firestore not ready
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  return { loading, user, profile, refreshProfile };
}
