import { getAuth } from "firebase-admin/auth";
import { FieldValue, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { preferAccountCreatedMs } from "./accountAge.js";

/**
 * Outcome of an {@link applyGameStats} run. The union exists for observability
 * (structured logging) and to give the tests a precise assertion surface — a
 * single string tells you exactly which branch executed and whether the game
 * doc was mutated.
 */
export type ApplyGameStatsResult =
  "applied" | "already-applied" | "not-terminal" | "no-winner" | "winner-not-participant" | "missing";

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
  spotId?: unknown;
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
 * Server switch for XP. Omitted (or enabled false with an empty tester list)
 * leaves the close-out payloads exactly as they were before XP existed.
 * `testers` is the comma-separated `XP_TESTER_UIDS` param. A tester earns on
 * their own side only.
 */
export interface XpGate {
  enabled: boolean;
  testers: string;
}

const MAX_LEVEL = 50;
const DAILY_XP_CAP = 3000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FINISH_XP = 50;
const WIN_XP = 50;
const LAND_XP = 10;
const CALL_XP = 10;

/**
 * Highest level with `24 × (level − 1)² <= xp`, clamped to 1..50.
 * Integer walk so it cannot drift from `src/constants/xp.ts`.
 */
export function levelForXp(xp: number): number {
  const safe = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  let level = 1;
  for (let steps = 1; steps < MAX_LEVEL; steps += 1) {
    if (24 * steps * steps <= safe) level = steps + 1;
    else break;
  }
  return level;
}

/** Total XP to reach `level`. Level 1 is 0. Level 50 is 57,624. */
export function xpToReach(level: number): number {
  if (!Number.isFinite(level) || level <= 1) return 0;
  const steps = Math.min(Math.floor(level), MAX_LEVEL) - 1;
  return 24 * steps * steps;
}

/** id, profile counter, threshold, reason (<= 200 chars). Mirrors src/constants/xp.ts. */
const XP_GRANTS: readonly [string, string, number, string][] = [
  ["games_10", "gamesPlayed", 10, "Finish 10 games."],
  ["games_50", "gamesPlayed", 50, "Finish 50 games."],
  ["games_250", "gamesPlayed", 250, "Finish 250 games."],
  ["wins_10", "wins", 10, "Win 10 games."],
  ["wins_100", "wins", 100, "Win 100 games."],
  ["wins_500", "wins", 500, "Win 500 games."],
  ["streak_3", "bestWinStreak", 3, "Win 3 games in a row."],
  ["streak_5", "bestWinStreak", 5, "Win 5 games in a row."],
  ["streak_10", "bestWinStreak", 10, "Win 10 games in a row."],
  ["lands_50", "tricksLanded", 50, "Land 50 tricks."],
  ["lands_250", "tricksLanded", 250, "Land 250 tricks."],
  ["lands_1000", "tricksLanded", 1000, "Land 1,000 tricks."],
  ["shutout_1", "cleanWins", 1, "Win a game without taking a letter."],
  ["shutout_10", "cleanWins", 10, "Win 10 games without taking a letter."],
  ["shutout_25", "cleanWins", 25, "Win 25 games without taking a letter."],
  ["comeback_1", "comebackWins", 1, "Win after falling to S.K.A.T."],
  ["comeback_5", "comebackWins", 5, "Win 5 games after falling to S.K.A.T."],
  ["comeback_20", "comebackWins", 20, "Win 20 games after falling to S.K.A.T."],
  ["whistle_1", "turnsJudged", 1, "Rule 1 turn."],
  ["whistle_25", "turnsJudged", 25, "Rule 25 turns."],
  ["whistle_100", "turnsJudged", 100, "Rule 100 turns."],
  ["votes_1", "disputeVotesCast", 1, "Cast 1 vote that stood."],
  ["votes_25", "disputeVotesCast", 25, "Cast 25 votes that stood."],
  ["votes_100", "disputeVotesCast", 100, "Cast 100 votes that stood."],
  ["opponents_5", "uniqueOpponents", 5, "Skate 5 different people."],
  ["opponents_25", "uniqueOpponents", 25, "Skate 25 different people."],
  ["opponents_100", "uniqueOpponents", 100, "Skate 100 different people."],
  ["spots_1", "spotsPlayed", 1, "Finish a game at 1 spot."],
  ["spots_5", "spotsPlayed", 5, "Finish a game at 5 spots."],
  ["spots_20", "spotsPlayed", 20, "Finish a game at 20 spots."],
  ["homespot_1", "gamesAtMySpots", 1, "Finish 1 game at a spot you created."],
  ["homespot_10", "gamesAtMySpots", 10, "Finish 10 games at a spot you created."],
  ["homespot_50", "gamesAtMySpots", 50, "Finish 50 games at a spot you created."],
  ["clips_1", "clipsPosted", 1, "Post 1 clip."],
  ["clips_10", "clipsPosted", 10, "Post 10 clips."],
  ["clips_50", "clipsPosted", 50, "Post 50 clips."],
];

function earnsXp(uid: string, gate: XpGate | undefined): boolean {
  if (!gate) return false;
  if (gate.enabled) return true;
  return gate.testers.split(",").some((part) => part.trim() === uid);
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function pairMultiplier(prior: number): number {
  if (prior <= 0) return 1;
  if (prior === 1) return 0.5;
  if (prior === 2) return 0.25;
  return 0;
}

interface DocRefLike {
  path: string;
  collection?: (name: string) => { doc: (id: string) => DocRefLike };
}

/**
 * Idempotently apply win/loss counters for a terminal game.
 *
 * The `statsApplied` flag re-checked *inside* the transaction is the real
 * idempotency guard: two concurrent trigger invocations (or a retry) serialize
 * on the game doc, and only the first observes `statsApplied !== true`, writes
 * the flag, and increments. The handler's pre-check is merely a cheap fast path
 * that avoids opening a transaction for the common no-op update.
 *
 * XP is applied in the same transaction when `gate` says this uid earns it.
 * An omitted gate pays no XP and does not read or write the XP fields.
 */
async function authCreationTime(uid: string): Promise<string | null> {
  try {
    const record = await getAuth().getUser(uid);
    return record.metadata.creationTime || null;
  } catch {
    return null;
  }
}

export async function applyGameStats(db: Firestore, gameId: string, gate?: XpGate): Promise<ApplyGameStatsResult> {
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

    const winnerEarns = earnsXp(winner, gate);
    const loserEarns = earnsXp(loser, gate);
    const judgeEarns = judgeUid !== null && earnsXp(judgeUid, gate);
    const anyXp = winnerEarns || loserEarns || judgeEarns;

    // Admin transactions require all reads before any write — the judge read is
    // grouped here for that reason, not merely for latency. XP reads stay in
    // this same pre-write window and only run when someone actually earns XP,
    // so a closed switch does not add reads.
    const [winnerSnap, loserSnap, judgeSnap, winnerAuth, loserAuth] = await Promise.all([
      tx.get(winnerRef),
      tx.get(loserRef),
      judgeRef === null ? Promise.resolve(null) : tx.get(judgeRef),
      authCreationTime(winner),
      authCreationTime(loser),
    ]);

    const history = Array.isArray(game.turnHistory) ? game.turnHistory : [];
    const emptyForfeit = game.status === "forfeit" && history.length < 2;
    const dayMs = toMillis(game.updatedAt) ?? toMillis(game.createdAt);
    const day = dayMs === null ? null : utcDay(dayMs);
    const spotId = typeof game.spotId === "string" && game.spotId.length > 0 ? game.spotId : null;
    const judgeIsPlayer = anyXp && judgeUid !== null && (judgeUid === winner || judgeUid === loser);

    const pairId = [winner, loser].sort().join("_");
    const pairRef = !anyXp || emptyForfeit || day === null ? null : db.collection("xpPairs").doc(pairId);
    const spotRef = !anyXp || emptyForfeit || spotId === null ? null : db.collection("spots").doc(spotId);

    const markerReads: {
      uid: string;
      id: string;
      ref: ReturnType<Firestore["collection"]> extends never ? never : { path: string };
    }[] = [];
    // The harness and the Admin SDK both expose collection().doc() on a user ref.
    function markerRef(uid: string, id: string): { path: string } {
      const userRef = db.collection("users").doc(uid) as unknown as DocRefLike;
      const nested = userRef.collection?.("xpMarkers").doc(id);
      return nested ?? { path: `users/${uid}/xpMarkers/${id}` };
    }
    function achievementRef(uid: string, id: string): { path: string } {
      const userRef = db.collection("users").doc(uid) as unknown as DocRefLike;
      const nested = userRef.collection?.("achievements").doc(id);
      return nested ?? { path: `users/${uid}/achievements/${id}` };
    }

    if (anyXp && !emptyForfeit) {
      if (winnerEarns && winnerSnap.exists)
        markerReads.push({ uid: winner, id: `opp_${loser}`, ref: markerRef(winner, `opp_${loser}`) });
      if (loserEarns && loserSnap.exists)
        markerReads.push({ uid: loser, id: `opp_${winner}`, ref: markerRef(loser, `opp_${winner}`) });
      if (spotId !== null) {
        if (winnerEarns && winnerSnap.exists)
          markerReads.push({ uid: winner, id: `spot_${spotId}`, ref: markerRef(winner, `spot_${spotId}`) });
        if (loserEarns && loserSnap.exists)
          markerReads.push({ uid: loser, id: `spot_${spotId}`, ref: markerRef(loser, `spot_${spotId}`) });
      }
    }

    const [pairSnap, spotSnap, ...markerSnaps] = anyXp
      ? await Promise.all([
          pairRef === null ? Promise.resolve(null) : tx.get(pairRef),
          spotRef === null ? Promise.resolve(null) : tx.get(spotRef),
          ...markerReads.map((m) => tx.get(m.ref as DocumentReference)),
        ])
      : [null, null];

    const xpSets: { ref: { path: string }; data: Record<string, unknown> }[] = [];
    const winnerPatch: Record<string, unknown> = {};
    const loserPatch: Record<string, unknown> = {};
    const judgePatch: Record<string, unknown> = {};

    if (anyXp) {
      const { players: derivedPlayers, judgedBy: derivedJudged } = deriveGameStats(game.turnHistory, winner, loser);
      const gameCreated = toMillis(game.createdAt);
      const winnerCreated = preferAccountCreatedMs(winnerAuth, toMillis(winnerSnap.data()?.createdAt));
      const loserCreated = preferAccountCreatedMs(loserAuth, toMillis(loserSnap.data()?.createdAt));
      const oldEnough =
        gameCreated !== null &&
        winnerCreated !== null &&
        loserCreated !== null &&
        gameCreated - winnerCreated >= DAY_MS &&
        gameCreated - loserCreated >= DAY_MS;

      let priorPair = 0;
      if (pairSnap && pairSnap.exists && day !== null && pairSnap.data()?.utcDay === day) {
        priorPair = counter(pairSnap.data()?.count);
      }
      const multiplier = emptyForfeit || day === null ? (emptyForfeit ? 0 : 1) : pairMultiplier(priorPair);
      if (pairRef !== null && day !== null) {
        const nextCount = pairSnap && pairSnap.exists && pairSnap.data()?.utcDay === day ? priorPair + 1 : 1;
        xpSets.push({ ref: pairRef, data: { utcDay: day, count: nextCount } });
      }

      const spotOwner = spotSnap && spotSnap.exists ? spotSnap.data()?.createdBy : null;
      const markerExists = new Set(
        markerReads.filter((_, i) => markerSnaps[i]?.exists === true).map((m) => `${m.uid}/${m.id}`),
      );

      const turnsFor = (uid: string): number => (emptyForfeit ? 0 : (derivedJudged[uid] ?? 0));

      const applySide = (
        uid: string,
        snap: { exists: boolean; data: () => Record<string, unknown> | undefined } | null,
        patch: Record<string, unknown>,
        isWinner: boolean,
        opponent: string,
      ): void => {
        if (!earnsXp(uid, gate) || snap?.exists !== true) return;
        const data = snap.data() ?? {};
        const lands = derivedPlayers[uid]?.tricksLanded ?? 0;
        const play =
          emptyForfeit || !oldEnough
            ? 0
            : Math.floor(
                (FINISH_XP + (game.status === "complete" && isWinner ? WIN_XP : 0) + lands * LAND_XP) * multiplier,
              );
        const calls = judgeUid === uid ? turnsFor(uid) * CALL_XP : 0;
        const award = play + calls;
        if (day !== null && award > 0) {
          const sameDay = data.xpDay === day;
          const used = sameDay ? counter(data.xpToday) : 0;
          const kept = Math.min(award, Math.max(0, DAILY_XP_CAP - used));
          if (kept > 0) {
            const nextXp = counter(data.xp) + kept;
            patch.xp = nextXp;
            patch.level = levelForXp(nextXp);
            patch.xpDay = day;
            patch.xpToday = used + kept;
          }
        } else if (award > 0) {
          // No timestamp to name the UTC day: pay the award, skip the bucket.
          const nextXp = counter(data.xp) + award;
          patch.xp = nextXp;
          patch.level = levelForXp(nextXp);
        }

        if (!emptyForfeit) {
          const oppKey = `${uid}/opp_${opponent}`;
          if (!markerExists.has(oppKey)) {
            patch.uniqueOpponents = counter(data.uniqueOpponents) + 1;
            xpSets.push({
              ref: markerRef(uid, `opp_${opponent}`),
              data: { kind: "opponent", createdAt: FieldValue.serverTimestamp() },
            });
          }
          if (spotId !== null) {
            const spotKey = `${uid}/spot_${spotId}`;
            if (!markerExists.has(spotKey)) {
              patch.spotsPlayed = counter(data.spotsPlayed) + 1;
              xpSets.push({
                ref: markerRef(uid, `spot_${spotId}`),
                data: { kind: "spot", createdAt: FieldValue.serverTimestamp() },
              });
            }
            if (spotOwner === uid) patch.gamesAtMySpots = counter(data.gamesAtMySpots) + 1;
          }
        }

        const next: Record<string, number> = {
          gamesPlayed: counter(data.gamesPlayed) + 1,
          wins: counter(data.wins) + (isWinner ? 1 : 0),
          bestWinStreak: isWinner
            ? Math.max(counter(data.bestWinStreak), counter(data.currentWinStreak) + 1)
            : counter(data.bestWinStreak),
          tricksLanded: counter(data.tricksLanded) + lands,
          cleanWins: counter(data.cleanWins) + (isWinner && (derivedPlayers[uid]?.lettersTaken ?? 0) === 0 ? 1 : 0),
          comebackWins:
            counter(data.comebackWins) +
            (isWinner && (derivedPlayers[uid]?.peakLetters ?? 0) >= COMEBACK_LETTER_THRESHOLD ? 1 : 0),
          turnsJudged: counter(data.turnsJudged) + (judgeUid === uid ? turnsFor(uid) : 0),
          disputeVotesCast: counter(data.disputeVotesCast),
          uniqueOpponents:
            typeof patch.uniqueOpponents === "number" ? patch.uniqueOpponents : counter(data.uniqueOpponents),
          spotsPlayed: typeof patch.spotsPlayed === "number" ? patch.spotsPlayed : counter(data.spotsPlayed),
          gamesAtMySpots:
            typeof patch.gamesAtMySpots === "number" ? patch.gamesAtMySpots : counter(data.gamesAtMySpots),
          clipsPosted: counter(data.clipsPosted),
        };
        for (const [id, field, at, reason] of XP_GRANTS) {
          if ((next[field] ?? 0) >= at) {
            xpSets.push({
              ref: achievementRef(uid, id),
              data: { __grant: true, earnedAt: FieldValue.serverTimestamp(), reason },
            });
          }
        }
      };

      applySide(winner, winnerSnap, winnerPatch, true, loser);
      applySide(loser, loserSnap, loserPatch, false, winner);
      if (judgeUid !== null && judgeEarns && !judgeIsPlayer && judgeSnap?.exists === true) {
        const data = judgeSnap.data() ?? {};
        const calls = turnsFor(judgeUid) * CALL_XP;
        if (day !== null && calls > 0) {
          const sameDay = data.xpDay === day;
          const used = sameDay ? counter(data.xpToday) : 0;
          const kept = Math.min(calls, Math.max(0, DAILY_XP_CAP - used));
          if (kept > 0) {
            const nextXp = counter(data.xp) + kept;
            judgePatch.xp = nextXp;
            judgePatch.level = levelForXp(nextXp);
            judgePatch.xpDay = day;
            judgePatch.xpToday = used + kept;
          }
        }
        const nextTurns = counter(data.turnsJudged) + turnsFor(judgeUid);
        const next: Record<string, number> = {
          gamesPlayed: counter(data.gamesPlayed),
          wins: counter(data.wins),
          bestWinStreak: counter(data.bestWinStreak),
          tricksLanded: counter(data.tricksLanded),
          cleanWins: counter(data.cleanWins),
          comebackWins: counter(data.comebackWins),
          turnsJudged: nextTurns,
          disputeVotesCast: counter(data.disputeVotesCast),
          uniqueOpponents: counter(data.uniqueOpponents),
          spotsPlayed: counter(data.spotsPlayed),
          gamesAtMySpots: counter(data.gamesAtMySpots),
          clipsPosted: counter(data.clipsPosted),
        };
        for (const [id, field, at, reason] of XP_GRANTS) {
          if ((next[field] ?? 0) >= at) {
            xpSets.push({
              ref: achievementRef(judgeUid, id),
              data: { __grant: true, earnedAt: FieldValue.serverTimestamp(), reason },
            });
          }
        }
      }

      if (judgeIsPlayer && judgeUid !== null) {
        const patch = judgeUid === winner ? winnerPatch : loserPatch;
        const judgedTurns = derivedJudged[judgeUid] ?? 0;
        patch.gamesJudged = FieldValue.increment(1);
        if (judgedTurns > 0) patch.turnsJudged = FieldValue.increment(judgedTurns);
      }

      // Achievement creates only for docs that are not already there.
      const grantSets = xpSets.filter((s) => s.data.__grant === true);
      const otherSets = xpSets.filter((s) => s.data.__grant !== true);
      const grantSnaps = await Promise.all(grantSets.map((s) => tx.get(s.ref as DocumentReference)));
      xpSets.length = 0;
      xpSets.push(...otherSets);
      grantSets.forEach((s, i) => {
        if (grantSnaps[i]?.exists === true) return;
        const { __grant: _drop, ...data } = s.data;
        void _drop;
        xpSets.push({ ref: s.ref, data });
      });
    }

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
        ...winnerPatch,
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
        ...loserPatch,
      });
    } else {
      console.warn(`applyGameStats: loser profile ${loser} missing; skipping loss increment for game ${gameId}`);
    }

    if (judgeRef !== null && judgeUid !== null && !judgeIsPlayer) {
      if (judgeSnap?.exists === true) {
        tx.update(judgeRef, {
          gamesJudged: FieldValue.increment(1),
          ...increments({ turnsJudged: judgedBy[judgeUid] ?? 0 }),
          ...judgePatch,
        });
      } else {
        console.warn(`applyGameStats: judge profile ${judgeUid} missing; skipping judge credit for game ${gameId}`);
      }
    }

    for (const write of xpSets) {
      tx.set(write.ref as DocumentReference, write.data);
    }

    return "applied";
  });
}
