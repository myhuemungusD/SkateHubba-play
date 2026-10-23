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

/**
 * Tester-only announcements: the iPhone app never shows tester features or the
 * tester banner (isNativeShell gate, App Store 2.3.1), so a "testers" push must
 * not reach an iPhone either. Same rule as dice: android and web only,
 * untagged counts as iOS.
 */
export const TESTER_PUSH_PLATFORMS: ReadonlySet<PushPlatform> = new Set<PushPlatform>(["android", "web"]);

function tokenAllowed(
  mirror: Record<string, unknown> | undefined,
  token: string,
  allowed: ReadonlySet<PushPlatform>,
): boolean {
  const tag = platformMap(mirror)[token];
  return typeof tag === "string" && allowed.has(tag as PushPlatform);
}

/** True when this token's tag allows a dice push. Untagged and unknown tags do not. */
export function tokenAllowsDice(mirror: Record<string, unknown> | undefined, token: string): boolean {
  return tokenAllowed(mirror, token, DICE_PUSH_PLATFORMS);
}

/** The subset of `tokens` that may receive a dice push, given the recipient's pushTargets doc. */
export function diceEligibleTokens(mirror: Record<string, unknown> | undefined, tokens: readonly string[]): string[] {
  return tokens.filter((token) => tokenAllowsDice(mirror, token));
}

/** The subset of `tokens` that may receive a tester-only announcement push. */
export function testerEligibleTokens(mirror: Record<string, unknown> | undefined, tokens: readonly string[]): string[] {
  return tokens.filter((token) => tokenAllowed(mirror, token, TESTER_PUSH_PLATFORMS));
}

/** True for a dispatch about Roll Dice (deliverDicePushes stamps data.kind = "dice", types are dice_*). */
export function isDicePush(data: Readonly<Record<string, string>>): boolean {
  return data.kind === "dice" || (typeof data.type === "string" && data.type.startsWith("dice_"));
}

/** Max tokens one dispatch fans out to. Matches the <=10 cap on pushTargets.tokens. */
export const MAX_TOKENS_PER_DISPATCH = 10;

/**
 * The recipient's deliverable tokens from their pushTargets doc: non-empty
 * strings, de-duplicated, capped at MAX_TOKENS_PER_DISPATCH. The couriers use
 * it when a /push_dispatch doc names no tokens, so a sender never needs to see
 * the recipient's device tokens (security audit 2026-10-21, M1).
 */
export function mirrorTokens(mirror: Record<string, unknown> | undefined): string[] {
  const raw = mirror?.tokens;
  if (!Array.isArray(raw)) return [];
  const clean = raw.filter((t): t is string => typeof t === "string" && t.length > 0);
  return Array.from(new Set(clean)).slice(0, MAX_TOKENS_PER_DISPATCH);
}
