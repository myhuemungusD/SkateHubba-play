import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { backfillStatsIfNeeded } from "../../services/users";
import { blockUser, unblockUser } from "../../services/blocking";
import { usePlayerProfile } from "../../hooks/usePlayerProfile";
import { addBreadcrumb } from "../../lib/sentry";

export interface OpponentRecord {
  uid: string;
  username: string;
  wins: number;
  losses: number;
  totalGames: number;
  isVerifiedPro?: boolean;
}

export interface ProfileStats {
  wins: number;
  losses: number;
  total: number;
  winRate: number;
  totalTricks: number;
  tricksLanded: number;
  landRate: number;
  longestStreak: number;
  currentStreak: number;
  vsYouWins: number;
  vsYouLosses: number;
  vsYouTotal: number;
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

  // ── PR-A2: lazy backfill on own-profile load ────────────────────────
  // Users whose profile predates PR-A1's counter wiring see all-zero
  // counters until a one-shot backfill runs. The service is idempotent
  // (returns `backfilled: false` if `statsBackfilledAt` is set) and
  // feature-flag gated, so calling it on every own-profile mount is
  // safe; the ref below de-dupes within a single mount so the inevitable
  // multi-fire of the parent profile snapshot listener doesn't queue
  // overlapping transactions while the first one is still in-flight.
  // Errors surface as Sentry breadcrumbs only — the screen falls back to
  // whatever counters are already on the profile (likely zeros) rather
  // than crashing the render.
  const backfillStartedRef = useRef(false);
  useEffect(() => {
    if (!isOwnProfile) return;
    if (backfillStartedRef.current) return;
    if (currentUserProfile.statsBackfilledAt != null) return;
    backfillStartedRef.current = true;
    backfillStatsIfNeeded(currentUserProfile.uid).catch((err: unknown) => {
      addBreadcrumb({
        category: "stats",
        level: "error",
        message: "backfillStatsIfNeeded.controller_error",
        data: {
          uid: currentUserProfile.uid,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    });
  }, [isOwnProfile, currentUserProfile.uid, currentUserProfile.statsBackfilledAt]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedGameId((prev) => (prev === id ? null : id));
  }, []);

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

  const stats = useMemo<ProfileStats>(() => {
    const empty: ProfileStats = {
      wins: 0,
      losses: 0,
      total: 0,
      winRate: 0,
      totalTricks: 0,
      tricksLanded: 0,
      landRate: 0,
      longestStreak: 0,
      currentStreak: 0,
      vsYouWins: 0,
      vsYouLosses: 0,
      vsYouTotal: 0,
    };
    if (!profile) return empty;

    let wins = 0;
    let losses = 0;
    let totalTricks = 0;
    let tricksLanded = 0;
    let longestStreak = 0;
    let currentStreak = 0;

    const chronological = [...completedGames].reverse();

    for (const g of chronological) {
      const won = g.winner === profile.uid;
      if (won) {
        wins++;
        currentStreak++;
        if (currentStreak > longestStreak) longestStreak = currentStreak;
      } else {
        losses++;
        currentStreak = 0;
      }

      for (const t of g.turnHistory ?? []) {
        totalTricks++;
        if (t.landed) tricksLanded++;
      }
    }

    const finalWins = isOwnProfile ? wins : (profile.wins ?? 0);
    const finalLosses = isOwnProfile ? losses : (profile.losses ?? 0);
    const total = finalWins + finalLosses;
    const winRate = total > 0 ? Math.round((finalWins / total) * 100) : 0;

    const landRate = totalTricks > 0 ? Math.round((tricksLanded / totalTricks) * 100) : 0;

    const vsYouWins = losses;
    const vsYouLosses = wins;

    return {
      wins: finalWins,
      losses: finalLosses,
      total,
      winRate,
      totalTricks,
      tricksLanded,
      landRate,
      longestStreak,
      currentStreak,
      vsYouWins,
      vsYouLosses,
      vsYouTotal: vsYouWins + vsYouLosses,
    };
  }, [completedGames, profile, isOwnProfile]);

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
