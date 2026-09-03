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
/** A single entry in {@link ProfileStats.recentResults}. */
export type MatchResult = "W" | "L";

/**
 * Narrow the raw `recentResults` array off the profile doc. The field is
 * external data typed as `string[]`, so anything that isn't a literal "W"/"L"
 * is dropped rather than rendered as an unknown pip. A missing field reads as
 * an empty run — the same "absent means zero" convention every other counter
 * on this screen follows.
 */
function narrowRecentResults(raw: string[] | undefined): MatchResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is MatchResult => v === "W" || v === "L");
}

export interface ProfileStats {
  wins: number;
  losses: number;
  /**
   * Completed games. Prefers the server-written `gamesPlayed` counter and only
   * falls back to `wins + losses` for docs predating it — the leaderboard
   * (PlayerDirectory) already reads it that way, and the two surfaces
   * disagreeing about a player's game count is a bug users can see.
   */
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
  /**
   * SKATE letter counters, server-written by the stats close-out function;
   * 0 for docs predating the feature.
   */
  /** Letters this player handed out to opponents. */
  lettersGiven: number;
  /** Letters this player took from opponents. */
  lettersTaken: number;
  /** Wins without taking a single letter. 0 for docs predating the counter. */
  cleanWins: number;
  /** Wins from a deficit. 0 for docs predating the counter. */
  comebackWins: number;
  /**
   * Share of games this player saw through to the end, as a whole percent, or
   * `null` when they have no completed games. This is the public framing of
   * `forfeitLosses`: the raw abandon count is owner-only (My Stats), because a
   * negative counter on a public profile invites gaming and shaming alike.
   */
  challengeCompletion: number | null;
  /** Last 10 results, oldest first. Empty for docs predating the counter. */
  recentResults: MatchResult[];
  /** Games refereed to completion as an accepted judge. 0 for legacy docs. */
  gamesJudged: number;
}

interface Args {
  viewedUid: string;
  /**
   * The viewer. Absent for a signed-out visitor arriving on a shared
   * `/player/:uid` link — every viewer-scoped derivation below (H2H record,
   * game history, block state) degrades to its empty value in that case.
   */
  currentUserProfile?: UserProfile | null;
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
  const viewerUid = currentUserProfile?.uid;
  // No viewer → no readable games. Firestore gates game reads on
  // `isSignedIn() && isParticipant(...)`, so skip the query rather than fire
  // one that can only come back permission-denied.
  const fetchedData = usePlayerProfile(isOwnProfile ? "" : viewedUid, viewerUid, Boolean(viewerUid));

  const profile = isOwnProfile ? (currentUserProfile ?? null) : fetchedData.profile;
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
   *
   * Anonymous visitors skip the fetch entirely: achievements and locker
   * reads are gated on `isSignedIn()` in firestore.rules, so without a
   * viewer both requests are guaranteed permission-denied round trips —
   * the same reasoning as `includeGames` on `usePlayerProfile`. The
   * sections render their empty state, which for a signed-out visitor is
   * indistinguishable from "nothing earned yet".
   */
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [lockerItems, setLockerItems] = useState<LockerItem[]>([]);

  useEffect(() => {
    if (!viewedUid || !viewerUid) return;
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
  }, [viewedUid, viewerUid]);

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
    const total = profile?.gamesPlayed ?? wins + losses;
    const winRate = ratedWinRate(wins, losses);
    const currentWinStreak = profile?.currentWinStreak ?? 0;
    const bestWinStreak = profile?.bestWinStreak ?? 0;

    let vsYouWins = 0;
    let vsYouLosses = 0;
    if (profile) {
      for (const g of completedGames) {
        // From the viewer's perspective: a profile-side WIN against the
        // viewer is a viewer-side LOSS (and vice versa). The viewer's uid
        // is viewerUid; the profile being viewed is profile.uid.
        if (g.winner === profile.uid) vsYouLosses++;
        else if (g.winner === viewerUid) vsYouWins++;
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
      lettersGiven: profile?.lettersGiven ?? 0,
      lettersTaken: profile?.lettersTaken ?? 0,
      cleanWins: profile?.cleanWins ?? 0,
      comebackWins: profile?.comebackWins ?? 0,
      // Clamped at 0 so a corrupt doc (forfeitLosses > total) renders a floor
      // rather than a negative percentage.
      challengeCompletion:
        total > 0 ? Math.max(0, Math.round(((total - (profile?.forfeitLosses ?? 0)) / total) * 100)) : null,
      recentResults: narrowRecentResults(profile?.recentResults),
      gamesJudged: profile?.gamesJudged ?? 0,
    };
  }, [profile, completedGames, viewerUid]);

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

  // Both block actions are viewer-scoped writes. The controls are never
  // rendered without a viewer, so the `!viewerUid` arm is defence-in-depth
  // against a future caller wiring them up on the public profile.
  const confirmBlock = useCallback(async () => {
    if (!profile || !viewerUid) return;
    setBlockLoading(true);
    try {
      await blockUser(viewerUid, profile.uid);
      setShowBlockConfirm(false);
    } finally {
      setBlockLoading(false);
    }
  }, [viewerUid, profile]);

  const handleUnblock = useCallback(async () => {
    if (!profile || !viewerUid) return;
    setBlockLoading(true);
    try {
      await unblockUser(viewerUid, profile.uid);
    } finally {
      setBlockLoading(false);
    }
  }, [viewerUid, profile]);

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
