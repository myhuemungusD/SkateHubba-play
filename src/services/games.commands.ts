/**
 * Barrel re-export for game write commands. Implementation is split by
 * domain under `games/commands/`:
 *   - lifecycle.ts  — createGame
 *   - judge.ts      — acceptJudgeInvite, declineJudgeInvite, judgeRuleSetTrick
 *   - setTrick.ts   — setTrick, failSetTrick, callBSOnSetTrick
 *   - match.ts      — submitMatchAttempt
 *   - dispute.ts    — resolveDispute
 *
 * The public API remains unchanged: every symbol previously exported from
 * this file is re-exported here with identical signatures and behavior.
 */

export { createGame } from "./games/commands/lifecycle";
export { acceptJudgeInvite, declineJudgeInvite, judgeRuleSetTrick } from "./games/commands/judge";
export { setTrick, failSetTrick, callBSOnSetTrick } from "./games/commands/setTrick";
export { submitMatchAttempt } from "./games/commands/match";
export { resolveDispute } from "./games/commands/dispute";
