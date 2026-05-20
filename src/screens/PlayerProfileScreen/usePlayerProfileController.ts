import { useCallback, useMemo, useState } from "react";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { blockUser, unblockUser } from "../../services/blocking";
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
  winRate: number;
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
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

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
      vsYouWins,
      vsYouLosses,
      vsYouTotal: vsYouWins + vsYouLosses,
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
