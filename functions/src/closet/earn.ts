/**
 * Earned Bucks and earned items. Never client-triggered for arbitrary
 * amounts: game awards come from the stats close-out trigger, everything
 * else from the admin-only `awardEarn` callable.
 *
 * Caps (plan §5): repeat opponent 3 paid games / day, spot check-ins 3 / day,
 * What's That Trick 20 / day, and a 200 Bucks daily hard cap over all of it.
 * Every award has a deterministic ledger id, so a retry never pays twice.
 */
import {
  DAILY_EARN_CAP,
  EARN_BASE,
  EARN_DAILY_COUNT,
  EARN_EVENTS,
  LEVEL_TIER_MAX,
  PAID_GAMES_PER_OPPONENT,
  WEEKLY_CHALLENGE_MAX,
  WEEKLY_CHALLENGE_MIN,
  type EarnEvent,
} from "./economy.js";
import { applyMint, prepareMint } from "./mint.js";
import { ClosetError, isId, paths, str } from "./model.js";
import type { ClosetDb } from "./store.js";
import { credit, ledgerExists, readLimits, readWallet, writeLimits } from "./wallet.js";

export interface EarnResult {
  awarded: number;
  capped: boolean;
  duplicate: boolean;
}

interface EarnPlan {
  uid: string;
  event: EarnEvent;
  base: number;
  ref: string;
  opponentUid: string | null;
}

async function runEarn(db: ClosetDb, plan: EarnPlan, nowMs: number): Promise<EarnResult> {
  const txId = `earn_${plan.opponentUid !== null ? "game" : plan.event}_${plan.ref}`;
  return db.runTransaction(async (tx) => {
    if (await ledgerExists(tx, plan.uid, txId)) return { awarded: 0, capped: false, duplicate: true };
    if (!(await tx.get(paths.user(plan.uid))).data) throw new ClosetError("not_found");
    if ((await tx.get(paths.ban(plan.uid))).data) throw new ClosetError("banned");
    const limits = await readLimits(tx, plan.uid, nowMs);
    const wallet = await readWallet(tx, plan.uid);

    let amount = plan.base;
    const countCap = EARN_DAILY_COUNT[plan.event];
    const used = limits.earnCounts[plan.event] ?? 0;
    if (countCap !== undefined && used >= countCap) amount = 0;
    const opp = plan.opponentUid;
    if (opp !== null && (limits.oppCounts[opp] ?? 0) >= PAID_GAMES_PER_OPPONENT) amount = 0;
    amount = Math.min(amount, Math.max(0, DAILY_EARN_CAP - limits.earnedToday));

    limits.earnCounts[plan.event] = used + 1;
    if (opp !== null) limits.oppCounts[opp] = (limits.oppCounts[opp] ?? 0) + 1;
    limits.earnedToday += amount;
    writeLimits(tx, plan.uid, limits);
    credit(tx, plan.uid, wallet, amount, "earned", { reason: plan.event, ref: plan.ref }, txId, nowMs);
    return { awarded: amount, capped: amount < plan.base, duplicate: false };
  });
}

export interface EarnInput {
  uid?: unknown;
  event?: unknown;
  ref?: unknown;
  opponentUid?: unknown;
  amount?: unknown;
  tier?: unknown;
}

function intIn(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ClosetError("bad_request");
  }
  return value;
}

/** Validate an award request into a plan. Pure. */
export function planEarn(input: EarnInput): EarnPlan {
  const event = EARN_EVENTS.find((e) => e === input.event);
  if (!event || !isId(input.uid) || !isId(input.ref)) throw new ClosetError("bad_request");
  const isGame = event === "game_finished" || event === "game_won";
  if (isGame && (!isId(input.opponentUid) || input.opponentUid === input.uid)) throw new ClosetError("bad_request");
  let base = EARN_BASE[event];
  if (event === "game_won") base += EARN_BASE.game_finished;
  if (event === "weekly_challenge") base = intIn(input.amount, WEEKLY_CHALLENGE_MIN, WEEKLY_CHALLENGE_MAX);
  if (event === "level_up") base = EARN_BASE.level_up * intIn(input.tier, 1, LEVEL_TIER_MAX);
  return { uid: input.uid, event, base, ref: input.ref, opponentUid: isGame ? str(input.opponentUid) : null };
}

export async function awardEarn(db: ClosetDb, input: EarnInput, nowMs: number): Promise<EarnResult> {
  return runEarn(db, planEarn(input), nowMs);
}

/**
 * Game close-out awards: 10 to each finisher, +15 to the winner, one row
 * per player per game. Empty forfeits (fewer than 2 turns) pay nothing,
 * matching the XP rule.
 */
export async function awardGameEarn(
  db: ClosetDb,
  gameId: string,
  game: Record<string, unknown>,
  nowMs: number,
  allowed: (uid: string) => boolean,
): Promise<EarnResult[]> {
  const p1 = str(game.player1Uid);
  const p2 = str(game.player2Uid);
  const winner = str(game.winner);
  const turns = Array.isArray(game.turnHistory) ? game.turnHistory.length : 0;
  if (!p1 || !p2 || p1 === p2 || (game.status === "forfeit" && turns < 2)) return [];
  const results: EarnResult[] = [];
  for (const [uid, opp] of [
    [p1, p2],
    [p2, p1],
  ] as const) {
    if (!allowed(uid)) continue;
    const event: EarnEvent = uid === winner ? "game_won" : "game_finished";
    results.push(await awardEarn(db, { uid, event, ref: gameId, opponentUid: opp }, nowMs));
  }
  return results;
}

/** Milestone unlock: mint an earn or event item to a skater. Grail grants are excluded. */
export async function grantEarnedItem(
  db: ClosetDb,
  uid: string,
  itemDefId: string,
  reason: string,
  nowMs: number,
): Promise<{ copyId: string; serial: number | null }> {
  return db.runTransaction(async (tx) => {
    if (!(await tx.get(paths.user(uid))).data) throw new ClosetError("not_found");
    const plan = await prepareMint(tx, uid, itemDefId, nowMs);
    const { source, rarity } = plan.def;
    if ((source !== "earn" && source !== "event") || rarity === "grail") throw new ClosetError("not_grantable");
    const minted = applyMint(tx, plan, { reason, dropId: null, nowMs });
    return { copyId: minted.copyId, serial: minted.serial };
  });
}
