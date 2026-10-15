import { isPushSupported, type NativePushPermission } from "../../services/pushNotifications";

export type PushState = "unsupported" | "default" | "granted" | "denied";

/** Permission values the Notifications API spec defines. Anything outside
 *  this set (a future expansion, a non-standard browser, a misconfigured
 *  polyfill) degrades to "unsupported" rather than flowing a bogus string
 *  through the UI branches below. */
export const KNOWN_PUSH_STATES: ReadonlySet<string> = new Set<PushState>(["default", "granted", "denied"]);

/** Map the native plugin's tri-state onto the UI's four-state union. */
export function fromNativePermission(permission: NativePushPermission): PushState {
  return permission === "prompt" ? "default" : permission;
}

/**
 * OS-level push permission for this runtime.
 *
 * On a Capacitor shell `Notification.permission` describes the WebView, not the
 * OS grant, so it's meaningless here — and the real grant can only be read
 * asynchronously (`getNativePushPermission`). Native therefore starts at
 * "default" (prompt-able, the harmless default) and the mount effect below
 * corrects it. It must never start at "unsupported": that card tells a native
 * user to switch browsers.
 */
export function readPushState(): PushState {
  if (isPushSupported()) return "default";
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  const perm: unknown = Notification.permission;
  if (typeof perm !== "string" || !KNOWN_PUSH_STATES.has(perm)) return "unsupported";
  return perm as PushState;
}
