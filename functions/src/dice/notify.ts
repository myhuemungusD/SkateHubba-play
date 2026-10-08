/**
 * In-app copy and push payloads for Roll Dice.
 *
 * The function writes these with the Admin SDK, so the /notifications type
 * allowlist (which is for client creates) does not have to grow. Recipients
 * can still mark the doc read: that rule does not look at the type or at
 * /games.
 */
import type { DiceMatch, RollEffect } from "./engine.js";

export type DiceNoticeType = "dice_challenge" | "dice_turn" | "dice_result";

export interface DiceNotice {
  recipientUid: string;
  senderUid: string;
  type: DiceNoticeType;
  title: string;
  body: string;
  gameId: string;
  /** Firestore document id. Stable so a retried write replaces instead of stacking. */
  dedupeKey: string;
}

const MAX_TITLE = 80;
const MAX_BODY = 200;

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function notice(
  gameId: string,
  dedupe: string,
  senderUid: string,
  recipientUid: string,
  type: DiceNoticeType,
  title: string,
  body: string,
): DiceNotice {
  return {
    gameId,
    dedupeKey: `dice_${gameId}_${dedupe}_${type}_${recipientUid}`,
    senderUid,
    recipientUid,
    type,
    title: clip(title, MAX_TITLE),
    body: clip(body, MAX_BODY),
  };
}

function nameOf(names: Readonly<Record<string, string>>, uid: string): string {
  const name = names[uid];
  return name && name.length > 0 ? name : "Someone";
}

function scoreLine(state: DiceMatch): string {
  const [a, b] = state.seats;
  const left = a ? (state.roundsWon[a] ?? 0) : 0;
  const right = b ? (state.roundsWon[b] ?? 0) : 0;
  return `${left}–${right}`;
}

export function noticesForRoll(
  gameId: string,
  before: DiceMatch,
  after: DiceMatch,
  effect: RollEffect,
  actorUid: string,
  label: string,
  names: Readonly<Record<string, string>>,
): DiceNotice[] {
  const actor = nameOf(names, actorUid);
  switch (effect.type) {
    case "reroll":
      return [];
    case "advance": {
      const firstAsk =
        before.round === 1 && effect.nextUid === before.seats[1] && Object.keys(before.rolls).length === 0;
      return [
        notice(
          gameId,
          String(after.rollCount),
          actorUid,
          effect.nextUid,
          firstAsk ? "dice_challenge" : "dice_turn",
          "Roll Dice",
          `@${actor} rolled ${label} — your roll`,
        ),
      ];
    }
    case "tie":
      return [
        notice(
          gameId,
          String(after.rollCount),
          actorUid,
          effect.nextUid,
          "dice_turn",
          "Roll Dice",
          `Tied on ${label} — roll again`,
        ),
      ];
    case "round": {
      const winner = nameOf(names, effect.roundWinnerUid);
      const score = scoreLine(after);
      const other = after.seats.find((seat) => seat !== effect.nextUid);
      const yours = notice(
        gameId,
        String(after.rollCount),
        actorUid,
        effect.nextUid,
        "dice_turn",
        "Roll Dice",
        `@${winner} took the round with ${label}. ${score}. Your roll.`,
      );
      if (!other || other === effect.nextUid) return [yours];
      return [
        yours,
        notice(
          gameId,
          String(after.rollCount),
          actorUid,
          other,
          "dice_result",
          "Roll Dice",
          `@${winner} took the round. ${score}.`,
        ),
      ];
    }
    default: {
      const unreachable: never = effect;
      return unreachable;
    }
  }
}

export function noticesForEnd(
  gameId: string,
  state: DiceMatch,
  actorUid: string,
  names: Readonly<Record<string, string>>,
): DiceNotice[] {
  if (state.status === "declined") {
    const challenger = state.seats[0];
    if (!challenger) return [];
    return [
      notice(gameId, "end", actorUid, challenger, "dice_result", "Roll Dice", `@${nameOf(names, actorUid)} declined.`),
    ];
  }
  if (state.status !== "forfeit" || !state.winner) return [];
  const loser = state.seats.find((seat) => seat !== state.winner);
  if (!loser) return [];
  const timedOut = state.endReason === "timeout";
  const winnerBody = timedOut ? "Their turn expired. You got the win." : "You got the win.";
  const loserBody = timedOut ? "Your turn expired." : "You left the match.";
  return [
    notice(gameId, "end", actorUid, state.winner, "dice_result", "Roll Dice", winnerBody),
    notice(gameId, "end", actorUid, loser, "dice_result", "Roll Dice", loserBody),
  ];
}
