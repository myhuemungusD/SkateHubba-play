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
