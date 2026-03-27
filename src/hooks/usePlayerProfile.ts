import { useState, useEffect } from "react";
import { getUserProfile, type UserProfile } from "../services/users";
import { fetchPlayerCompletedGames, type GameDoc } from "../services/games";

export interface PlayerProfileState {
  profile: UserProfile | null;
  games: GameDoc[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetch a player's public profile and completed games (one-time read).
 * Used for viewing any player's record, including other players' profiles.
 *
 * Pass an empty string for uid to skip fetching (used when viewing own profile).
 *
 * When `viewerUid` is provided, only games between both players are fetched.
 * This is required because Firestore rules restrict game reads to participants.
 */
export function usePlayerProfile(uid: string, viewerUid?: string): PlayerProfileState {
  const [data, setData] = useState<{
    fetchedUid: string;
    profile: UserProfile | null;
    games: GameDoc[];
    error: string | null;
  }>({ fetchedUid: "", profile: null, games: [], error: null });

  useEffect(() => {
    // Skip fetching when uid is empty (own profile uses props instead)
    if (!uid) return;

    let stale = false;

    Promise.all([getUserProfile(uid), fetchPlayerCompletedGames(uid, viewerUid)])
      .then(([fetchedProfile, fetchedGames]) => {
        if (stale) return;
        if (!fetchedProfile) {
          setData({ fetchedUid: uid, profile: null, games: [], error: "Player not found" });
        } else {
          setData({ fetchedUid: uid, profile: fetchedProfile, games: fetchedGames, error: null });
        }
      })
      .catch(() => {
        if (stale) return;
        setData({ fetchedUid: uid, profile: null, games: [], error: "Could not load player profile" });
      });

    return () => {
      stale = true;
    };
  }, [uid, viewerUid]);

  // Loading: uid is non-empty and data hasn't arrived for this uid yet
  const loading = uid !== "" && data.fetchedUid !== uid;

  return {
    profile: data.profile,
    games: data.games,
    loading,
    error: data.error,
  };
}
