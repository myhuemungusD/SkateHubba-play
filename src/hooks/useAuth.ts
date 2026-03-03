import { useState, useEffect } from "react";
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

  const refreshProfile = async () => {
    if (!user) {
      setProfile(null);
      return;
    }
    const p = await getUserProfile(user.uid);
    setProfile(p);
  };

  useEffect(() => {
    const unsub = onAuthChange(async (u) => {
      setUser(u);
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

  // Re-fetch profile when user changes
  useEffect(() => {
    if (user && !profile) {
      getUserProfile(user.uid).then(setProfile).catch(() => setProfile(null));
    }
  }, [user, profile]);

  return { loading, user, profile, refreshProfile };
}
