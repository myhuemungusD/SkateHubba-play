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

export type DiceStatus = "active" | "forfeit" | "declined" | "expired";
export type DiceEndReason = "quit" | "timeout" | "decline";

export interface DiceRollView {
  uid: string;
  dice: number[];
  outcome: string;
  label: string;
}

export interface DiceGameDoc {
  id: string;
  player1Uid: string;
  player2Uid: string;
  player1Username: string;
  player2Username: string;
  status: DiceStatus;
  currentTurn: string | null;
  round: number;
  roundsWon: Record<string, number>;
  rollCount: number;
  winner: string | null;
  endReason: DiceEndReason | null;
  updatedAt: number;
  turnDeadline: number;
  lastRoll: DiceRollView | null;
}

export interface DiceStatsDoc {
  wins: number;
  losses: number;
  gamesPlayed: number;
}

export interface DiceCallResult {
  gameId: string;
  status: string;
  label: string | null;
  currentTurn: string | null;
  roundsWon: Record<string, number>;
  winner: string | null;
  applied: boolean;
}

const LIST_LIMIT = 20;

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

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function isStatus(value: unknown): value is DiceStatus {
  return value === "active" || value === "forfeit" || value === "declined" || value === "expired";
}

function isEndReason(value: unknown): value is DiceEndReason {
  return value === "quit" || value === "timeout" || value === "decline";
}

function roundsOf(raw: unknown, p1: string, p2: string): Record<string, number> {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { [p1]: finite(record[p1], 0), [p2]: finite(record[p2], 0) };
}

function lastRollOf(raw: unknown): DiceRollView | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const dice = row.dice;
  if (!Array.isArray(dice) || dice.length !== 3 || dice.some((face) => typeof face !== "number")) return null;
  return {
    uid: text(row.uid, ""),
    dice: dice as number[],
    outcome: text(row.outcome, ""),
    label: text(row.label, ""),
  };
}

/** Map a diceGames document. Returns null when the shape is not a match. */
export function toDiceGame(id: string, raw: Record<string, unknown> | undefined): DiceGameDoc | null {
  if (!raw) return null;
  const player1Uid = raw.player1Uid;
  const player2Uid = raw.player2Uid;
  if (typeof player1Uid !== "string" || player1Uid.length === 0) return null;
  if (typeof player2Uid !== "string" || player2Uid.length === 0) return null;
  if (!isStatus(raw.status)) return null;
  const turn = raw.currentTurn;
  return {
    id,
    player1Uid,
    player2Uid,
    player1Username: text(raw.player1Username, ""),
    player2Username: text(raw.player2Username, ""),
    status: raw.status,
    currentTurn: typeof turn === "string" ? turn : null,
    round: finite(raw.round, 1),
    roundsWon: roundsOf(raw.roundsWon, player1Uid, player2Uid),
    rollCount: finite(raw.rollCount, 0),
    winner: typeof raw.winner === "string" ? raw.winner : null,
    endReason: isEndReason(raw.endReason) ? raw.endReason : null,
    updatedAt: finite(raw.updatedAt, 0),
    turnDeadline: finite(raw.turnDeadline, 0),
    lastRoll: lastRollOf(raw.lastRoll),
  };
}

export function toDiceStats(raw: Record<string, unknown> | undefined): DiceStatsDoc {
  return {
    wins: finite(raw?.wins, 0),
    losses: finite(raw?.losses, 0),
    gamesPlayed: finite(raw?.gamesPlayed, 0),
  };
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

async function callDice(action: string, extra: Record<string, string>): Promise<DiceCallResult> {
  addBreadcrumb({ category: "dice", message: action });
  try {
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
  if (result.status === "active") return;
  trackEvent("dice_game_completed", { gameId: result.gameId, status: result.status });
}

export async function createDiceGame(opponentUid: string): Promise<DiceCallResult> {
  const result = await callDice("create", { opponentUid });
  trackEvent("dice_challenge_created", { gameId: result.gameId });
  return result;
}

export async function rollDice(gameId: string): Promise<DiceCallResult> {
  const result = await callDice("roll", { gameId });
  trackEvent("dice_rolled", { gameId: result.gameId });
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
