/**
 * Server kill switches and account eligibility for the closet.
 *
 * Every flag defaults off. Testers (CLOSET_TESTER_UIDS) can use every closet
 * feature while the flags are off; everyone else needs CLOSET_ENABLED plus
 * the feature's own flag. The client flag only hides UI, so this is the gate.
 */
import { diceAccessAllowed } from "../dice/access.js";
import { DROP_MIN_ACCOUNT_DAYS, DROP_MIN_GAMES, TRADE_MIN_ACCOUNT_DAYS, TRADE_MIN_GAMES } from "./economy.js";
import { ClosetError, DAY_MS, num, paths, toMillis, type ClosetActor } from "./model.js";
import type { ClosetTx } from "./store.js";

export type ClosetFeature = "closet" | "drops" | "trading" | "bucksPurchase";

export interface ClosetFlags {
  enabled: boolean;
  drops: boolean;
  trading: boolean;
  bucksPurchase: boolean;
  testers: string;
}

export const CLOSET_FLAGS_OFF: ClosetFlags = {
  enabled: false,
  drops: false,
  trading: false,
  bucksPurchase: false,
  testers: "",
};

function featureOn(flags: ClosetFlags, feature: ClosetFeature): boolean {
  if (!flags.enabled) return false;
  switch (feature) {
    case "closet":
      return true;
    case "drops":
      return flags.drops;
    case "trading":
      return flags.trading;
    case "bucksPurchase":
      return flags.bucksPurchase;
    default: {
      const unknown: never = feature;
      throw new Error(`unknown closet feature: ${String(unknown)}`);
    }
  }
}

export function closetAllowed(uid: string, flags: ClosetFlags, feature: ClosetFeature): boolean {
  return diceAccessAllowed(uid, featureOn(flags, feature), flags.testers);
}

interface AccountRule {
  minAccountDays: number;
  minGames: number;
}

export const DROP_RULE: AccountRule = { minAccountDays: DROP_MIN_ACCOUNT_DAYS, minGames: DROP_MIN_GAMES };
export const TRADE_RULE: AccountRule = { minAccountDays: TRADE_MIN_ACCOUNT_DAYS, minGames: TRADE_MIN_GAMES };

/**
 * Read the profile and ban record and check account age and games played.
 * Returns the profile so callers do not read it twice. Reads only.
 */
export async function assertAccount(
  tx: ClosetTx,
  uid: string,
  nowMs: number,
  rule: AccountRule,
): Promise<Record<string, unknown>> {
  const user = await tx.get(paths.user(uid));
  if (!user.data) throw new ClosetError("not_found");
  const ban = await tx.get(paths.ban(uid));
  if (ban.data) throw new ClosetError("banned");
  const created = toMillis(user.data.createdAt);
  if (created === null || nowMs - created < rule.minAccountDays * DAY_MS) {
    throw new ClosetError("account_too_new");
  }
  if (num(user.data.gamesPlayed) < rule.minGames) throw new ClosetError("not_enough_games");
  return user.data;
}

/** 2-step on, or a Google / Apple sign-in, plus a verified email (plan §6). */
export function assertTradeSecurity(actor: ClosetActor): void {
  if (!actor.emailVerified) throw new ClosetError("email_unverified");
  const strongProvider = actor.provider === "google.com" || actor.provider === "apple.com";
  if (!actor.secondFactor && !strongProvider) throw new ClosetError("two_step_required");
}
