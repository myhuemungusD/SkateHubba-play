/**
 * Which devices may get a Roll Dice push.
 *
 * WHY: dice is turned off in the iOS build (VITE_FEATURE_DICE_ENABLED=false in
 * ios-release.yml) and stays on for the web. A web player can still challenge
 * someone whose only device is an iPhone, and that push would advertise a
 * feature the iPhone app does not have (App Store guideline 2.3.1).
 *
 * Each token in pushTargets/{uid}.tokens is tagged in
 * pushTargets/{uid}.platforms[token] ("ios" | "android" | "web") by the client
 * when it registers (src/services/pushPlatform.ts). Dice pushes go only to
 * tokens tagged with a platform in DICE_PUSH_PLATFORMS. A token with no tag
 * was registered by an older build, and most of those are iPhones, so it is
 * treated as iOS: no dice push (fail closed). Every other push is unchanged.
 *
 * When dice ships on iOS, add "ios" here.
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
