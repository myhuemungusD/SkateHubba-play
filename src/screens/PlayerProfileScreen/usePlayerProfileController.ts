import { useCallback, useEffect, useMemo, useState } from "react";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { blockUser, unblockUser } from "../../services/blocking";
import { fetchAchievements, type Achievement } from "../../services/achievements";
import { fetchLockerItems, type LockerItem } from "../../services/locker";
import { logger } from "../../services/logger";
import { parseFirebaseError } from "../../utils/helpers";
import { ratedWinRate } from "../../constants/stats";
import { usePlayerProfile } from "../../hooks/usePlayerProfile";

export interface OpponentRecord {
  uid: string;
  username: string;
  wins: number;
  losses: number;
  totalGames: number;
  isVerifiedPro?: boolean;
}

/**
 * Stats shape the profile screen renders. Counter fields read straight off
 * the profile doc (wins/losses) — main's stats-counter peer-write feature
 * keeps them up to date without the client recomputing from history. The
 * H2H (vsYou*) record is still derived from local games because it is
 * inherently per-viewer and isn't stored on the profile doc.
 */
export interface ProfileStats {
  wins: number;
  losses: number;
  total: number;
  /**
   * Whole-percent win rate, or `null` when the player has not yet played
   * `MIN_RATED_GAMES`. Null is rendered as a neutral placeholder — a
   * provisional record must not be shown as "100%" or "0%".
   */
  winRate: number | null;
  /** Consecutive wins ending now. 0 for legacy docs predating the counter. */
  currentWinStreak: number;
  /** Lifetime best streak. 0 for legacy docs predating the counter. */
  bestWinStreak: number;
  vsYouWins: number;
  vsYouLosses: number;
  vsYouTotal: number;
  /**
   * Binding community-dispute counters. Public, server-written by the dispute
   * referee; 0 for docs predating the feature. See
   * docs/DISPUTE_BINDING_DESIGN.md §2.
   */
  /** This user's landed claims that got disputed. */
  tricksDisputed: number;
  /** Disputes this user initiated. */
  disputesRaised: number;
  /** Of raised disputes, the ones the community upheld (bail verdict). */
  disputesRight: number;
  /** Of raised disputes, the ones the community overturned (land verdict). */
  disputesWrong: number;
}

interface Args {
  viewedUid: string;
  currentUserProfile: UserProfile;
  ownGames: GameDoc[];
  isOwnProfile: boolean;
  blockedUids?: Set<string>;
}

export interface PlayerProfileController {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  completedGames: GameDoc[];
  stats: ProfileStats;
  opponents: OpponentRecord[];
  /** Earned badges. Empty until the parallel fetch resolves, and on failure. */
  achievements: Achievement[];
  /** Earned locker gear. Empty until the parallel fetch resolves, and on failure. */
  lockerItems: LockerItem[];

  expandedGameId: string | null;
  toggleExpanded: (id: string) => void;

  isBlocked: boolean;
  blockLoading: boolean;
  showBlockConfirm: boolean;
  openBlockConfirm: () => void;
  cancelBlockConfirm: () => void;
  confirmBlock: () => Promise<void>;
  handleUnblock: () => Promise<void>;
}

export function usePlayerProfileController({
  viewedUid,
  currentUserProfile,
  ownGames,
  isOwnProfile,
  blockedUids,
}: Args): PlayerProfileController {
  const fetchedData = usePlayerProfile(isOwnProfile ? "" : viewedUid, currentUserProfile.uid);

  const profile = isOwnProfile ? currentUserProfile : fetchedData.profile;
  const games = isOwnProfile ? ownGames : fetchedData.games;
  const loading = isOwnProfile ? false : fetchedData.loading;
  const error = isOwnProfile ? null : fetchedData.error;

  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [blockLoading, setBlockLoading] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const isBlocked = blockedUids?.has(viewedUid) ?? false;

  const toggleExpanded = useCallback((id: string) => {
    setExpandedGameId((prev) => (prev === id ? null : id));
  }, []);

  /**
   * Economy Phase A: badges + locker gear. Fetched in parallel with each other
   * and alongside the profile load — neither blocks `loading`, so the record
   * and stats paint immediately and these sections fill in.
   *
   * Fail-soft *per section*, which is why this is `allSettled` and not `all`:
   * with `all`, a locker permission-denied would also blank a badges row that
   * fetched perfectly well. Each result is applied on its own, and a rejection
   * leaves that one section empty — which renders as "nothing earned yet".
   *
   * The rejection value goes through `logger.warn` rather than a bare
   * `console.warn` so a production permission-denied lands in Sentry
   * breadcrumbs instead of being discarded.
   */
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [lockerItems, setLockerItems] = useState<LockerItem[]>([]);

  useEffect(() => {
    if (!viewedUid) return;
    let stale = false;
    void Promise.allSettled([fetchAchievements(viewedUid), fetchLockerItems(viewedUid)]).then(([earned, gear]) => {
      if (stale) return;
      if (earned.status === "fulfilled") setAchievements(earned.value);
      else logger.warn("profile_achievements_load_failed", { error: parseFirebaseError(earned.reason) });
      if (gear.status === "fulfilled") setLockerItems(gear.value);
      else logger.warn("profile_locker_load_failed", { error: parseFirebaseError(gear.reason) });
    });
    return () => {
      stale = true;
    };
  }, [viewedUid]);

  const completedGames = useMemo(
    () =>
      games
        .filter((g) => g.status === "complete" || g.status === "forfeit")
        .sort((a, b) => {
          const aTime = a.updatedAt?.toMillis?.() ?? 0;
          const bTime = b.updatedAt?.toMillis?.() ?? 0;
          return bTime - aTime;
        }),
    [games],
  );

  /**
   * Stats: counter fields read directly off the profile doc (main's stats
   * peer-write feature keeps `wins` / `losses` in sync). The plan's
   * original §3 schema with derived `tricks*`/`level`/`streak` counters
   * is not on main yet, so we surface only what exists today.
   *
   * H2H (`vsYou*`) is still computed from `completedGames` because the
   * per-opponent record is inherently per-viewer and not stored on the
   * profile doc.
   */
  const stats = useMemo<ProfileStats>(() => {
    const wins = profile?.wins ?? 0;
    const losses = profile?.losses ?? 0;
    const total = wins + losses;
    const winRate = ratedWinRate(wins, losses);
    const currentWinStreak = profile?.currentWinStreak ?? 0;
    const bestWinStreak = profile?.bestWinStreak ?? 0;

    let vsYouWins = 0;
    let vsYouLosses = 0;
    if (profile) {
      for (const g of completedGames) {
        // From the viewer's perspective: a profile-side WIN against the
        // viewer is a viewer-side LOSS (and vice versa). The viewer's uid
        // is currentUserProfile.uid; the profile being viewed is profile.uid.
        if (g.winner === profile.uid) vsYouLosses++;
        else if (g.winner === currentUserProfile.uid) vsYouWins++;
      }
    }

    return {
      wins,
      losses,
      total,
      winRate,
      currentWinStreak,
      bestWinStreak,
      vsYouWins,
      vsYouLosses,
      vsYouTotal: vsYouWins + vsYouLosses,
      tricksDisputed: profile?.tricksDisputed ?? 0,
      disputesRaised: profile?.disputesRaised ?? 0,
      disputesRight: profile?.disputesRight ?? 0,
      disputesWrong: profile?.disputesWrong ?? 0,
    };
  }, [profile, completedGames, currentUserProfile.uid]);

  const opponents = useMemo<OpponentRecord[]>(() => {
    if (!profile) return [];
    const map = new Map<string, OpponentRecord>();

    for (const g of completedGames) {
      const isP1 = g.player1Uid === profile.uid;
      const oppUid = isP1 ? g.player2Uid : g.player1Uid;
      const oppName = isP1 ? g.player2Username : g.player1Username;
      const oppIsPro = isP1 ? g.player2IsVerifiedPro : g.player1IsVerifiedPro;
      const won = g.winner === profile.uid;

      let rec = map.get(oppUid);
      if (!rec) {
        rec = { uid: oppUid, username: oppName, wins: 0, losses: 0, totalGames: 0, isVerifiedPro: oppIsPro };
        map.set(oppUid, rec);
      }
      if (won) rec.wins++;
      else rec.losses++;
      rec.totalGames++;
    }

    return Array.from(map.values()).sort((a, b) => b.totalGames - a.totalGames);
  }, [completedGames, profile]);

  const openBlockConfirm = useCallback(() => setShowBlockConfirm(true), []);
  const cancelBlockConfirm = useCallback(() => setShowBlockConfirm(false), []);

  const confirmBlock = useCallback(async () => {
    if (!profile) return;
    setBlockLoading(true);
    try {
      await blockUser(currentUserProfile.uid, profile.uid);
      setShowBlockConfirm(false);
    } finally {
      setBlockLoading(false);
    }
  }, [currentUserProfile.uid, profile]);

  const handleUnblock = useCallback(async () => {
    if (!profile) return;
    setBlockLoading(true);
    try {
      await unblockUser(currentUserProfile.uid, profile.uid);
    } finally {
      setBlockLoading(false);
    }
  }, [currentUserProfile.uid, profile]);

  return {
    profile,
    loading,
    error,
    completedGames,
    stats,
    opponents,
    achievements,
    lockerItems,
    expandedGameId,
    toggleExpanded,
    isBlocked,
    blockLoading,
    showBlockConfirm,
    openBlockConfirm,
    cancelBlockConfirm,
    confirmBlock,
    handleUnblock,
  };
}
