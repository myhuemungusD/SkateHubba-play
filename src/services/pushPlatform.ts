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
 */
import { Capacitor } from "@capacitor/core";
import { deleteField, type FieldValue } from "firebase/firestore";

export type PushPlatform = "ios" | "android" | "web";

/** The platform this device registers its token as. Anything that is not native iOS or Android is web. */
export function currentPushPlatform(): PushPlatform {
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android" ? platform : "web";
}

/** Mirror fields that tag `token` with this device's platform. Merge alongside `arrayUnion(token)`. */
export function tagToken(token: string): { platforms: Record<string, PushPlatform> } {
  return { platforms: { [token]: currentPushPlatform() } };
}

/** Mirror fields that drop `token`'s tag. Merge alongside `arrayRemove(token)`. */
export function untagToken(token: string): { platforms: Record<string, FieldValue> } {
  return { platforms: { [token]: deleteField() } };
}

/** Mirror field that drops every tag, for when the token list is emptied. */
export function untagAll(): { platforms: FieldValue } {
  return { platforms: deleteField() };
}
