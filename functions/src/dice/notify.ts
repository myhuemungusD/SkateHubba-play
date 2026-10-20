/**
 * In-app copy and push payloads for Roll Dice.
 *
 * The function writes these with the Admin SDK, so the /notifications type
 * allowlist (which is for client creates) does not have to grow. Recipients
 * can still mark the doc read: that rule does not look at the type or at
 * /games.
 *
 * Copy rules: say what happened and what to do next, in plain words. Only
 * your-turn moments, challenges and results notify. A throw that keeps the
 * turn (no point, a craps point, 10,000 dice to choose) never does.
 */
import type { DiceMatch } from "./engine.js";
import { MODE_RULES } from "./modes.js";
import type { RollEffect } from "./play.js";

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
const TITLE = "Roll Dice";

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function notice(
  gameId: string,
  dedupe: string,
  senderUid: string,
  recipientUid: string,
  type: DiceNoticeType,
  body: string,
): DiceNotice {
  return {
    gameId,
    dedupeKey: `dice_${gameId}_${dedupe}_${type}_${recipientUid}`,
    senderUid,
    recipientUid,
    type,
    title: clip(TITLE, MAX_TITLE),
    body: clip(body, MAX_BODY),
  };
}

function nameOf(names: Readonly<Record<string, string>>, uid: string): string {
  const name = names[uid];
  return name && name.length > 0 ? name : "Someone";
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** "4–2" from the recipient's side. */
function scoreFor(state: DiceMatch, uid: string): string {
  const other = state.seats.find((seat) => seat !== uid) ?? "";
  return `${fmt(state.scores[uid] ?? 0)}–${fmt(state.scores[other] ?? 0)}`;
}

function plural(points: number): string {
  return points === 1 ? "1 pt" : `${fmt(points)} pts`;
}

export function noticeForChallenge(
  gameId: string,
  state: DiceMatch,
  names: Readonly<Record<string, string>>,
): DiceNotice[] {
  const [from, to] = state.seats;
  if (!from || !to) return [];
  const game = MODE_RULES[state.mode].name;
  return [
    notice(
      gameId,
      "challenge",
      from,
      to,
      "dice_challenge",
      `@${nameOf(names, from)} challenged you to ${game}, race to ${fmt(state.target)}.`,
    ),
  ];
}

export function noticeForAccept(
  gameId: string,
  state: DiceMatch,
  names: Readonly<Record<string, string>>,
): DiceNotice[] {
  const [challenger, opponent] = state.seats;
  if (!challenger || !opponent) return [];
  return [
    notice(gameId, "accept", opponent, challenger, "dice_turn", `@${nameOf(names, opponent)} accepted. Your roll.`),
  ];
}

function finalNotices(
  gameId: string,
  state: DiceMatch,
  actorUid: string,
  names: Readonly<Record<string, string>>,
  rep: Readonly<Record<string, number>>,
): DiceNotice[] {
  const winner = state.winner;
  if (!winner) return [];
  const loser = state.seats.find((seat) => seat !== winner);
  if (!loser) return [];
  const game = MODE_RULES[state.mode].name;
  const repLine = (uid: string): string => {
    const delta = rep[uid];
    if (delta === undefined || delta === 0) return "";
    return delta > 0 ? ` Rep +${delta}.` : ` Rep −${Math.abs(delta)}.`;
  };
  return [
    notice(
      gameId,
      "end",
      actorUid,
      winner,
      "dice_result",
      `You won ${game} ${scoreFor(state, winner)}.${repLine(winner)}`,
    ),
    notice(
      gameId,
      "end",
      actorUid,
      loser,
      "dice_result",
      `@${nameOf(names, winner)} won ${game} ${scoreFor(state, winner)}.${repLine(loser)}`,
    ),
  ];
}

export function noticesForRoll(
  gameId: string,
  after: DiceMatch,
  effect: RollEffect,
  actorUid: string,
  label: string,
  names: Readonly<Record<string, string>>,
  rep: Readonly<Record<string, number>>,
): DiceNotice[] {
  const actor = nameOf(names, actorUid);
  const key = String(after.rollCount);
  if (after.status === "complete") return finalNotices(gameId, after, actorUid, names, rep);
  switch (effect.type) {
    case "again":
      return [];
    case "advance":
      return [notice(gameId, key, actorUid, effect.nextUid, "dice_turn", `@${actor} rolled ${label}. Your roll.`)];
    case "tie":
      return [notice(gameId, key, actorUid, effect.nextUid, "dice_turn", `Tied on ${label}. Roll again.`)];
    case "round": {
      const next = effect.nextUid;
      if (MODE_RULES[after.mode].alternating) {
        // A 10,000 bank already names its points ("Banked 1,050"); don't say it twice.
        const what = effect.points > 0 && after.mode !== "ten" ? `${label} (+${plural(effect.points)})` : label;
        return [
          notice(gameId, key, actorUid, next, "dice_turn", `@${actor}: ${what}. ${scoreFor(after, next)}. Your turn.`),
        ];
      }
      const winner = effect.winnerUid ?? actorUid;
      const other = after.seats.find((seat) => seat !== next);
      const line = `@${nameOf(names, winner)} took the round (+${plural(effect.points)}).`;
      const out = [notice(gameId, key, actorUid, next, "dice_turn", `${line} ${scoreFor(after, next)}. Your roll.`)];
      if (other && other !== actorUid) {
        out.push(notice(gameId, key, actorUid, other, "dice_result", `${line} ${scoreFor(after, other)}.`));
      }
      return out;
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
  rep: Readonly<Record<string, number>>,
): DiceNotice[] {
  const [challenger, opponent] = state.seats;
  if (!challenger || !opponent) return [];
  if (state.status === "declined") {
    return [
      notice(
        gameId,
        "end",
        actorUid,
        challenger,
        "dice_result",
        `@${nameOf(names, actorUid)} passed on your challenge.`,
      ),
    ];
  }
  if (state.status === "expired") {
    if (state.endReason === "cancel") {
      return [
        notice(
          gameId,
          "end",
          actorUid,
          opponent,
          "dice_result",
          `@${nameOf(names, challenger)} called off the challenge.`,
        ),
      ];
    }
    return [notice(gameId, "end", actorUid, challenger, "dice_result", "Your challenge expired before it started.")];
  }
  if (state.status !== "forfeit" || !state.winner) return [];
  const loser = state.seats.find((seat) => seat !== state.winner);
  if (!loser) return [];
  const timedOut = state.endReason === "timeout";
  const repOf = (uid: string): string => {
    const delta = rep[uid];
    if (!delta) return "";
    return delta > 0 ? ` Rep +${delta}.` : ` Rep −${Math.abs(delta)}.`;
  };
  return [
    notice(
      gameId,
      "end",
      actorUid,
      state.winner,
      "dice_result",
      `${timedOut ? `@${nameOf(names, loser)} ran out of time.` : `@${nameOf(names, loser)} left the match.`} You win.${repOf(state.winner)}`,
    ),
    notice(
      gameId,
      "end",
      actorUid,
      loser,
      "dice_result",
      `${timedOut ? "Your turn ran out." : "You left the match."} Counted as a loss.${repOf(loser)}`,
    ),
  ];
}

export function noticeForNudge(
  gameId: string,
  state: DiceMatch,
  actorUid: string,
  nowMs: number,
  names: Readonly<Record<string, string>>,
): DiceNotice[] {
  const target = state.seats[state.current];
  if (!target) return [];
  return [
    notice(
      gameId,
      `nudge${nowMs}`,
      actorUid,
      target,
      "dice_turn",
      `@${nameOf(names, actorUid)} is waiting on your roll.`,
    ),
  ];
}

export function noticeForReminder(
  gameId: string,
  state: DiceMatch,
  deadlineMs: number,
  names: Readonly<Record<string, string>>,
): DiceNotice[] {
  const target = state.seats[state.current];
  if (!target) return [];
  const other = state.seats.find((seat) => seat !== target) ?? target;
  return [
    notice(
      gameId,
      `remind${deadlineMs}`,
      other,
      target,
      "dice_turn",
      `About 3 hours left on your roll vs @${nameOf(names, other)}.`,
    ),
  ];
}
