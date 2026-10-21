import type { DiceEndReason, DiceGameDoc, DiceMode, DiceStatus } from "../../services/dice";

export interface ModeCopy {
  name: string;
  dice: number;
  /** One line for pickers and rows. */
  tagline: string;
  /** How a turn works, in order. */
  howTo: string[];
  /** How points are scored. */
  points: string[];
}

export const MODE_COPY: Readonly<Record<DiceMode, ModeCopy>> = {
  clo: {
    name: "C-Lo",
    dice: 3,
    tagline: "Both roll each round. Best hand scores.",
    howTo: [
      "Each round, both of you throw three dice.",
      "No pair and no special hand? Throw again.",
      "A pair sets your point: the odd die. 4-5-6 is the best hand, then trips, then the highest point. 1-2-3 is the worst.",
      "Best hand takes the round. A tie replays it.",
    ],
    points: ["4-5-6: 3 points", "Trips: 2 points", "Winning on a point: 1 point"],
  },
  s456: {
    name: "4-5-6",
    dice: 3,
    tagline: "C-Lo hands, but big hands end the round on the spot.",
    howTo: [
      "Same hands as C-Lo, but faster.",
      "Roll 4-5-6 or trips and you take the round on the spot.",
      "Roll 1-2-3 and you lose it on the spot.",
      "A point still has to be beaten by the other skater.",
    ],
    points: ["4-5-6: 3 points", "Trips: 2 points", "Winning on a point: 1 point", "Their 1-2-3: 1 point to you"],
  },
  craps: {
    name: "Craps",
    dice: 2,
    tagline: "Take turns shooting. Hit your point before a 7.",
    howTo: [
      "You take turns shooting two dice. One hand each, then the dice pass.",
      "Come-out roll: 7 or 11 is a natural. 2, 3 or 12 is craps and ends your hand.",
      "Anything else is your point. Keep rolling: hit it again before a 7.",
      "If you reach the target first, the other skater still gets their hand.",
    ],
    points: ["Natural 7 or 11: 1 point", "Making your point: 2 points", "Making a hard 4 or 10: 3 points"],
  },
  ten: {
    name: "10,000",
    dice: 6,
    tagline: "Push your luck with six dice. Bank before you farkle.",
    howTo: [
      "Throw six dice. Set aside at least one scoring die.",
      "Roll the rest to add more, or bank what you have.",
      "A roll with nothing that scores is a farkle: you lose that turn's points.",
      "Score with all six and you get hot dice: roll all six again.",
      "If you reach the target first, the other skater still gets their turn.",
    ],
    points: [
      "Each 1: 100 · each 5: 50",
      "Three of a kind: face × 100 (three 1s: 1,000)",
      "Four, five, six of a kind: ×2, ×4, ×8",
      "1-2-3-4-5-6: 1,500 · three pairs: 1,000",
    ],
  },
};

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function targetLabel(target: number): string {
  return `Race to ${fmt(target)}`;
}

/** "21h left", "45m left", "<1m left". */
export function timeLeft(deadline: number, now: number): string {
  const ms = deadline - now;
  if (ms <= 60_000) return "<1m left";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h left`;
  return `${Math.floor(ms / 60_000)}m left`;
}

export function isOpen(status: DiceStatus): boolean {
  return status === "active" || status === "pending";
}

export function opponentUid(player1Uid: string, player2Uid: string, uid: string): string {
  return player1Uid === uid ? player2Uid : player1Uid;
}

export function opponentName(
  player1Uid: string,
  player1Username: string,
  player2Username: string,
  uid: string,
): string {
  return player1Uid === uid ? player2Username : player1Username;
}

/** Headline for a match that is over, from the viewer's side. */
export function endTitle(game: DiceGameDoc, uid: string): string {
  if (game.status === "declined") return game.player1Uid === uid ? "Challenge declined" : "You passed";
  if (game.status === "expired") return game.endReason === "cancel" ? "Challenge called off" : "Challenge expired";
  return game.winner === uid ? "You won" : "You lost";
}

/** One plain sentence on how the match ended. */
export function endReasonLine(endReason: DiceEndReason | null, won: boolean, name: string): string {
  switch (endReason) {
    case "target":
      return won ? "You reached the target first." : `@${name} reached the target first.`;
    case "timeout":
      return won ? `@${name} ran out of time.` : "Your turn ran out.";
    case "quit":
      return won ? `@${name} left the match.` : "You left the match.";
    case "decline":
      return "No match was played. Records don't change.";
    case "cancel":
      return "No match was played. Records don't change.";
    default:
      return "Nobody rolled in time. Records don't change.";
  }
}
