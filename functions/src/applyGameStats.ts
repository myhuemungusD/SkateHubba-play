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
  turnHistory?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  judgeId?: unknown;
  judgeStatus?: unknown;
}

/** Per-player counters derived from a game's turnHistory in a single walk. */
export interface PlayerDerived {
  lettersTaken: number;
  lettersGiven: number;
  /**
   * "Tricks landed" == matched attempts. A setter's own set is not a separate
   * turnHistory row (the row describes the match attempt against that set), so
   * both landed and failed attempts are attributed to `matcherUid` only.
   */
  tricksLanded: number;
  tricksFailed: number;
  /**
   * Running high-water mark of letters held while replaying the turns in order.
   * Letters only ever accumulate, so this equals `lettersTaken`; it is computed
   * during the replay so the comeback rule stays readable as "was ever at N".
   */
  peakLetters: number;
}

/** Everything one pass over `turnHistory` yields. */
export interface GameDerived {
  players: Record<string, PlayerDerived>;
  /** uid -> number of entries whose `judgedBy` names that uid. */
  judgedBy: Record<string, number>;
}

function emptyPlayer(): PlayerDerived {
  return { lettersTaken: 0, lettersGiven: 0, tricksLanded: 0, tricksFailed: 0, peakLetters: 0 };
}

/**
 * Derive every per-player counter from the game's `turnHistory` in one walk.
 *
 * A letter moves only when the turn was actually failed (`landed === false`)
 * AND names the player who took the letter (`letterTo`). The letter is "given"
 * by the other participant, so `letterTo` must be one of the two uids — an
 * entry naming anyone else is unattributable and is skipped rather than guessed
 * at. Trick attempts are attributed to `matcherUid` under the same rule.
 *
 * Every other shape (missing array, non-object entries, null/blank letterTo,
 * `landed` truthy or non-boolean) contributes nothing: turnHistory is written
 * incrementally over a game's life by several code paths, and a malformed entry
 * must never corrupt a lifetime counter or abort the close-out.
 */
export function deriveGameStats(turnHistory: unknown, p1: string, p2: string): GameDerived {
  const players: Record<string, PlayerDerived> = { [p1]: emptyPlayer(), [p2]: emptyPlayer() };
  const judgedBy: Record<string, number> = {};
  if (!Array.isArray(turnHistory)) return { players, judgedBy };

  for (const entry of turnHistory) {
    if (typeof entry !== "object" || entry === null) continue;
    const {
      landed,
      letterTo,
      matcherUid,
      judgedBy: judge,
    } = entry as { landed?: unknown; letterTo?: unknown; matcherUid?: unknown; judgedBy?: unknown };

    if (typeof judge === "string" && judge.length > 0) {
      judgedBy[judge] = (judgedBy[judge] ?? 0) + 1;
    }

    if (typeof matcherUid === "string" && (matcherUid === p1 || matcherUid === p2)) {
      if (landed === true) players[matcherUid].tricksLanded += 1;
      else if (landed === false) players[matcherUid].tricksFailed += 1;
    }

    if (landed !== false) continue;
    if (typeof letterTo !== "string" || letterTo.length === 0) continue;

    const giver = letterTo === p1 ? p2 : letterTo === p2 ? p1 : null;
    if (giver === null) continue;

    players[letterTo].lettersTaken += 1;
    players[giver].lettersGiven += 1;
    players[letterTo].peakLetters = Math.max(players[letterTo].peakLetters, players[letterTo].lettersTaken);
  }
  return { players, judgedBy };
}

/** Letters held when a player is one failure from spelling SKATE. */
const COMEBACK_LETTER_THRESHOLD = 4;

/** How many recent results a profile keeps. */
const RECENT_RESULTS_CAP = 10;

/**
 * Milliseconds for a Firestore Timestamp, a Date, or a raw epoch number. Any
 * other shape (missing field on a legacy game, a sentinel that never resolved)
 * reads as null so the duration counter is skipped rather than poisoned.
 */
function toMillis(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === "object" && raw !== null) {
    const { toMillis: fn } = raw as { toMillis?: unknown };
    if (typeof fn === "function") {
      const ms = (fn as () => unknown).call(raw);
      if (typeof ms === "number" && Number.isFinite(ms)) return ms;
    }
  }
  return null;
}

/**
 * Wall-clock length of the game. `updatedAt` is the close-out write that fired
 * this trigger, so the span is start -> terminal state. A missing endpoint or a
 * negative span (clock skew, a backdated repair write) yields 0 and the counter
 * is omitted entirely.
 */
function gameDurationMs(game: GameStatsFields): number {
  const start = toMillis(game.createdAt);
  const end = toMillis(game.updatedAt);
  if (start === null || end === null) return 0;
  const span = end - start;
  return span > 0 ? span : 0;
}

/**
 * Append one result to a profile's capped ring of recent outcomes. Read from
 * the snapshot inside the transaction and written back absolutely, so it
 * inherits the same serialize-or-retry safety as the streak fields. A corrupted
 * value (non-array, non-"W"/"L" members) is discarded rather than propagated.
 */
export function nextRecentResults(raw: unknown, result: "W" | "L"): string[] {
  const prior = Array.isArray(raw) ? raw.filter((v): v is string => v === "W" || v === "L") : [];
  return [...prior, result].slice(-RECENT_RESULTS_CAP);
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

type Increment = ReturnType<typeof FieldValue.increment>;

/**
 * Render deltas as FieldValue increments, omitting any counter whose delta is 0
 * — an `increment(0)` write is a no-op that would still create the field on a
 * profile that has never taken a letter, and keeping the payload minimal keeps
 * the test assertions honest about what actually changed.
 */
function increments(deltas: Record<string, number>): Record<string, Increment> {
  const out: Record<string, Increment> = {};
  for (const [field, by] of Object.entries(deltas)) {
    if (by > 0) out[field] = FieldValue.increment(by);
  }
  return out;
}

/** Per-player counters shared by both the winner and the loser payload. */
function sharedIncrements(derived: PlayerDerived, durationMs: number): Record<string, Increment> {
  return increments({
    lettersTaken: derived.lettersTaken,
    lettersGiven: derived.lettersGiven,
    tricksLanded: derived.tricksLanded,
    tricksFailed: derived.tricksFailed,
    totalGameDurationMs: durationMs,
    // Denominator for "average game length". `totalGameDurationMs` only accrues
    // for games this close-out actually measured — it did not exist before the
    // counter shipped, and it is omitted whenever the span is unusable (missing
    // endpoint, clock skew). Dividing it by lifetime `gamesPlayed` therefore
    // understates the average for every player with pre-counter history. This
    // moves in lockstep with the numerator, so the ratio is always over the same
    // set of games; `increments()` drops it when durationMs is 0.
    gamesWithDuration: durationMs > 0 ? 1 : 0,
  });
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

    // A judge only earns credit for a game they actually accepted; a pending or
    // declined invite leaves judgeStatus !== "accepted" and is ignored here.
    const judgeId = game.judgeId;
    const judgeUid =
      typeof judgeId === "string" && judgeId.length > 0 && game.judgeStatus === "accepted" ? judgeId : null;
    const judgeRef = judgeUid === null ? null : db.collection("users").doc(judgeUid);

    // Admin transactions require all reads before any write — the judge read is
    // grouped here for that reason, not merely for latency.
    const [winnerSnap, loserSnap, judgeSnap] = await Promise.all([
      tx.get(winnerRef),
      tx.get(loserRef),
      judgeRef === null ? Promise.resolve(null) : tx.get(judgeRef),
    ]);

    tx.update(gameRef, { statsApplied: true });

    // Every derived counter rides along on the same transaction + `statsApplied`
    // guard as the win/loss counters, so they inherit the identical idempotency
    // property: exactly one invocation per game ever increments them.
    const { players, judgedBy } = deriveGameStats(game.turnHistory, winner, loser);
    const durationMs = gameDurationMs(game);

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
        ...sharedIncrements(players[winner], durationMs),
        // A clean win is a shutout: the winner never took a letter.
        ...increments({
          cleanWins: players[winner].lettersTaken === 0 ? 1 : 0,
          comebackWins: players[winner].peakLetters >= COMEBACK_LETTER_THRESHOLD ? 1 : 0,
        }),
        recentResults: nextRecentResults(winnerSnap.data()?.recentResults, "W"),
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
        ...sharedIncrements(players[loser], durationMs),
        // Only the loser of a forfeit carries the abandonment; the winner of a
        // forfeit completed their side of the challenge. Every producer of a
        // forfeit (turnForfeit.shared.ts is the only one) writes `winner`
        // alongside `status: "forfeit"`, so a forfeit can never reach this
        // point without a loser — a winner-less forfeit bails at `no-winner`
        // above and is a data-integrity fault, not a normal path.
        ...increments({ forfeitLosses: game.status === "forfeit" ? 1 : 0 }),
        recentResults: nextRecentResults(loserSnap.data()?.recentResults, "L"),
      });
    } else {
      console.warn(`applyGameStats: loser profile ${loser} missing; skipping loss increment for game ${gameId}`);
    }

    if (judgeRef !== null && judgeUid !== null) {
      if (judgeSnap?.exists === true) {
        tx.update(judgeRef, {
          gamesJudged: FieldValue.increment(1),
          ...increments({ turnsJudged: judgedBy[judgeUid] ?? 0 }),
        });
      } else {
        console.warn(`applyGameStats: judge profile ${judgeUid} missing; skipping judge credit for game ${gameId}`);
      }
    }

    return "applied";
  });
}
