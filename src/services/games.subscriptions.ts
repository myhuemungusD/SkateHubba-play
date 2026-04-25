import { query, where, limit, orderBy, getDocs, onSnapshot, doc, type Unsubscribe } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { captureException } from "../lib/sentry";
import { toGameDoc, type GameDoc } from "./games.mappers";
import { gamesRef } from "./games.turns";

/* ────────────────────────────────────────────
 * One-time queries
 * ──────────────────────────────────────────── */

/**
 * Fetch all completed/forfeit games for a player (one-time read).
 * Used for viewing another player's public profile without subscribing
 * to real-time updates. Returns games sorted by updatedAt descending.
 *
 * When `viewerUid` is provided, only returns games where BOTH players
 * are participants. This is required because Firestore security rules
 * only allow reading games you're a player in.
 */
export async function fetchPlayerCompletedGames(uid: string, viewerUid?: string): Promise<GameDoc[]> {
  const ref = gamesRef();
  const statusFilter = ["complete", "forfeit"];

  // When viewerUid is provided, scope queries to games between both players.
  // This satisfies Firestore rules that restrict game reads to participants.
  const sharedFilter = viewerUid && viewerUid !== uid;
  const q1Constraints = [
    where("player1Uid", "==", uid),
    ...(sharedFilter ? [where("player2Uid", "==", viewerUid)] : []),
    where("status", "in", statusFilter),
    orderBy("updatedAt", "desc"),
    limit(100),
  ];
  const q2Constraints = [
    where("player2Uid", "==", uid),
    ...(sharedFilter ? [where("player1Uid", "==", viewerUid)] : []),
    where("status", "in", statusFilter),
    orderBy("updatedAt", "desc"),
    limit(100),
  ];
  const q1 = query(ref, ...q1Constraints);
  const q2 = query(ref, ...q2Constraints);

  const [snap1, snap2] = await Promise.all([withRetry(() => getDocs(q1)), withRetry(() => getDocs(q2))]);

  const all = [...snap1.docs, ...snap2.docs].map((d) => toGameDoc(d));

  // Deduplicate (a player could theoretically be both p1 and p2 in edge cases)
  const seen = new Set<string>();
  const unique: GameDoc[] = [];
  for (const g of all) {
    if (!seen.has(g.id)) {
      seen.add(g.id);
      unique.push(g);
    }
  }

  // Sort by updatedAt descending
  return unique.sort((a, b) => {
    const aTs = a.updatedAt;
    const aTime = aTs && typeof aTs.toMillis === "function" ? aTs.toMillis() : 0;
    const bTs = b.updatedAt;
    const bTime = bTs && typeof bTs.toMillis === "function" ? bTs.toMillis() : 0;
    return bTime - aTime;
  });
}

/* ────────────────────────────────────────────
 * Real-time listeners
 * ──────────────────────────────────────────── */

/**
 * Subscribe to all games where the user is a player OR the nominated judge.
 * @param limitCount — max number of games per query (defaults to 20).
 * Returns unsubscribe function.
 */
export function subscribeToMyGames(
  uid: string,
  onUpdate: (games: GameDoc[]) => void,
  limitCount: number = 20,
): Unsubscribe {
  // Firestore doesn't support OR queries across different fields natively,
  // so we run three queries (player1, player2, judge) and merge.
  type Slice = "p1" | "p2" | "judge";

  // Per-slice game maps keep each listener's contribution isolated — so an
  // error on (e.g.) the judge listener can drop that slice without trashing
  // the player-side data, and snapshots update one slice atomically rather
  // than shuffling around three captured array closures.
  const slices: Record<Slice, Map<string, GameDoc>> = {
    p1: new Map(),
    p2: new Map(),
    judge: new Map(),
  };

  // First-load gate: we only emit to `onUpdate` once all three listeners have
  // delivered at least once (or errored — see handleError). Without this,
  // consumers would see a flicker of "just my p1 games" → "all games" while
  // the other two snapshots are still in flight.
  const seeded = new Set<Slice>();
  let firstLoadComplete = false;

  const rebuildAndEmit = () => {
    // Merge all three slices into a single deduped map keyed by game id.
    const merged = new Map<string, GameDoc>();
    for (const slice of Object.values(slices)) {
      for (const [id, game] of slice) {
        merged.set(id, game);
      }
    }
    const sorted = Array.from(merged.values()).sort((a, b) => {
      // Active first, then by turn number desc (preserves the existing
      // ordering contract so UI renders "what's on deck" above history).
      if (a.status === "active" && b.status !== "active") return -1;
      if (a.status !== "active" && b.status === "active") return 1;
      return b.turnNumber - a.turnNumber;
    });
    onUpdate(sorted);
  };

  const markSeeded = (slice: Slice) => {
    if (firstLoadComplete) return;
    seeded.add(slice);
    if (seeded.size === 3) {
      firstLoadComplete = true;
    }
  };

  const handleSnapshot = (slice: Slice, snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => {
    // Rebuild the slice atomically from the fresh snapshot (replaces stale
    // entries and drops removed ones — no partial update window).
    const next = new Map<string, GameDoc>();
    for (const d of snap.docs) {
      const game = toGameDoc(d);
      next.set(game.id, game);
    }
    slices[slice] = next;
    markSeeded(slice);
    // Only emit once the first load is complete. After that every snapshot
    // update is a legit diff and consumers should see it immediately.
    if (firstLoadComplete) rebuildAndEmit();
  };

  const handleError = (slice: Slice) => (err: Error) => {
    logger.warn("game_subscription_error", { uid, error: err.message });
    captureException(err, { extra: { context: "subscribeToMyGames", uid } });
    // Drop this slice's contribution so we don't leave stale data mixed in
    // with healthy slices. Still counts toward "seeded" — an erroring query
    // shouldn't block the first emit forever.
    slices[slice] = new Map();
    markSeeded(slice);
    if (firstLoadComplete) rebuildAndEmit();
  };

  const q1 = query(gamesRef(), where("player1Uid", "==", uid), limit(limitCount));
  const q2 = query(gamesRef(), where("player2Uid", "==", uid), limit(limitCount));
  const q3 = query(gamesRef(), where("judgeId", "==", uid), limit(limitCount));

  const unsub1 = onSnapshot(q1, (snap) => handleSnapshot("p1", snap), handleError("p1"));
  const unsub2 = onSnapshot(q2, (snap) => handleSnapshot("p2", snap), handleError("p2"));
  const unsub3 = onSnapshot(q3, (snap) => handleSnapshot("judge", snap), handleError("judge"));

  return () => {
    unsub1();
    unsub2();
    unsub3();
  };
}

/**
 * Subscribe to a single game for real-time updates
 */
export function subscribeToGame(gameId: string, onUpdate: (game: GameDoc | null) => void): Unsubscribe {
  return onSnapshot(
    doc(requireDb(), "games", gameId),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      onUpdate(toGameDoc(snap));
    },
    (err) => {
      logger.warn("game_subscription_error", { gameId, error: err.message });
      captureException(err, { extra: { context: "subscribeToGame", gameId } });
      onUpdate(null);
    },
  );
}
