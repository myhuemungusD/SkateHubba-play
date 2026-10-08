/**
 * Firestore wiring for Roll Dice. Every mutation runs in one transaction.
 * The phone never writes a dice document; this module is the only writer
 * besides account-deletion cleanup.
 */
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/logger";
import { cloResolve } from "./clo.js";
import { rollN } from "./dice.js";
import {
  ACTIVE_GAME_CAP,
  CREATE_COOLDOWN_MS,
  HISTORY_CAP,
  ROLL_COOLDOWN_MS,
  TURN_DURATION_MS,
  applyCloRoll,
  applyDecline,
  applyQuit,
  applyTimeout,
  freshMatch,
  statsDelta,
  type AppliedRoll,
  type DiceMatch,
  type DiceStatus,
} from "./engine.js";
import { noticesForEnd, noticesForRoll, type DiceNotice } from "./notify.js";
import type { DiceDb, DiceTx } from "./store.js";

export class DiceActionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DiceActionError";
  }
}

export interface DiceActionResult {
  gameId: string;
  status: DiceStatus;
  label: string | null;
  currentTurn: string | null;
  roundsWon: Record<string, number>;
  winner: string | null;
  applied: boolean;
}

interface Actor {
  uid: string;
  emailVerified: boolean;
  nowMs: number;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function mapEngineError(err: unknown): never {
  if (err instanceof DiceActionError) throw err;
  if (err instanceof Error) {
    switch (err.message) {
      case "NOT_YOUR_TURN":
        throw new DiceActionError("not_your_turn");
      case "NOT_IN_PROGRESS":
        throw new DiceActionError("game_over");
      case "NOT_A_PLAYER":
        throw new DiceActionError("not_a_player");
      case "NOT_DECLINABLE":
        throw new DiceActionError("not_declinable");
      case "BAD_DICE":
        throw new DiceActionError("bad_dice");
      default:
        break;
    }
  }
  throw err;
}

function rollsFromResults(raw: unknown): Record<string, readonly number[]> {
  const record = asRecord(raw);
  if (!record) return {};
  const rolls: Record<string, readonly number[]> = {};
  for (const [uid, value] of Object.entries(record)) {
    const dice = asRecord(value)?.dice;
    if (Array.isArray(dice) && dice.every((face) => typeof face === "number")) {
      rolls[uid] = dice as number[];
    }
  }
  return rolls;
}

function roundsFrom(raw: unknown, seats: readonly string[]): Record<string, number> {
  const record = asRecord(raw) ?? {};
  const rounds: Record<string, number> = {};
  for (const seat of seats) rounds[seat] = num(record[seat]);
  return rounds;
}

export function matchFromData(data: Record<string, unknown>): DiceMatch | null {
  const p1 = data.player1Uid;
  const p2 = data.player2Uid;
  if (typeof p1 !== "string" || typeof p2 !== "string" || p1.length === 0 || p2.length === 0) return null;
  const status = data.status;
  if (status !== "active" && status !== "forfeit" && status !== "declined" && status !== "expired") return null;
  const seats: readonly string[] = [p1, p2];
  const turn = data.currentTurn;
  const found = typeof turn === "string" ? seats.indexOf(turn) : -1;
  const endReason = data.endReason;
  return {
    status,
    seats,
    current: found >= 0 ? found : 0,
    round: Math.max(1, num(data.round) || 1),
    roundsWon: roundsFrom(data.roundsWon, seats),
    rolls: rollsFromResults(data.results),
    rollCount: num(data.rollCount),
    winner: typeof data.winner === "string" ? data.winner : null,
    endReason: endReason === "quit" || endReason === "timeout" || endReason === "decline" ? endReason : null,
  };
}

function resultsFromRolls(rolls: Readonly<Record<string, readonly number[]>>): Record<string, unknown> {
  const results: Record<string, unknown> = {};
  for (const [uid, dice] of Object.entries(rolls)) {
    const resolved = cloResolve(dice);
    if (resolved.rank === null) continue;
    results[uid] = { dice: [...dice], outcome: resolved.outcome, label: resolved.label, rank: resolved.rank };
  }
  return results;
}

function stateFields(state: DiceMatch, nowMs: number): Record<string, unknown> {
  return {
    status: state.status,
    currentTurn: state.status === "active" ? (state.seats[state.current] ?? null) : null,
    round: state.round,
    roundsWon: { ...state.roundsWon },
    results: resultsFromRolls(state.rolls),
    rollCount: state.rollCount,
    winner: state.winner,
    endReason: state.endReason,
    updatedAt: nowMs,
  };
}

function namesFrom(data: Record<string, unknown>, state: DiceMatch): Record<string, string> {
  const names: Record<string, string> = {};
  const p1 = state.seats[0];
  const p2 = state.seats[1];
  if (p1 && typeof data.player1Username === "string") names[p1] = data.player1Username;
  if (p2 && typeof data.player2Username === "string") names[p2] = data.player2Username;
  return names;
}

function resultOf(gameId: string, state: DiceMatch, label: string | null, applied: boolean): DiceActionResult {
  return {
    gameId,
    status: state.status,
    label,
    currentTurn: state.status === "active" ? (state.seats[state.current] ?? null) : null,
    roundsWon: { ...state.roundsWon },
    winner: state.winner,
    applied,
  };
}

function stageNotices(tx: DiceTx, notices: DiceNotice[]): void {
  for (const item of notices) {
    tx.set(`notifications/${item.dedupeKey}`, {
      senderUid: item.senderUid,
      recipientUid: item.recipientUid,
      type: item.type,
      title: item.title,
      body: item.body,
      gameId: item.gameId,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}

async function writeStats(tx: DiceTx, state: DiceMatch, nowMs: number): Promise<void> {
  const delta = statsDelta(state);
  if (!delta) return;
  const rows: Array<{ uid: string; field: "wins" | "losses" }> = [
    { uid: delta.winnerUid, field: "wins" },
    { uid: delta.loserUid, field: "losses" },
  ];
  for (const row of rows) {
    const snap = await tx.get(`diceStats/${row.uid}`);
    const data = snap.data ?? {};
    tx.set(
      `diceStats/${row.uid}`,
      {
        wins: num(data.wins) + (row.field === "wins" ? 1 : 0),
        losses: num(data.losses) + (row.field === "losses" ? 1 : 0),
        gamesPlayed: num(data.gamesPlayed) + 1,
        updatedAt: nowMs,
      },
      true,
    );
  }
}

function appendHistory(existing: unknown, entry: Record<string, unknown>): unknown[] {
  const list = Array.isArray(existing) ? existing.slice() : [];
  list.push(entry);
  if (list.length <= HISTORY_CAP) return list;
  return list.slice(list.length - HISTORY_CAP);
}

async function usernameOf(db: DiceDb, uid: string): Promise<string | null> {
  const snap = await db.get(`users/${uid}`);
  const name = snap.data?.username;
  return typeof name === "string" && name.length > 0 ? name : null;
}

async function isBanned(db: DiceDb, uid: string): Promise<boolean> {
  const [ban, user] = await Promise.all([db.get(`bans/${uid}`), db.get(`users/${uid}`)]);
  return ban.data !== undefined || user.data?.banned === true;
}

async function isBlocked(db: DiceDb, a: string, b: string): Promise<boolean> {
  const [ab, ba] = await Promise.all([
    db.get(`users/${a}/blocked_users/${b}`),
    db.get(`users/${b}/blocked_users/${a}`),
  ]);
  return ab.data !== undefined || ba.data !== undefined;
}

async function countActive(tx: DiceTx, uid: string): Promise<number> {
  const [asP1, asP2] = await Promise.all([
    tx.query({
      collection: "diceGames",
      filters: [
        { field: "player1Uid", op: "==", value: uid },
        { field: "status", op: "==", value: "active" },
      ],
    }),
    tx.query({
      collection: "diceGames",
      filters: [
        { field: "player2Uid", op: "==", value: uid },
        { field: "status", op: "==", value: "active" },
      ],
    }),
  ]);
  const ids = new Set([...asP1, ...asP2].map((doc) => doc.id));
  return ids.size;
}

export async function createDiceGame(db: DiceDb, actor: Actor, opponentUid: string): Promise<DiceActionResult> {
  if (!actor.emailVerified) throw new DiceActionError("email_unverified");
  if (opponentUid.length === 0 || opponentUid === actor.uid) throw new DiceActionError("self_challenge");
  const [myName, theirName, iAmBanned, theyAreBanned, blocked] = await Promise.all([
    usernameOf(db, actor.uid),
    usernameOf(db, opponentUid),
    isBanned(db, actor.uid),
    isBanned(db, opponentUid),
    isBlocked(db, actor.uid, opponentUid),
  ]);
  if (!myName || !theirName) throw new DiceActionError("not_found");
  if (iAmBanned || theyAreBanned) throw new DiceActionError("banned");
  if (blocked) throw new DiceActionError("blocked");

  const gameId = db.newId("diceGames");
  const state = freshMatch([actor.uid, opponentUid]);
  await db.runTransaction(async (tx) => {
    const limit = await tx.get(`diceCreateLimits/${actor.uid}`);
    const last = limit.data?.lastCreateAt;
    if (typeof last === "number" && actor.nowMs - last < CREATE_COOLDOWN_MS) {
      throw new DiceActionError("slow_down");
    }
    const active = await countActive(tx, actor.uid);
    if (active >= ACTIVE_GAME_CAP) throw new DiceActionError("too_many_active");
    tx.set(`diceGames/${gameId}`, {
      v: 1,
      game: "clo",
      playerUids: [actor.uid, opponentUid],
      player1Uid: actor.uid,
      player2Uid: opponentUid,
      player1Username: myName,
      player2Username: theirName,
      ...stateFields(state, actor.nowMs),
      lastRoll: null,
      history: [],
      turnDeadline: actor.nowMs + TURN_DURATION_MS,
      createdAt: actor.nowMs,
      stake: null,
      lastRollAt: null,
    });
    tx.set(`diceCreateLimits/${actor.uid}`, { lastCreateAt: actor.nowMs }, true);
  });
  return resultOf(gameId, state, null, true);
}

async function loadGame(
  tx: DiceTx,
  gameId: string,
  uid: string,
): Promise<{ data: Record<string, unknown>; state: DiceMatch }> {
  const snap = await tx.get(`diceGames/${gameId}`);
  if (!snap.data) throw new DiceActionError("not_found");
  const state = matchFromData(snap.data);
  if (!state) throw new DiceActionError("bad_doc");
  if (!state.seats.includes(uid)) throw new DiceActionError("not_a_player");
  return { data: snap.data, state };
}

export async function rollDice(db: DiceDb, actor: Actor, gameId: string): Promise<DiceActionResult> {
  const committed = await db.runTransaction(async (tx) => {
    const loaded = await loadGame(tx, gameId, actor.uid);
    const last = loaded.data.lastRollAt;
    if (typeof last === "number" && actor.nowMs - last < ROLL_COOLDOWN_MS) {
      throw new DiceActionError("slow_down");
    }
    const dice = rollN(3);
    let applied: AppliedRoll;
    try {
      applied = applyCloRoll(loaded.state, actor.uid, dice);
    } catch (err) {
      mapEngineError(err);
    }
    const built = noticesForRoll(
      gameId,
      loaded.state,
      applied.state,
      applied.effect,
      actor.uid,
      applied.label,
      namesFrom(loaded.data, loaded.state),
    );
    const history = appendHistory(loaded.data.history, {
      uid: actor.uid,
      dice: [...dice],
      label: applied.label,
      round: loaded.state.round,
      at: actor.nowMs,
    });
    await writeStats(tx, applied.state, actor.nowMs);
    stageNotices(tx, built);
    tx.update(`diceGames/${gameId}`, {
      ...stateFields(applied.state, actor.nowMs),
      lastRoll: {
        uid: actor.uid,
        dice: [...dice],
        outcome: applied.outcome,
        label: applied.label,
        rollId: crypto.randomUUID(),
        at: actor.nowMs,
      },
      history,
      lastRollAt: actor.nowMs,
      turnDeadline: actor.nowMs + TURN_DURATION_MS,
    });
    return { result: resultOf(gameId, applied.state, applied.label, true), notices: built };
  });
  await deliverDicePushes(db, committed.notices);
  return committed.result;
}

async function endMatch(
  db: DiceDb,
  actor: Actor,
  gameId: string,
  nextOf: (state: DiceMatch) => DiceMatch,
): Promise<DiceActionResult> {
  const committed = await db.runTransaction(async (tx) => {
    const loaded = await loadGame(tx, gameId, actor.uid);
    let after: DiceMatch;
    try {
      after = nextOf(loaded.state);
    } catch (err) {
      mapEngineError(err);
    }
    const built = noticesForEnd(gameId, after, actor.uid, namesFrom(loaded.data, loaded.state));
    await writeStats(tx, after, actor.nowMs);
    stageNotices(tx, built);
    tx.update(`diceGames/${gameId}`, stateFields(after, actor.nowMs));
    return { result: resultOf(gameId, after, null, true), notices: built };
  });
  await deliverDicePushes(db, committed.notices);
  return committed.result;
}

export function quitDice(db: DiceDb, actor: Actor, gameId: string): Promise<DiceActionResult> {
  return endMatch(db, actor, gameId, (state) => applyQuit(state, actor.uid));
}

export function declineDice(db: DiceDb, actor: Actor, gameId: string): Promise<DiceActionResult> {
  return endMatch(db, actor, gameId, (state) => applyDecline(state, actor.uid));
}

export async function claimDiceTimeout(db: DiceDb, actor: Actor, gameId: string): Promise<DiceActionResult> {
  const committed = await db.runTransaction(async (tx) => {
    const loaded = await loadGame(tx, gameId, actor.uid);
    const deadline = loaded.data.turnDeadline;
    const deadlineMs = typeof deadline === "number" ? deadline : Number.POSITIVE_INFINITY;
    let after: DiceMatch | null;
    try {
      after = applyTimeout(loaded.state, actor.nowMs, deadlineMs);
    } catch (err) {
      mapEngineError(err);
    }
    if (!after) return { result: resultOf(gameId, loaded.state, null, false), notices: [] as DiceNotice[] };
    const built = noticesForEnd(gameId, after, actor.uid, namesFrom(loaded.data, loaded.state));
    await writeStats(tx, after, actor.nowMs);
    stageNotices(tx, built);
    tx.update(`diceGames/${gameId}`, stateFields(after, actor.nowMs));
    return { result: resultOf(gameId, after, null, true), notices: built };
  });
  await deliverDicePushes(db, committed.notices);
  return committed.result;
}

/** How many expired games one sweep invocation will close. The next run gets the rest. */
const SWEEP_LIMIT = 50;

export async function sweepExpiredDiceGames(db: DiceDb, nowMs: number): Promise<number> {
  const due = await db.query({
    collection: "diceGames",
    filters: [
      { field: "status", op: "==", value: "active" },
      { field: "turnDeadline", op: "<", value: nowMs },
    ],
    limit: SWEEP_LIMIT,
  });
  let closed = 0;
  for (const doc of due) {
    const seat = doc.data?.player1Uid;
    if (typeof seat !== "string") continue;
    try {
      const result = await claimDiceTimeout(db, { uid: seat, emailVerified: true, nowMs }, doc.id);
      if (result.applied) closed += 1;
    } catch (err) {
      logger.warn("dice_sweep_skip", {
        gameId: doc.id,
        code: err instanceof DiceActionError ? err.code : "unknown",
      });
    }
  }
  return closed;
}

/**
 * Queue an OS push for each notice. Recipients who turned push off, and
 * recipients with no tokens, are skipped. In-app notifications are already
 * written inside the game transaction. A push failure is logged and does
 * not undo the roll.
 */
export async function deliverDicePushes(db: DiceDb, notices: DiceNotice[]): Promise<void> {
  for (const item of notices) {
    try {
      const pref = await db.get(`users/${item.recipientUid}/private/profile`);
      if (pref.data?.pushEnabled === false) continue;
      const mirror = await db.get(`pushTargets/${item.recipientUid}`);
      const raw = mirror.data?.tokens;
      const tokens = Array.isArray(raw)
        ? raw.filter((token): token is string => typeof token === "string" && token.length > 0).slice(0, 10)
        : [];
      if (tokens.length === 0) continue;
      await db.add("push_dispatch", {
        tokens,
        notification: { title: item.title, body: item.body },
        data: {
          gameId: item.gameId,
          type: item.type,
          kind: "dice",
          click_action: `/dice/${item.gameId}`,
        },
        senderUid: item.senderUid,
        recipientUid: item.recipientUid,
        gameId: item.gameId,
        type: item.type,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      logger.warn("dice_push_failed", {
        gameId: item.gameId,
        recipientUid: item.recipientUid,
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }
}
