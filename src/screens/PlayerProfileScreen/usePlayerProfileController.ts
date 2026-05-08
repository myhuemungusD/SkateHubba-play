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

/**
 * View-model of the profile-screen stats. PR-C reads counter values directly
 * off the loaded `UserProfile` (PR-A1 wired the writes); the only thing we
 * still derive here is the H2H breakdown vs. the viewer, since that's a
 * cross-profile join the schema doesn't store.
 *
 * `vs*` fields are only meaningful when viewing an OPPONENT profile. On the
 * own-profile view they're returned as zeros — the screen layout hides the
 * VS-You row in that case (plan §6.4 brag-rank "VS-You row").
 */
export interface ProfileStats {
  /** Lifetime wins (from `users/{uid}.gamesWon`, defaulted to 0). */
  wins: number;
  /** Lifetime losses (`gamesLost`). */
  losses: number;
  /** Lifetime forfeits the user themselves caused (`gamesForfeited`). */
  forfeits: number;
  /** Total terminal games = wins + losses + forfeits. */
  total: number;
  /** Lifetime tricks landed (clean honor-system landings only — `tricksLanded`). */
  tricksLanded: number;
  /** Setter credit when matcher's claim was undisputed (`cleanJudgments`). */
  cleanJudgments: number;
  /** Current win streak (`currentWinStreak`) — drives StreakBadge. */
  currentStreak: number;
  /** Best lifetime streak (`longestWinStreak`) — first slot in the brag row. */
  longestStreak: number;
  /** Reserved counters — surfaced in a placeholder row until the future spot-check-in PR. */
  spotsAdded: number;
  checkIns: number;
  /** Total lifetime XP (PR-E populates; PR-C displays placeholder). */
  xp: number;
  /** Derived level (1..30; defaults to 1 until PR-E activates). */
  level: number;
  /** Trick land % — derived from total turns vs landed turns across the games we know about. */
  trickLandPercent: number;

  /** H2H — viewer's wins against the viewed profile. */
  vsYouWins: number;
  /** H2H — viewer's losses against the viewed profile. */
  vsYouLosses: number;
  /** Total H2H games. */
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

  // ── Counters read directly from the profile (PR-A1 writes them) ──────
  // PR-C deletes the legacy client-side `useMemo` block (~lines 94-161 in
  // the pre-PR-C file) that re-derived wins/losses/streaks from the games
  // subscription. The new ProfileStatsGrid reads counters straight from
  // `users/{uid}` instead. The H2H computation below is preserved (audit
  // E3) since it's a cross-profile join the schema doesn't store.
  const stats = useMemo<ProfileStats>(() => {
    const empty: ProfileStats = {
      wins: 0,
      losses: 0,
      forfeits: 0,
      total: 0,
      tricksLanded: 0,
      cleanJudgments: 0,
      currentStreak: 0,
      longestStreak: 0,
      spotsAdded: 0,
      checkIns: 0,
      xp: 0,
      level: 1,
      trickLandPercent: 0,
      vsYouWins: 0,
      vsYouLosses: 0,
      vsYouTotal: 0,
    };
    if (!profile) return empty;

    const wins = profile.gamesWon ?? profile.wins ?? 0;
    const losses = profile.gamesLost ?? profile.losses ?? 0;
    const forfeits = profile.gamesForfeited ?? 0;
    const total = wins + losses + forfeits;
    const tricksLanded = profile.tricksLanded ?? 0;

    // Trick land % is derived from the games we have visibility into. We
    // intentionally don't store this on the user doc (denormalizing the
    // ratio would invite drift). When viewing an opponent we only see the
    // games we share; the value is honest about being a recent-sample
    // estimate rather than a lifetime number.
    let totalTurns = 0;
    let landedTurns = 0;
    for (const g of completedGames) {
      for (const t of g.turnHistory ?? []) {
        if (t.setterUid !== profile.uid && t.matcherUid !== profile.uid) continue;
        if (t.matcherUid !== profile.uid) continue;
        totalTurns++;
        if (t.landed) landedTurns++;
      }
    }
    const trickLandPercent = totalTurns > 0 ? Math.round((landedTurns / totalTurns) * 100) : 0;

    // H2H — only meaningful on opponent view. We compute against the
    // current viewer (`currentUserProfile.uid`), reading the profile's
    // perspective: `vsYouWins` = "you won this many vs them". Same
    // semantics as the legacy code (audit E3).
    let vsYouWins = 0;
    let vsYouLosses = 0;
    if (!isOwnProfile) {
      for (const g of completedGames) {
        const involvesViewer =
          g.player1Uid === currentUserProfile.uid || g.player2Uid === currentUserProfile.uid;
        if (!involvesViewer) continue;
        if (g.winner === currentUserProfile.uid) vsYouWins++;
        else if (g.winner === profile.uid) vsYouLosses++;
      }
    }

    return {
      wins,
      losses,
      forfeits,
      total,
      tricksLanded,
      cleanJudgments: profile.cleanJudgments ?? 0,
      currentStreak: profile.currentWinStreak ?? 0,
      longestStreak: profile.longestWinStreak ?? 0,
      spotsAdded: profile.spotsAddedCount ?? 0,
      checkIns: profile.checkInsCount ?? 0,
      xp: profile.xp ?? 0,
      level: profile.level ?? 1,
      trickLandPercent,
      vsYouWins,
      vsYouLosses,
      vsYouTotal: vsYouWins + vsYouLosses,
    };
  }, [profile, completedGames, isOwnProfile, currentUserProfile.uid]);

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
