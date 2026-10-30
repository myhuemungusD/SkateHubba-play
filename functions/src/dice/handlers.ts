/**
 * Firestore wiring for Roll Dice. Every mutation runs in one transaction.
 * The phone never writes a dice document; this module is the only writer
 * besides account-deletion cleanup. The server rolls every die and scores
 * every hand, so a client can't forge a roll, a point, or Rep.
 */
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/logger";
import { diceEligibleTokens } from "../push/platforms.js";
import { rollN } from "./dice.js";
import { appendCapped, currentTurnOf, matchFromData, namesFrom, stateFields } from "./docs.js";
import {
  ACTIVE_GAME_CAP,
  CREATE_COOLDOWN_MS,
  HISTORY_CAP,
  NUDGE_COOLDOWN_MS,
  REMINDER_LEAD_MS,
  ROLL_COOLDOWN_MS,
  ROUNDS_CAP,
  TURN_DURATION_MS,
  applyAccept,
  applyDecline,
  applyQuit,
  applyTimeout,
  freshMatch,
  type DiceMatch,
  type DiceStatus,
} from "./engine.js";
import { defaultTarget, isAllowedTarget, isDiceMode, MODE_RULES, type DiceMode } from "./modes.js";
import {
  noticeForAccept,
  noticeForChallenge,
  noticeForNudge,
  noticeForReminder,
  noticesForEnd,
  noticesForRoll,
  type DiceNotice,
} from "./notify.js";
import { applyCloRoll, applyCrapsRoll, applyTenBank, applyTenRoll, tenRollCount, type AppliedRoll } from "./play.js";
import { writeStats } from "./stats.js";
import type { DiceDb, DiceTx } from "./store.js";

export class DiceActionError extends Error {
  /** `retryAfterMs` rides along on cooldowns so the app can say when to try again. */
  constructor(
    readonly code: string,
    readonly details?: { retryAfterMs: number },
  ) {
    super(code);
    this.name = "DiceActionError";
  }
}

function cooldown(code: string, windowMs: number, sinceMs: number): DiceActionError {
  return new DiceActionError(code, { retryAfterMs: Math.max(1, windowMs - sinceMs) });
}

export interface DiceActionResult {
  gameId: string;
  status: DiceStatus;
  label: string | null;
  outcome: string | null;
  callout: string | null;
  dice: number[] | null;
  rollId: string | null;
  currentTurn: string | null;
  scores: Record<string, number>;
  winner: string | null;
  applied: boolean;
}

export interface Actor {
  uid: string;
  emailVerified: boolean;
  nowMs: number;
}

export interface CreateOptions {
  mode?: unknown;
  target?: unknown;
}

const ENGINE_CODES: Record<string, string> = {
  NOT_YOUR_TURN: "not_your_turn",
  NOT_IN_PROGRESS: "game_over",
  NOT_A_PLAYER: "not_a_player",
  NOT_DECLINABLE: "not_declinable",
  NOT_PENDING: "not_pending",
  NOT_ACCEPTABLE: "not_acceptable",
  BAD_DICE: "bad_dice",
  BAD_KEEP: "bad_keep",
  NOTHING_TO_BANK: "bad_keep",
  WRONG_MODE: "wrong_mode",
  // A doc missing a seat or a roll it should have: unreadable, not a server fault.
  NO_OPPONENT: "bad_doc",
  MISSING_ROLL: "bad_doc",
};

function mapEngineError(err: unknown): never {
  if (err instanceof DiceActionError) throw err;
  const code = err instanceof Error ? ENGINE_CODES[err.message] : undefined;
  if (code) throw new DiceActionError(code);
  throw err;
}

function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    mapEngineError(err);
  }
}

function resultOf(
  gameId: string,
  state: DiceMatch,
  applied: boolean,
  roll?: AppliedRoll,
  rollId?: string,
): DiceActionResult {
  return {
    gameId,
    status: state.status,
    label: roll?.label ?? null,
    outcome: roll?.outcome ?? null,
    callout: roll?.callout ?? null,
    dice: roll ? [...roll.dice] : null,
    rollId: rollId ?? null,
    currentTurn: currentTurnOf(state),
    scores: { ...state.scores },
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

/** Clock fields for whoever moves next. */
function clock(state: DiceMatch, nowMs: number): Record<string, unknown> {
  const deadline = nowMs + TURN_DURATION_MS;
  return {
    turnDeadline: deadline,
    remindAt: state.status === "active" ? deadline - REMINDER_LEAD_MS : null,
  };
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

/** Open matches (pending or active) the player is in. */
async function countOpen(tx: DiceTx, uid: string): Promise<number> {
  const queries = ["player1Uid", "player2Uid"].flatMap((field) =>
    ["active", "pending"].map((status) =>
      tx.query({
        collection: "diceGames",
        filters: [
          { field, op: "==", value: uid },
          { field: "status", op: "==", value: status },
        ],
      }),
    ),
  );
  const rows = (await Promise.all(queries)).flat();
  return new Set(rows.map((doc) => doc.id)).size;
}

async function checkPair(db: DiceDb, actor: Actor, opponentUid: string): Promise<{ me: string; them: string }> {
  if (!actor.emailVerified) throw new DiceActionError("email_unverified");
  if (opponentUid.length === 0 || opponentUid === actor.uid) throw new DiceActionError("self_challenge");
  const [me, them, iAmBanned, theyAreBanned, blocked] = await Promise.all([
    usernameOf(db, actor.uid),
    usernameOf(db, opponentUid),
    isBanned(db, actor.uid),
    isBanned(db, opponentUid),
    isBlocked(db, actor.uid, opponentUid),
  ]);
  if (!me || !them) throw new DiceActionError("not_found");
  if (iAmBanned || theyAreBanned) throw new DiceActionError("banned");
  if (blocked) throw new DiceActionError("blocked");
  return { me, them };
}

function newGameDoc(
  actor: Actor,
  opponentUid: string,
  names: { me: string; them: string },
  state: DiceMatch,
  rematchOf: string | null,
): Record<string, unknown> {
  return {
    playerUids: [actor.uid, opponentUid],
    player1Uid: actor.uid,
    player2Uid: opponentUid,
    player1Username: names.me,
    player2Username: names.them,
    ...stateFields(state, actor.nowMs),
    lastRoll: null,
    history: [],
    rounds: [],
    turnDeadline: actor.nowMs + TURN_DURATION_MS,
    remindAt: null,
    createdAt: actor.nowMs,
    stake: null,
    lastRollAt: null,
    nudgedAt: null,
    repChange: null,
    rematchOf,
    rematchGameId: null,
  };
}

async function openChallenge(
  db: DiceDb,
  actor: Actor,
  opponentUid: string,
  mode: DiceMode,
  target: number,
  rematchOf: string | null,
): Promise<DiceActionResult> {
  const names = await checkPair(db, actor, opponentUid);
  const gameId = db.newId("diceGames");
  const state = freshMatch([actor.uid, opponentUid], mode, target);
  const committed = await db.runTransaction(async (tx) => {
    const limit = await tx.get(`diceCreateLimits/${actor.uid}`);
    const last = limit.data?.lastCreateAt;
    if (typeof last === "number" && actor.nowMs - last < CREATE_COOLDOWN_MS) {
      throw cooldown("create_cooldown", CREATE_COOLDOWN_MS, actor.nowMs - last);
    }
    if ((await countOpen(tx, actor.uid)) >= ACTIVE_GAME_CAP) throw new DiceActionError("too_many_active");
    if (rematchOf) {
      const old = await tx.get(`diceGames/${rematchOf}`);
      const existing = old.data?.rematchGameId;
      if (typeof existing === "string" && existing.length > 0) return { reuse: existing, notices: [] };
      tx.update(`diceGames/${rematchOf}`, { rematchGameId: gameId });
    }
    const built = noticeForChallenge(gameId, state, { [actor.uid]: names.me, [opponentUid]: names.them });
    tx.set(`diceGames/${gameId}`, newGameDoc(actor, opponentUid, names, state, rematchOf));
    tx.set(`diceCreateLimits/${actor.uid}`, { lastCreateAt: actor.nowMs }, true);
    stageNotices(tx, built);
    return { reuse: null, notices: built };
  });
  if (committed.reuse) return { ...resultOf(committed.reuse, state, false), status: "pending" };
  await deliverDicePushes(db, committed.notices);
  return resultOf(gameId, state, true);
}

export async function createDiceGame(
  db: DiceDb,
  actor: Actor,
  opponentUid: string,
  options: CreateOptions = {},
): Promise<DiceActionResult> {
  const mode = options.mode === undefined ? "clo" : options.mode;
  if (!isDiceMode(mode)) throw new DiceActionError("bad_mode");
  const target = options.target === undefined ? defaultTarget(mode) : options.target;
  if (!isAllowedTarget(mode, target)) throw new DiceActionError("bad_mode");
  return openChallenge(db, actor, opponentUid, mode, target, null);
}

/** Same opponent, same game and length. A second tap (from either player) reopens the same rematch. */
export async function rematchDice(db: DiceDb, actor: Actor, gameId: string): Promise<DiceActionResult> {
  const snap = await db.get(`diceGames/${gameId}`);
  if (!snap.data) throw new DiceActionError("not_found");
  const old = matchFromData(snap.data);
  if (!old) throw new DiceActionError("bad_doc");
  if (!old.seats.includes(actor.uid)) throw new DiceActionError("not_a_player");
  if (old.status === "active" || old.status === "pending") throw new DiceActionError("still_playing");
  const existing = snap.data.rematchGameId;
  if (typeof existing === "string" && existing.length > 0) {
    return { ...resultOf(existing, old, false), status: "pending" };
  }
  const opponent = old.seats.find((seat) => seat !== actor.uid) ?? "";
  return openChallenge(db, actor, opponent, old.mode, old.target, gameId);
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

export async function acceptDice(db: DiceDb, actor: Actor, gameId: string): Promise<DiceActionResult> {
  const committed = await db.runTransaction(async (tx) => {
    const loaded = await loadGame(tx, gameId, actor.uid);
    const after = guard(() => applyAccept(loaded.state, actor.uid));
    const built = noticeForAccept(gameId, after, namesFrom(loaded.data, loaded.state));
    stageNotices(tx, built);
    tx.update(`diceGames/${gameId}`, { ...stateFields(after, actor.nowMs), ...clock(after, actor.nowMs) });
    return { result: resultOf(gameId, after, true), notices: built };
  });
  await deliverDicePushes(db, committed.notices);
  return committed.result;
}

type RollKind = { kind: "roll"; keep: readonly number[] } | { kind: "bank"; keep: readonly number[] };

function play(state: DiceMatch, uid: string, move: RollKind): AppliedRoll {
  if (move.kind === "bank") return applyTenBank(state, uid, move.keep);
  if (state.mode === "ten") return applyTenRoll(state, uid, move.keep, rollN(tenRollCount(state, uid, move.keep)));
  if (move.keep.length > 0) throw new Error("BAD_KEEP");
  if (state.mode === "craps") return applyCrapsRoll(state, uid, rollN(MODE_RULES.craps.dice));
  return applyCloRoll(state, uid, rollN(3));
}

async function moveDice(db: DiceDb, actor: Actor, gameId: string, move: RollKind): Promise<DiceActionResult> {
  const committed = await db.runTransaction(async (tx) => {
    const loaded = await loadGame(tx, gameId, actor.uid);
    const last = loaded.data.lastRollAt;
    // The cooldown stops one skater spamming rolls. Banking throws no dice, and
    // the other skater answering right away is normal play, so neither waits.
    const lastRoll = loaded.data.lastRoll as { uid?: unknown } | null | undefined;
    const mine = lastRoll?.uid === actor.uid;
    const cooling = move.kind === "roll" && mine && typeof last === "number" && actor.nowMs - last < ROLL_COOLDOWN_MS;
    if (cooling) throw cooldown("slow_down", ROLL_COOLDOWN_MS, actor.nowMs - last);
    const applied = guard(() => play(loaded.state, actor.uid, move));
    const rep = await writeStats(tx, applied.state, actor.nowMs);
    const built = noticesForRoll(
      gameId,
      applied.state,
      applied.effect,
      actor.uid,
      applied.label,
      namesFrom(loaded.data, loaded.state),
      rep,
    );
    const rollId = crypto.randomUUID();
    const entry = {
      uid: actor.uid,
      dice: [...applied.dice],
      label: applied.label,
      outcome: applied.outcome,
      round: loaded.state.round,
      at: actor.nowMs,
    };
    stageNotices(tx, built);
    tx.update(`diceGames/${gameId}`, {
      ...stateFields(applied.state, actor.nowMs),
      ...clock(applied.state, actor.nowMs),
      lastRoll: { ...entry, callout: applied.callout, rollId, kind: move.kind },
      history: appendCapped(loaded.data.history, entry, HISTORY_CAP),
      rounds: applied.record
        ? appendCapped(loaded.data.rounds, { ...applied.record, at: actor.nowMs }, ROUNDS_CAP)
        : (loaded.data.rounds ?? []),
      lastRollAt: actor.nowMs,
      ...(Object.keys(rep).length > 0 ? { repChange: rep } : {}),
    });
    return { result: resultOf(gameId, applied.state, true, applied, rollId), notices: built };
  });
  await deliverDicePushes(db, committed.notices);
  return committed.result;
}

export function rollDice(
  db: DiceDb,
  actor: Actor,
  gameId: string,
  keep: readonly number[] = [],
): Promise<DiceActionResult> {
  return moveDice(db, actor, gameId, { kind: "roll", keep });
}

export function bankDice(db: DiceDb, actor: Actor, gameId: string, keep: readonly number[]): Promise<DiceActionResult> {
  return moveDice(db, actor, gameId, { kind: "bank", keep });
}

/**
 * End-of-match transaction shared by quit, decline and timeout. `nextOf`
 * returns the ended state, or null when nothing ends (an unexpired timeout
 * claim), in which case the game is returned unchanged.
 */
async function endMatch(
  db: DiceDb,
  actor: Actor,
  gameId: string,
  nextOf: (state: DiceMatch, data: Record<string, unknown>) => DiceMatch | null,
): Promise<DiceActionResult> {
  const committed = await db.runTransaction(async (tx) => {
    const loaded = await loadGame(tx, gameId, actor.uid);
    const after = guard(() => nextOf(loaded.state, loaded.data));
    if (!after) return { result: resultOf(gameId, loaded.state, false), notices: [] as DiceNotice[] };
    const rep = await writeStats(tx, after, actor.nowMs);
    const built = noticesForEnd(gameId, after, actor.uid, namesFrom(loaded.data, loaded.state), rep);
    stageNotices(tx, built);
    tx.update(`diceGames/${gameId}`, {
      ...stateFields(after, actor.nowMs),
      remindAt: null,
      ...(Object.keys(rep).length > 0 ? { repChange: rep } : {}),
    });
    return { result: resultOf(gameId, after, true), notices: built };
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

export function claimDiceTimeout(db: DiceDb, actor: Actor, gameId: string): Promise<DiceActionResult> {
  return endMatch(db, actor, gameId, (state, data) => {
    const deadline = data.turnDeadline;
    const deadlineMs = typeof deadline === "number" ? deadline : Number.POSITIVE_INFINITY;
    return applyTimeout(state, actor.nowMs, deadlineMs);
  });
}

/** The waiting player pokes the roller. One nudge per match per hour. */
export async function nudgeDice(db: DiceDb, actor: Actor, gameId: string): Promise<DiceActionResult> {
  const committed = await db.runTransaction(async (tx) => {
    const loaded = await loadGame(tx, gameId, actor.uid);
    const state = loaded.state;
    if (state.status !== "active") throw new DiceActionError("game_over");
    if (state.seats[state.current] === actor.uid) throw new DiceActionError("your_turn");
    const last = loaded.data.nudgedAt;
    if (typeof last === "number" && actor.nowMs - last < NUDGE_COOLDOWN_MS) {
      throw cooldown("nudge_cooldown", NUDGE_COOLDOWN_MS, actor.nowMs - last);
    }
    const built = noticeForNudge(gameId, state, actor.uid, actor.nowMs, namesFrom(loaded.data, state));
    stageNotices(tx, built);
    tx.update(`diceGames/${gameId}`, { nudgedAt: actor.nowMs });
    return { result: resultOf(gameId, state, true), notices: built };
  });
  await deliverDicePushes(db, committed.notices);
  return committed.result;
}

/** How many games one sweep invocation will touch per pass. The next run gets the rest. */
const SWEEP_LIMIT = 50;

async function sendReminders(db: DiceDb, nowMs: number): Promise<number> {
  const due = await db.query({
    collection: "diceGames",
    filters: [
      { field: "status", op: "==", value: "active" },
      { field: "remindAt", op: "<", value: nowMs },
    ],
    limit: SWEEP_LIMIT,
  });
  let sent = 0;
  for (const doc of due) {
    try {
      const notices = await db.runTransaction(async (tx) => {
        const snap = await tx.get(`diceGames/${doc.id}`);
        const data = snap.data;
        const state = data ? matchFromData(data) : null;
        if (
          !data ||
          !state ||
          state.status !== "active" ||
          typeof data.remindAt !== "number" ||
          data.remindAt >= nowMs
        ) {
          return [] as DiceNotice[];
        }
        const deadline = typeof data.turnDeadline === "number" ? data.turnDeadline : nowMs;
        const built = deadline > nowMs ? noticeForReminder(doc.id, state, deadline, namesFrom(data, state)) : [];
        stageNotices(tx, built);
        tx.update(`diceGames/${doc.id}`, { remindAt: null });
        return built;
      });
      if (notices.length > 0) sent += 1;
      await deliverDicePushes(db, notices);
    } catch (err) {
      logger.warn("dice_remind_skip", { gameId: doc.id, message: err instanceof Error ? err.message : "unknown" });
    }
  }
  return sent;
}

export async function sweepExpiredDiceGames(db: DiceDb, nowMs: number): Promise<number> {
  const due = (
    await Promise.all(
      ["active", "pending"].map((status) =>
        db.query({
          collection: "diceGames",
          filters: [
            { field: "status", op: "==", value: status },
            { field: "turnDeadline", op: "<", value: nowMs },
          ],
          limit: SWEEP_LIMIT,
        }),
      ),
    )
  ).flat();
  let closed = 0;
  for (const doc of due) {
    const seat = doc.data?.player1Uid;
    if (typeof seat !== "string") continue;
    try {
      const result = await claimDiceTimeout(db, { uid: seat, emailVerified: true, nowMs }, doc.id);
      if (result.applied) closed += 1;
    } catch (err) {
      logger.warn("dice_sweep_skip", { gameId: doc.id, code: err instanceof DiceActionError ? err.code : "unknown" });
    }
  }
  await sendReminders(db, nowMs);
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
      const all = Array.isArray(raw)
        ? raw.filter((token): token is string => typeof token === "string" && token.length > 0)
        : [];
      // Dice is off in the iOS build: only tokens tagged android or web get a
      // dice push, and an untagged (older) token counts as iOS. See push/platforms.ts.
      const tokens = diceEligibleTokens(mirror.data, all).slice(0, 10);
      if (tokens.length === 0) continue;
      await db.add("push_dispatch", {
        tokens,
        notification: { title: item.title, body: item.body },
        data: { gameId: item.gameId, type: item.type, kind: "dice", click_action: `/dice/${item.gameId}` },
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
