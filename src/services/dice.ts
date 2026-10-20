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
] as const;

const DICE_MESSAGES: Record<(typeof DICE_CODES)[number], string> = {
  unauthenticated: "Sign in to roll.",
  dice_disabled: "Roll Dice is turned off.",
  email_unverified: "Verify your email first.",
  self_challenge: "You can't roll against yourself.",
  not_found: "That match is gone.",
  banned: "That challenge isn't available.",
  blocked: "That challenge isn't available.",
  slow_down: "Give it a second.",
  too_many_active: "You already have 10 open dice matches.",
  not_your_turn: "Wait for their roll.",
  game_over: "This match is already over.",
  not_a_player: "You're not in this match.",
  not_declinable: "This match can't be declined.",
  bad_dice: "That roll didn't count. Try again.",
  bad_doc: "That match is unreadable.",
  bad_request: "That didn't work. Try again.",
  dice_failed: "That didn't work. Try again.",
  not_pending: "That challenge was already answered.",
  not_acceptable: "Only the skater you challenged can accept.",
  bad_keep: "Set aside only dice that score.",
  bad_mode: "Pick a game and a length.",
  wrong_mode: "That move isn't part of this game.",
  still_playing: "Finish this match first.",
  your_turn: "It's your roll.",
  nudge_cooldown: "You can nudge again in a bit.",
  offline: "You're offline. Reconnect to roll.",
};

function isDiceCode(value: string): value is (typeof DICE_CODES)[number] {
  return (DICE_CODES as readonly string[]).includes(value);
}

export function diceErrorCode(err: unknown): (typeof DICE_CODES)[number] {
  if (!(err instanceof Error) || !isDiceCode(err.message)) return "dice_failed";
  return err.message;
}

export function diceErrorMessage(err: unknown): string {
  return DICE_MESSAGES[diceErrorCode(err)];
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
