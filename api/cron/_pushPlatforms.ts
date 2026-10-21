/**
 * Dice push platform filter for the Vercel drain courier.
 *
 * Mirrors functions/src/push/platforms.ts (duplicated so Vercel does not import
 * the Cloud Functions package). Keep the two in lockstep: when dice ships on
 * iOS, add "ios" to DICE_PUSH_PLATFORMS in both files.
 */

export type PushPlatform = "ios" | "android" | "web";

export const DICE_PUSH_PLATFORMS: ReadonlySet<PushPlatform> = new Set<PushPlatform>(["android", "web"]);

function platformMap(mirror: Record<string, unknown> | undefined): Record<string, unknown> {
  const raw = mirror?.platforms;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** True when this token's tag allows a dice push. Untagged and unknown tags do not. */
export function tokenAllowsDice(mirror: Record<string, unknown> | undefined, token: string): boolean {
  const tag = platformMap(mirror)[token];
  return typeof tag === "string" && DICE_PUSH_PLATFORMS.has(tag as PushPlatform);
}

/** The subset of `tokens` that may receive a dice push, given the recipient's pushTargets doc. */
export function diceEligibleTokens(mirror: Record<string, unknown> | undefined, tokens: readonly string[]): string[] {
  return tokens.filter((token) => tokenAllowsDice(mirror, token));
}

/** True for a dispatch about Roll Dice (deliverDicePushes stamps data.kind = "dice", types are dice_*). */
export function isDicePush(data: Readonly<Record<string, string>>): boolean {
  return data.kind === "dice" || (typeof data.type === "string" && data.type.startsWith("dice_"));
}
