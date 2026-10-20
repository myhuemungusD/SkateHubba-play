/**
 * Roll Dice client. Reads are Firestore listeners. Every mutation goes
 * through the diceAction callable — the rules reject client writes.
 *
 * firebase/functions is imported inside the call so the main bundle does
 * not pay for it while the feature flag is off.
 */
import { collection, doc, limit, onSnapshot, orderBy, query, where, type Unsubscribe } from "firebase/firestore";
import { addBreadcrumb, captureException } from "../lib/sentry";
import * as firebase from "../firebase";
import { trackEvent } from "./analytics";
import { logger } from "./logger";
import { getNetworkSnapshot } from "./nativeBridge";
import { toDiceGame, toDiceStats, type DiceGameDoc, type DiceMode, type DiceStatsDoc } from "./dice.mappers";

export type {
  DiceEndReason,
  DiceGameDoc,
  DiceHand,
  DiceMode,
  DiceRollView,
  DiceRoundView,
  DiceStatsDoc,
  DiceStatus,
  DiceTenView,
} from "./dice.mappers";
export { DICE_MODES, DICE_TARGETS, toDiceGame, toDiceStats } from "./dice.mappers";

export interface DiceCallResult {
  gameId: string;
  status: string;
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

const LIST_LIMIT = 40;

const DICE_CODES = [
  "unauthenticated",
  "dice_disabled",
  "email_unverified",
  "self_challenge",
  "not_found",
  "banned",
  "blocked",
  "slow_down",
  "create_cooldown",
  "too_many_active",
  "not_your_turn",
  "game_over",
  "not_a_player",
  "not_declinable",
  "bad_dice",
  "bad_doc",
  "bad_request",
  "dice_failed",
  "not_pending",
  "not_acceptable",
  "bad_keep",
  "bad_mode",
  "wrong_mode",
  "still_playing",
  "your_turn",
  "nudge_cooldown",
  "offline",
  "network",
] as const;

export type DiceErrorCode = (typeof DICE_CODES)[number];

const DICE_MESSAGES: Record<DiceErrorCode, string> = {
  unauthenticated: "Sign in to roll.",
  dice_disabled: "Roll Dice is turned off.",
  email_unverified: "Verify your email first.",
  self_challenge: "You can't roll against yourself.",
  not_found: "That match is gone.",
  banned: "That challenge isn't available.",
  blocked: "That challenge isn't available.",
  slow_down: "Give it a second.",
  create_cooldown: "You just started a match. Try again in a few seconds.",
  too_many_active: "You already have 10 open dice matches. Finish one first.",
  not_your_turn: "It's their roll now.",
  game_over: "This match is already over.",
  not_a_player: "You're not in this match.",
  not_declinable: "This match can't be declined.",
  bad_dice: "That roll didn't count. Roll again.",
  bad_doc: "This match can't be loaded. Head back to Roll Dice.",
  bad_request: "That move didn't go through. Try again.",
  dice_failed: "Something went wrong at the table. Try again.",
  not_pending: "That challenge was already answered.",
  not_acceptable: "Only the skater you challenged can accept.",
  bad_keep: "Those dice changed. Pick your scoring dice again.",
  bad_mode: "Pick a game and a length.",
  wrong_mode: "That move isn't part of this game.",
  still_playing: "Finish this match first.",
  your_turn: "It's your roll.",
  nudge_cooldown: "You already nudged. Try again in a bit.",
  offline: "You're offline. Reconnect to roll.",
  network: "Couldn't reach the table. Check your signal and try again.",
};

/** Callable transport failures that aren't a dice rule, by Firebase error code. */
const TRANSPORT_CODES: Readonly<Record<string, DiceErrorCode>> = {
  "functions/unavailable": "network",
  "functions/deadline-exceeded": "network",
  "functions/unauthenticated": "unauthenticated",
  "functions/resource-exhausted": "slow_down",
};

function isDiceCode(value: unknown): value is DiceErrorCode {
  return typeof value === "string" && (DICE_CODES as readonly string[]).includes(value);
}

export interface DiceErrorInfo {
  code: DiceErrorCode;
  /** On cooldowns, how long the server says to wait. */
  retryAfterMs: number | null;
}

/**
 * Read a dice failure. The server's code arrives two ways: in `details.code`,
 * and as the message, which the Firebase SDK suffixes with the HTTP status
 * ("slow_down [400]"). Matching the bare message used to miss every code, so
 * every rejection read as the generic line.
 */
export function diceErrorInfo(err: unknown): DiceErrorInfo {
  if (!err || typeof err !== "object") return { code: "dice_failed", retryAfterMs: null };
  const { message, code, details } = err as { message?: unknown; code?: unknown; details?: unknown };
  const extra = (details && typeof details === "object" ? details : {}) as { code?: unknown; retryAfterMs?: unknown };
  const wait = extra.retryAfterMs;
  const retryAfterMs = typeof wait === "number" && Number.isFinite(wait) && wait > 0 ? wait : null;
  const bare = typeof message === "string" ? message.replace(/\s*\[\d+\]$/, "").trim() : "";
  if (isDiceCode(extra.code)) return { code: extra.code, retryAfterMs };
  if (isDiceCode(bare)) return { code: bare, retryAfterMs };
  const transport = typeof code === "string" ? TRANSPORT_CODES[code] : undefined;
  return { code: transport ?? "dice_failed", retryAfterMs: null };
}

export function diceErrorCode(err: unknown): DiceErrorCode {
  return diceErrorInfo(err).code;
}

/** "Try again in 7s." The create cooldown, worded from the time left. */
export function createCooldownLine(ms: number): string {
  return `You just started a match. Try again in ${Math.max(1, Math.ceil(ms / 1000))}s.`;
}

export function diceErrorMessage(err: unknown): string {
  const { code, retryAfterMs } = diceErrorInfo(err);
  if (retryAfterMs !== null && code === "create_cooldown") return createCooldownLine(retryAfterMs);
  if (retryAfterMs !== null && code === "nudge_cooldown") {
    return `You already nudged. Try again in ${Math.max(1, Math.ceil(retryAfterMs / 60_000))} min.`;
  }
  return DICE_MESSAGES[code];
}

function watch(start: () => Unsubscribe, onError?: (err: unknown) => void): Unsubscribe {
  try {
    return start();
  } catch (err) {
    logger.warn("dice_subscribe_failed", { error: err instanceof Error ? err.message : "unknown" });
    onError?.(err);
    return () => {};
  }
}

export function subscribeToMyDiceGames(
  uid: string,
  onUpdate: (games: DiceGameDoc[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  return watch(() => {
    const db = firebase.requireDb();
    const q = query(
      collection(db, "diceGames"),
      where("playerUids", "array-contains", uid),
      orderBy("updatedAt", "desc"),
      limit(LIST_LIMIT),
    );
    return onSnapshot(
      q,
      (snap) => {
        const games: DiceGameDoc[] = [];
        for (const row of snap.docs) {
          const mapped = toDiceGame(row.id, row.data() as Record<string, unknown>);
          if (mapped) games.push(mapped);
        }
        onUpdate(games);
      },
      (err) => {
        logger.warn("dice_list_failed", { error: err instanceof Error ? err.message : "unknown" });
        onError?.(err);
      },
    );
  }, onError);
}

export function subscribeToDiceGame(
  gameId: string,
  onUpdate: (game: DiceGameDoc | null) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  return watch(() => {
    const db = firebase.requireDb();
    return onSnapshot(
      doc(db, "diceGames", gameId),
      (snap) => {
        if (!snap.exists()) {
          onUpdate(null);
          return;
        }
        onUpdate(toDiceGame(snap.id, snap.data() as Record<string, unknown>));
      },
      (err) => {
        logger.warn("dice_game_failed", { gameId, error: err instanceof Error ? err.message : "unknown" });
        onError?.(err);
      },
    );
  }, onError);
}

export function subscribeToDiceStats(uid: string, onUpdate: (stats: DiceStatsDoc) => void): Unsubscribe {
  return watch(() => {
    const db = firebase.requireDb();
    return onSnapshot(
      doc(db, "diceStats", uid),
      (snap) => {
        onUpdate(toDiceStats(snap.exists() ? (snap.data() as Record<string, unknown>) : undefined));
      },
      (err) => {
        logger.warn("dice_stats_failed", { error: err instanceof Error ? err.message : "unknown" });
        onUpdate(toDiceStats(undefined));
      },
    );
  });
}

function isCallResult(value: unknown): value is DiceCallResult {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.gameId === "string" && typeof row.status === "string";
}

async function callDice(action: string, extra: Record<string, unknown>): Promise<DiceCallResult> {
  addBreadcrumb({ category: "dice", message: action });
  try {
    if (!getNetworkSnapshot()) throw new Error("offline");
    await firebase.ensureAppCheck();
    const [{ getFunctions, httpsCallable, connectFunctionsEmulator }, app] = await Promise.all([
      import("firebase/functions"),
      Promise.resolve(firebase.default),
    ]);
    if (!app) throw new Error("Firebase not initialized");
    const fns = getFunctions(app, "us-central1");
    if (firebase.isEmulatorMode) connectFunctionsEmulator(fns, "127.0.0.1", 5001);
    const callable = httpsCallable(fns, "diceAction");
    const response = await callable({ action, ...extra });
    if (!isCallResult(response.data)) throw new Error("bad response");
    return response.data;
  } catch (err) {
    captureException(err);
    logger.warn("dice_call_failed", { action, code: diceErrorCode(err) });
    throw err;
  }
}

function trackCompletion(result: DiceCallResult): void {
  if (result.status === "active" || result.status === "pending") return;
  trackEvent("dice_game_completed", { gameId: result.gameId, status: result.status });
}

export async function createDiceGame(
  opponentUid: string,
  mode: DiceMode = "clo",
  target?: number,
): Promise<DiceCallResult> {
  const result = await callDice("create", target === undefined ? { opponentUid, mode } : { opponentUid, mode, target });
  trackEvent("dice_challenge_created", { gameId: result.gameId, mode });
  return result;
}

export async function acceptDice(gameId: string): Promise<DiceCallResult> {
  const result = await callDice("accept", { gameId });
  trackEvent("dice_challenge_accepted", { gameId });
  return result;
}

/** Roll. In 10,000, `keep` lists the die indexes set aside before the next throw. */
export async function rollDice(gameId: string, keep: number[] = []): Promise<DiceCallResult> {
  const result = await callDice("roll", keep.length > 0 ? { gameId, keep } : { gameId });
  trackEvent("dice_rolled", { gameId: result.gameId });
  trackCompletion(result);
  return result;
}

/** 10,000 only: set aside `keep` and bank the turn. */
export async function bankDice(gameId: string, keep: number[]): Promise<DiceCallResult> {
  const result = await callDice("bank", { gameId, keep });
  trackEvent("dice_banked", { gameId });
  trackCompletion(result);
  return result;
}

export function nudgeDice(gameId: string): Promise<DiceCallResult> {
  return callDice("nudge", { gameId });
}

export async function rematchDice(gameId: string): Promise<DiceCallResult> {
  const result = await callDice("rematch", { gameId });
  trackEvent("dice_rematch", { gameId: result.gameId });
  return result;
}

export async function quitDice(gameId: string): Promise<DiceCallResult> {
  const result = await callDice("quit", { gameId });
  trackCompletion(result);
  return result;
}

export async function declineDice(gameId: string): Promise<DiceCallResult> {
  const result = await callDice("decline", { gameId });
  trackCompletion(result);
  return result;
}

export async function claimDiceTimeout(gameId: string): Promise<DiceCallResult> {
  const result = await callDice("claimTimeout", { gameId });
  trackCompletion(result);
  return result;
}
