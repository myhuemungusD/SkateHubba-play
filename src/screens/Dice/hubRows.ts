import type { DiceGameDoc } from "../../services/dice";
import type { MatchRowProps } from "../../components/dice/MatchRow";
import { MODE_COPY, fmt, opponentName, opponentUid, targetLabel, timeLeft } from "./diceCopy";

export type HubSection = "move" | "wait" | "done";

export function sectionOf(game: DiceGameDoc, uid: string): HubSection {
  if (game.status === "pending") return game.player2Uid === uid ? "move" : "wait";
  if (game.status === "active") return game.currentTurn === uid ? "move" : "wait";
  return "done";
}

function repLine(game: DiceGameDoc, uid: string): string {
  const delta = game.repChange?.[uid];
  if (typeof delta !== "number") return "";
  return ` · ${delta >= 0 ? "+" : "−"}${Math.abs(delta)} Rep`;
}

/** Everything a hub row shows, in plain words. */
export function rowOf(game: DiceGameDoc, uid: string, now: number): Omit<MatchRowProps, "onOpen"> {
  const name = opponentName(game.player1Uid, game.player1Username, game.player2Username, uid) || "skater";
  const meta = `${MODE_COPY[game.mode].name} · ${targetLabel(game.target)}`;
  const you = game.scores[uid] ?? 0;
  const them = game.scores[opponentUid(game.player1Uid, game.player2Uid, uid)] ?? 0;
  const score =
    game.status === "pending" || game.status === "declined" || game.status === "expired"
      ? null
      : `${fmt(you)} – ${fmt(them)}`;
  const left = timeLeft(game.turnDeadline, now);

  switch (game.status) {
    case "pending":
      return game.player2Uid === uid
        ? { name, meta, score, status: `Challenged you · ${left}`, tone: "act" }
        : { name, meta, score, status: `Waiting for them to accept · ${left}`, tone: "wait" };
    case "active":
      return game.currentTurn === uid
        ? { name, meta, score, status: `Your roll · ${left}`, tone: "act" }
        : { name, meta, score, status: `Their roll · ${left}`, tone: "wait" };
    case "declined":
      return { name, meta, score, status: game.player1Uid === uid ? "Declined" : "You passed", tone: "void" };
    case "expired":
      return { name, meta, score, status: game.endReason === "cancel" ? "Called off" : "Expired", tone: "void" };
    default: {
      const won = game.winner === uid;
      const how = game.status === "forfeit" ? (won ? "Won by forfeit" : "Lost by forfeit") : won ? "Won" : "Lost";
      return { name, meta, score, status: `${how}${repLine(game, uid)}`, tone: won ? "won" : "lost" };
    }
  }
}
