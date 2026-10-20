import type { DiceCallResult, DiceGameDoc, DiceRollView } from "../../services/dice";
import { cloLabel, tenLiveDice, tenSelection } from "./diceRules";
import { MODE_COPY, fmt, opponentName, opponentUid } from "./diceCopy";
import type { ScoreSide } from "../../components/dice/Scoreboard";

/** A roll the server answered before the snapshot caught up. */
export interface LocalRoll {
  /** The lastRoll id the doc had when we called; the local roll shows until it changes. */
  base: string | null;
  roll: DiceRollView;
}

export function localFromResult(result: DiceCallResult, uid: string, base: string | null): LocalRoll | null {
  if (!result.dice || !result.rollId) return null;
  return {
    base,
    roll: {
      uid,
      dice: result.dice,
      outcome: result.outcome ?? "",
      label: result.label ?? "",
      callout: result.callout,
      rollId: result.rollId,
      at: Date.now(),
    },
  };
}

/** The roll to show: ours from the callable while the snapshot is behind, else the doc's. */
export function shownRoll(game: DiceGameDoc, local: LocalRoll | null): DiceRollView | null {
  const docId = game.lastRoll?.rollId ?? null;
  if (local && local.base === docId && local.roll.rollId !== docId) return local.roll;
  return game.lastRoll;
}

export function diceCount(game: DiceGameDoc): number {
  if (game.mode === "ten") return 6 - game.ten.kept.length;
  return MODE_COPY[game.mode].dice;
}

export function sideOf(game: DiceGameDoc, uid: string, viewer: string): ScoreSide {
  const isYou = uid === viewer;
  const name = isYou
    ? uid === game.player1Uid
      ? game.player1Username
      : game.player2Username
    : opponentName(game.player1Uid, game.player1Username, game.player2Username, viewer);
  const toMove = game.status === "active" && game.currentTurn === uid;
  const dice = game.results[uid];
  const hand = (game.mode === "clo" || game.mode === "s456") && dice ? { dice, label: cloLabel(dice) } : null;
  let note: string | null = null;
  if (toMove && game.mode === "ten" && game.ten.turnScore > 0) note = `${fmt(game.ten.turnScore)} on the line`;
  if (toMove && game.mode === "craps" && game.point !== null) note = `Shooting for ${game.point}`;
  return { uid, name, isYou, score: game.scores[uid] ?? 0, toMove, hand, note };
}

export interface TenPlan {
  /** Indexes into ten.rolled. */
  keep: number[];
  live: Set<number>;
  valid: boolean;
  /** Turn total if banked now with this keep. */
  bankTotal: number;
  /** Dice the next roll would throw. */
  nextCount: number;
}

export function tenPlan(game: DiceGameDoc, keep: readonly number[]): TenPlan {
  const { score, valid } = tenSelection(game.ten.rolled, keep);
  const kept = game.ten.kept.length + keep.length;
  return {
    keep: [...keep],
    live: tenLiveDice(game.ten.rolled),
    valid,
    bankTotal: game.ten.turnScore + (valid ? score : 0),
    nextCount: kept >= 6 ? 6 : 6 - kept,
  };
}

/** Screen-reader line for a landed roll. */
export function rollAnnouncement(game: DiceGameDoc, roll: DiceRollView, viewer: string): string {
  const who =
    roll.uid === viewer
      ? "You"
      : `@${opponentName(game.player1Uid, game.player1Username, game.player2Username, viewer)}`;
  const you = game.scores[viewer] ?? 0;
  const them = game.scores[opponentUid(game.player1Uid, game.player2Uid, viewer)] ?? 0;
  return `${who} rolled ${roll.dice.join(", ")}. ${roll.label}. Score ${fmt(you)} to ${fmt(them)}.`;
}

/** Whether a landed roll deserves the big or bail cue. */
export function cueFor(roll: DiceRollView): "big" | "bail" | "settle" {
  if (roll.callout === "Bail") return "bail";
  if (roll.callout) return "big";
  if (roll.outcome === "made" || roll.outcome === "natural") return "big";
  return "settle";
}
