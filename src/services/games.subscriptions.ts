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
  // so we run a query per seat. Each seat has two listeners: every active
  // game (so a live turn cannot fall off a paged history query) and a page
  // of finished games ordered by updatedAt.
  const SLICES = ["p1", "p2", "judge", "p1Active", "p2Active", "judgeActive"] as const;
  type Slice = (typeof SLICES)[number];
  /** Cap on live games per seat. History uses `limitCount`; active does not. */
  const ACTIVE_GAME_LIMIT = 50;

  // Per-slice game maps keep each listener's contribution isolated — so an
  // error on (e.g.) the judge listener can drop that slice without trashing
  // the player-side data, and snapshots update one slice atomically rather
  // than shuffling around three captured array closures.
  const slices: Record<Slice, Map<string, GameDoc>> = {
    p1: new Map(),
    p2: new Map(),
    judge: new Map(),
    p1Active: new Map(),
    p2Active: new Map(),
    judgeActive: new Map(),
  };

  // First-load gate: we only emit to `onUpdate` once every listener has
  // delivered at least once (or errored — see handleError). Without this,
  // consumers would see a flicker of "just my p1 games" → "all games" while
  // the other snapshots are still in flight.
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
    if (seeded.size === SLICES.length) {
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
    // Was this slice already seeded BEFORE this snapshot? If yes, this is a
    // genuine update (e.g. user took a turn) — must be emitted even if the
    // first-load gate is still waiting on a different slice. Without this,
    // a slice-A update that arrives between slice-A's initial seed and a
    // sibling slice's initial seed is captured into `slices[slice]` but
    // silently dropped, so the UI never sees the second-or-later change.
    const wasAlreadySeeded = seeded.has(slice);
    slices[slice] = next;
    markSeeded(slice);
    // Emit when the first-load gate is open, OR when this is a follow-up
    // update on an already-seeded slice (no flash risk — the slice already
    // contributed its initial data on a prior snapshot).
    if (firstLoadComplete || wasAlreadySeeded) rebuildAndEmit();
  };

  const handleError = (slice: Slice) => (err: Error) => {
    logger.warn("game_subscription_error", { uid, error: err.message });
    captureException(err, { extra: { context: "subscribeToMyGames", uid } });
    // Preserve whatever the slice last delivered. The Firestore SDK
    // auto-reconnects on transient errors and the next successful snapshot
    // replaces the slice atomically — zeroing here would silently empty the
    // user's view (e.g. all judge games disappear) until reconnect, which
    // a flaky judge-listener can hit repeatedly. The errored slice still
    // counts toward "seeded" so an erroring query doesn't block the first
    // emit forever.
    const wasFirstLoadComplete = firstLoadComplete;
    markSeeded(slice);
    // Emit only when this error completes the first-load gate. After first
    // load, the slice is preserved so merged state is unchanged — a
    // re-emit would be wasted work and can churn downstream React state.
    if (!wasFirstLoadComplete && firstLoadComplete) rebuildAndEmit();
  };

  const finished = where("status", "in", ["complete", "forfeit"] as const);
  const live = where("status", "==", "active");
  const newest = orderBy("updatedAt", "desc");
  const historyLimit = limit(limitCount);
  const activeLimit = limit(ACTIVE_GAME_LIMIT);

  const unsub1 = onSnapshot(
    query(gamesRef(), where("player1Uid", "==", uid), finished, newest, historyLimit),
    (snap) => handleSnapshot("p1", snap),
    handleError("p1"),
  );
  const unsub2 = onSnapshot(
    query(gamesRef(), where("player2Uid", "==", uid), finished, newest, historyLimit),
    (snap) => handleSnapshot("p2", snap),
    handleError("p2"),
  );
  const unsub3 = onSnapshot(
    query(gamesRef(), where("judgeId", "==", uid), finished, newest, historyLimit),
    (snap) => handleSnapshot("judge", snap),
    handleError("judge"),
  );
  const unsub4 = onSnapshot(
    query(gamesRef(), where("player1Uid", "==", uid), live, newest, activeLimit),
    (snap) => handleSnapshot("p1Active", snap),
    handleError("p1Active"),
  );
  const unsub5 = onSnapshot(
    query(gamesRef(), where("player2Uid", "==", uid), live, newest, activeLimit),
    (snap) => handleSnapshot("p2Active", snap),
    handleError("p2Active"),
  );
  const unsub6 = onSnapshot(
    query(gamesRef(), where("judgeId", "==", uid), live, newest, activeLimit),
    (snap) => handleSnapshot("judgeActive", snap),
    handleError("judgeActive"),
  );

  return () => {
    unsub1();
    unsub2();
    unsub3();
    unsub4();
    unsub5();
    unsub6();
  };
}

/**
 * Subscribe to a single game for real-time updates.
 *
 * `onAccessDenied` fires when the rules refuse the read (`permission-denied`):
 * the viewer is not a participant/judge of this game, or lost access (e.g. a
 * block or an admin action). Unlike a network blip that is authoritative, and
 * Firestore tears the listener down after any error, so no further snapshot
 * will ever arrive. Without this callback the caller is left on a game shell
 * that can never update.
 */
export function subscribeToGame(
  gameId: string,
  onUpdate: (game: GameDoc | null) => void,
  onAccessDenied?: () => void,
): Unsubscribe {
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
      if ((err as { code?: string }).code === "permission-denied") {
        // Expected outcome of an access check, not an app fault: log it, skip
        // Sentry, and hand control back to the caller to leave the game.
        logger.warn("game_access_denied", { gameId });
        onAccessDenied?.();
        return;
      }
      logger.warn("game_subscription_error", { gameId, error: err.message });
      captureException(err, { extra: { context: "subscribeToGame", gameId } });
      // Do NOT emit null here. A transient listener error (network blip,
      // token refresh, App Check) is consumed by the UI as "game gone" and
      // bounces the user off a live ACTIVE game. The Firestore SDK
      // auto-reconnects and the next successful snapshot re-emits the
      // current doc; until then we retain the last-good value rather than
      // dropping the user. `null` is reserved for the authoritative
      // "document does not exist" path above.
    },
  );
}
