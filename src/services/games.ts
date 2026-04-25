/**
 * Barrel re-export for the games service. Implementation lives in:
 *   - games.mappers.ts        — types + DTO mapping
 *   - games.turns.ts          — turn primitives + forfeitExpiredTurn
 *   - games.commands.ts       — user-invoked write actions
 *   - games.subscriptions.ts  — read-side APIs
 */

export type { GameStatus, GamePhase, JudgeStatus, TurnRecord, GameDoc, CreateGameOptions } from "./games.mappers";
export { timestampFromMillis, isJudgeActive } from "./games.mappers";

export { forfeitExpiredTurn, _resetCreateGameRateLimit, _turnActionMapSize } from "./games.turns";

export {
  createGame,
  acceptJudgeInvite,
  declineJudgeInvite,
  setTrick,
  failSetTrick,
  submitMatchAttempt,
  callBSOnSetTrick,
  judgeRuleSetTrick,
  resolveDispute,
} from "./games.commands";

export { fetchPlayerCompletedGames, subscribeToMyGames, subscribeToGame } from "./games.subscriptions";
