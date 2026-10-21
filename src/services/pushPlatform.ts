/**
 * Platform tag for each push token in the /pushTargets/{uid} mirror.
 *
 * WHY: Roll Dice is off in the iOS build and on for the web. The server only
 * sends a dice push to tokens tagged "android" or "web"
 * (functions/src/push/platforms.ts), so a web challenge never buzzes an
 * iPhone about a feature its app does not have (App Store guideline 2.3.1).
 * Tokens are plain strings in `tokens`, so the tag lives beside them in a
 * `platforms` map keyed by token. A token with no tag (written by an older
 * build) is treated as iOS for dice; every other push ignores the tag.
 *
 * Stale tags: older builds (and a prune that only arrayRemoves) can leave keys
 * in `platforms` for tokens that are gone. Every tag write therefore drops
 * tags whose token is not in the list we are keeping, so the map cannot grow
 * past the token list and lock the owner out of further push writes.
 */
import { Capacitor } from "@capacitor/core";
import { deleteField, type FieldValue } from "firebase/firestore";

export type PushPlatform = "ios" | "android" | "web";

/** The platform this device registers its token as. Anything that is not native iOS or Android is web. */
export function currentPushPlatform(): PushPlatform {
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android" ? platform : "web";
}

/**
 * Mirror fields that tag `token` and drop tags for any token no longer in
 * `keptTokens` (the list after this write, including `token`). Merge alongside
 * `arrayUnion(token)`.
 */
export function tagToken(
  token: string,
  keptTokens: readonly string[],
  existingPlatforms: Readonly<Record<string, unknown>> = {},
): { platforms: Record<string, PushPlatform | FieldValue> } {
  const keep = new Set(keptTokens.includes(token) ? keptTokens : [...keptTokens, token]);
  const platforms: Record<string, PushPlatform | FieldValue> = { [token]: currentPushPlatform() };
  for (const key of Object.keys(existingPlatforms)) {
    if (!keep.has(key)) platforms[key] = deleteField();
  }
  return { platforms };
}

/**
 * `tagToken` driven by the current mirror doc data (`snap.data()`), tolerating
 * a missing doc or malformed `tokens` / `platforms` fields.
 */
export function tagFromMirror(
  token: string,
  mirror: Readonly<Record<string, unknown>> | undefined,
): { platforms: Record<string, PushPlatform | FieldValue> } {
  const data = mirror ?? {};
  const tokens = Array.isArray(data.tokens) ? data.tokens.filter((t): t is string => typeof t === "string") : [];
  const platforms =
    data.platforms && typeof data.platforms === "object" && !Array.isArray(data.platforms)
      ? (data.platforms as Record<string, unknown>)
      : {};
  return tagToken(token, tokens, platforms);
}

/** Mirror fields that drop `token`'s tag. Merge alongside `arrayRemove(token)`. */
export function untagToken(token: string): { platforms: Record<string, FieldValue> } {
  return { platforms: { [token]: deleteField() } };
}

/** Mirror field that drops every tag, for when the token list is emptied. */
export function untagAll(): { platforms: FieldValue } {
  return { platforms: deleteField() };
}
