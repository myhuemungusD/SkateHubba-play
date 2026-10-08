import type { DiceEndReason, DiceStatus } from "../../services/dice";

/** Banner copy for a match that is no longer being played. */
export function diceEndLine(
  status: DiceStatus,
  endReason: DiceEndReason | null,
  winner: string | null,
  uid: string,
): string | null {
  switch (status) {
    case "active":
      return null;
    case "declined":
      return "They declined";
    case "expired":
      return "The match ended";
    case "forfeit":
      if (winner === uid) {
        return endReason === "timeout" ? "Their turn expired. You got the win." : "You got the win";
      }
      return endReason === "timeout" ? "Your turn expired." : "You left the match";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
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
