import { FieldValue, type Firestore } from "firebase-admin/firestore";

/**
 * Outcome of an {@link applyGameStats} run. The union exists for observability
 * (structured logging) and to give the tests a precise assertion surface — a
 * single string tells you exactly which branch executed and whether the game
 * doc was mutated.
 */
export type ApplyGameStatsResult =
  | "applied"
  | "already-applied"
  | "not-terminal"
  | "no-winner"
  | "winner-not-participant"
  | "missing";

/** The subset of the game document this reconciler reads. */
interface GameStatsFields {
  player1Uid?: unknown;
  player2Uid?: unknown;
  status?: unknown;
  winner?: unknown;
  statsApplied?: unknown;
}

/**
 * Coerce a stored counter to a usable number. Profiles created before a given
 * counter shipped simply lack the field, and a corrupted doc could hold a
 * non-number — both read as 0 so a legacy player's first completed game starts
 * their streak at 1 rather than producing NaN.
 */
function counter(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

/**
 * Idempotently apply win/loss counters for a terminal game.
 *
 * The `statsApplied` flag re-checked *inside* the transaction is the real
 * idempotency guard: two concurrent trigger invocations (or a retry) serialize
 * on the game doc, and only the first observes `statsApplied !== true`, writes
 * the flag, and increments. The handler's pre-check is merely a cheap fast path
 * that avoids opening a transaction for the common no-op update.
 */
export async function applyGameStats(db: Firestore, gameId: string): Promise<ApplyGameStatsResult> {
  const gameRef = db.collection("games").doc(gameId);

  return db.runTransaction(async (tx): Promise<ApplyGameStatsResult> => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) return "missing";

    const game = (gameSnap.data() ?? {}) as GameStatsFields;

    // Re-validate every precondition transactionally; the handler pre-check is
    // racy by nature, so the authoritative decision happens here.
    if (game.status !== "complete" && game.status !== "forfeit") return "not-terminal";
    if (game.statsApplied === true) return "already-applied";

    const winner = game.winner;
    if (typeof winner !== "string" || winner.length === 0) return "no-winner";

    const player1Uid = game.player1Uid;
    const player2Uid = game.player2Uid;

    let loser: string;
    if (winner === player1Uid && typeof player2Uid === "string") {
      loser = player2Uid;
    } else if (winner === player2Uid && typeof player1Uid === "string") {
      loser = player1Uid;
    } else {
      // Winner is neither participant: a data-integrity fault. Deliberately do
      // NOT set statsApplied — leaving the flag unset keeps the anomaly visible
      // to a later corrected write instead of silently sealing bad data.
      console.warn(`applyGameStats: winner ${winner} is not a participant of game ${gameId}`);
      return "winner-not-participant";
    }

    const winnerRef = db.collection("users").doc(winner);
    const loserRef = db.collection("users").doc(loser);

    // Admin transactions require all reads before any write.
    const [winnerSnap, loserSnap] = await Promise.all([tx.get(winnerRef), tx.get(loserRef)]);

    tx.update(gameRef, { statsApplied: true });

    if (winnerSnap.exists) {
      // Streaks are written as absolute values rather than increments because
      // bestWinStreak needs the resulting current streak to compare against.
      // That is safe here: the transaction read winnerRef, so a concurrent
      // write to the same profile aborts and retries this whole block.
      const nextStreak = counter(winnerSnap.data()?.currentWinStreak) + 1;
      const nextBest = Math.max(counter(winnerSnap.data()?.bestWinStreak), nextStreak);
      tx.update(winnerRef, {
        wins: FieldValue.increment(1),
        gamesPlayed: FieldValue.increment(1),
        currentWinStreak: nextStreak,
        bestWinStreak: nextBest,
      });
    } else {
      console.warn(`applyGameStats: winner profile ${winner} missing; skipping win increment for game ${gameId}`);
    }

    if (loserSnap.exists) {
      // A loss ends the run outright. bestWinStreak is deliberately untouched —
      // it is a lifetime high-water mark, not a current-form number.
      tx.update(loserRef, {
        losses: FieldValue.increment(1),
        gamesPlayed: FieldValue.increment(1),
        currentWinStreak: 0,
      });
    } else {
      console.warn(`applyGameStats: loser profile ${loser} missing; skipping loss increment for game ${gameId}`);
    }

    return "applied";
  });
}
