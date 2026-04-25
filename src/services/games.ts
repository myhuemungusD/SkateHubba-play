/**
 * Barrel re-export for the games service. Implementation lives in:
 *   - games.mappers.ts        — types + DTO mapping
 *   - games.turns.ts          — turn primitives + forfeitExpiredTurn
 *   - games.create.ts         — create game + judge invite lifecycle
 *   - games.match.ts          — set / fail-set / submit match attempt
 *   - games.judge.ts          — call BS, judge rulings, dispute resolution
 *   - games.subscriptions.ts  — read-side APIs
 */

export type { GameStatus, GamePhase, JudgeStatus, TurnRecord, GameDoc, CreateGameOptions } from "./games.mappers";
export { timestampFromMillis, isJudgeActive } from "./games.mappers";

export { forfeitExpiredTurn, _resetCreateGameRateLimit, _turnActionMapSize } from "./games.turns";

export { createGame, acceptJudgeInvite, declineJudgeInvite } from "./games.create";

export { setTrick, failSetTrick, submitMatchAttempt } from "./games.match";

export { callBSOnSetTrick, judgeRuleSetTrick, resolveDispute } from "./games.judge";

export { fetchPlayerCompletedGames, subscribeToMyGames, subscribeToGame } from "./games.subscriptions";
