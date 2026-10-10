import { useEffect, useState } from "react";
import { achievementById, levelForXp } from "../constants/xp";
import { fetchAchievements } from "../services/achievements";
import { getUserProfile, type UserProfile } from "../services/users";

export interface LevelUpMoment {
  /** The new level, or null when this game did not cross one. */
  level: number | null;
  /** Up to three achievement short names unlocked after the screen opened. */
  names: string[];
  reduceMotion: boolean;
}

const EMPTY: LevelUpMoment = { level: null, names: [], reduceMotion: false };
/** A few looks over about ten seconds. The close-out lands after the game doc. */
const DELAYS_MS = [0, 2000, 5000, 8000];

/**
 * Refetch the signed-in profile after a game ends. If `xp` maps to a higher
 * level than the profile the screen opened with, surface that level. A failed
 * refetch skips the moment. The client does not invent a level from the game.
 */
export function useLevelUpMoment(
  profile: UserProfile,
  enabled: boolean,
  onRefresh?: () => Promise<void>,
): LevelUpMoment {
  const [moment, setMoment] = useState<LevelUpMoment>(EMPTY);
  const openedLevel = levelForXp(profile.xp ?? 0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    let baselineIds: Set<string> | null = null;
    let announced = false;

    const timers = DELAYS_MS.map((delay, index) =>
      window.setTimeout(() => {
        void look(index === 0);
      }, delay),
    );

    async function look(isFirst: boolean): Promise<void> {
      if (announced) return;
      try {
        const next = await getUserProfile(profile.uid);
        if (!next || cancelled) return;
        const earned = await fetchAchievements(profile.uid);
        if (cancelled) return;
        const nextLevel = levelForXp(next.xp ?? 0);
        if (nextLevel <= openedLevel) {
          if (isFirst) baselineIds = new Set(earned.map((item) => item.id));
          return;
        }
        const priorIds = baselineIds;
        const names =
          priorIds === null
            ? []
            : earned
                .filter((item) => !priorIds.has(item.id))
                .map((item) => achievementById(item.id)?.shortName)
                .filter((name): name is string => typeof name === "string")
                .slice(0, 3);
        announced = true;
        setMoment({ level: nextLevel, names, reduceMotion });
        try {
          await onRefresh?.();
        } catch {
          // The moment already has the level. A profile refresh failure
          // just leaves the chip stale until the next visit.
        }
      } catch {
        // A failed refetch skips the moment.
      }
    }

    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [enabled, onRefresh, openedLevel, profile.uid]);

  return enabled ? moment : EMPTY;
}
