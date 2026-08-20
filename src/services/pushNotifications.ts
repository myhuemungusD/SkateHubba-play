/**
 * Native push notification service (iOS + Android via Capacitor).
 *
 * Complements src/services/fcm.ts (web push via Firebase Messaging SDK +
 * firebase-messaging-sw.js). On native, Firebase Messaging's web SDK can't
 * subscribe to APNS/FCM at the OS level — we go through the native
 * `@capacitor/push-notifications` plugin which returns the platform token
 * (FCM on Android, APNS on iOS — the FCM backend accepts both when the app
 * is configured with the matching APNS auth key).
 *
 * The token is stored on the same owner-only private profile subcollection
 * the web flow uses (users/{uid}/private/profile.fcmTokens) so server-side
 * push dispatch doesn't need to know which platform a device came from.
 * Rules cap the list at ≤10 entries — same surface as the web flow.
 *
 * This is the ONLY file allowed to import @capacitor/push-notifications
 * (services-layer rule from CLAUDE.md). Components call the exported
 * helpers; they never touch the native plugin directly.
 *
 * iOS setup (document here — cannot be set from this file):
 *  - Info.plist: UIBackgroundModes = ["remote-notification"]
 *  - Xcode project → Signing & Capabilities → + Push Notifications
 *    (adds the `aps-environment` entitlement; production/development value
 *    is set per build configuration by Xcode).
 *  - Upload an APNS auth key to Firebase Console → Project Settings →
 *    Cloud Messaging so the FCM backend can mint APNS pushes.
 *
 * Android setup:
 *  - POST_NOTIFICATIONS permission in AndroidManifest.xml (Android 13+).
 *  - google-services.json in android/app/ (required for FCM registration).
 */

import { Capacitor } from "@capacitor/core";
import { PushNotifications, type Token } from "@capacitor/push-notifications";
import { doc, setDoc, arrayUnion, arrayRemove, serverTimestamp } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { PRIVATE_PROFILE_DOC_ID, getPushEnabled } from "./users";
import { PUSH_TARGETS_COLLECTION } from "./pushDispatch";

/**
 * Token captured on the most recent successful registration. Cached so
 * {@link unregisterPushToken} can scrub exactly THIS device's token on
 * sign-out without racing other devices the user has registered.
 */
let activePushToken: string | null = null;

/** @internal Reset the cached active token (for tests only). */
export function _resetActivePushToken(): void {
  activePushToken = null;
}

/**
 * True when the runtime is a Capacitor native shell AND a Firebase project
 * is configured (FCM registration requires the project's google-services.json
 * / GoogleService-Info.plist — absent in pure web builds).
 *
 * Callers gate registration on this so web users never hit the plugin,
 * which would throw "unimplemented" in the browser.
 */
export function isPushSupported(): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  // VITE_FIREBASE_PROJECT_ID is required by firebase.ts to init the app; if
  // it's missing we're in a misconfigured build and the backend can't route
  // pushes anyway. Guard here so the plugin register() doesn't dangle.
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  return typeof projectId === "string" && projectId.length > 0;
}

/** The tight three-value contract this module exposes to the UI layer. */
export type NativePushPermission = "granted" | "denied" | "prompt";

/**
 * Collapse the plugin's PermissionState — "granted" | "denied" | "prompt" |
 * "prompt-with-rationale" — into the three values consumers branch on. The
 * rationale variant folds into "prompt": from the UI's point of view it is
 * still "we have not been told yes or no yet".
 */
function toPermissionState(receive: string): NativePushPermission {
  if (receive === "granted") return "granted";
  if (receive === "denied") return "denied";
  return "prompt";
}

/**
 * Prompt the OS for push notification permission. On Android 12 and below
 * this is always granted at install time; on Android 13+ and iOS it shows
 * the system dialog. Returns the resulting permission state — the caller
 * decides whether to proceed to {@link registerPushToken}.
 */
export async function requestPushPermission(): Promise<NativePushPermission> {
  const status = await PushNotifications.requestPermissions();
  return toPermissionState(status.receive);
}

/**
 * Read the CURRENT native permission state without ever prompting.
 *
 * `checkPermissions()` is a pure query — it never raises the OS dialog — which
 * is what makes this safe to call from a render path. Exists because the UI
 * could not previously tell "already granted" from "never asked" on native, so
 * a user who had granted permission still saw a phantom "Turn on notifications"
 * card forever.
 *
 * Fails soft to "prompt": on web (no plugin) and on any plugin throw, the
 * honest answer is "we don't know", and "prompt" is the state whose UI
 * (offering the opt-in) is harmless in either direction. It must NOT report
 * "granted" on a failed read — that would hide the opt-in from a user who
 * genuinely needs it.
 */
export async function getNativePushPermission(): Promise<NativePushPermission> {
  if (!isPushSupported()) return "prompt";
  try {
    const status = await PushNotifications.checkPermissions();
    return toPermissionState(status.receive);
  } catch (err) {
    logger.warn("push_permission_check_failed", { error: parseFirebaseError(err) });
    return "prompt";
  }
}

/**
 * Request permission, call register(), and store the FCM/APNS token on
 * the user's private profile doc so the push backend can target this
 * device. No-ops (with a warn log) when the OS denies permission — we do
 * NOT throw, because this is called from the post-login flow and must
 * never block sign-in.
 *
 * Writes go to users/{uid}/private/profile — same path the web flow
 * (src/services/fcm.ts) uses. firestore.rules caps the fcmTokens array at
 * 10 entries so a single user can't exhaust the push-dispatch fan-out.
 */
export interface RegisterPushTokenOptions {
  /**
   * Skip the server-side `pushEnabled` re-read.
   *
   * The opt-out check exists to stop the SILENT refresh path from resurrecting
   * push for a user who turned it off in Settings. On the explicit "turn on
   * notifications" path the user's intent is unambiguous and re-reading the
   * flag is a pure race: if the caller flipped the toggle optimistically and
   * the pref write hasn't landed yet, the read returns a stale `false` and the
   * registration silently no-ops right after the user tapped Allow.
   *
   * Only pass this from a real user gesture. Defaults to false, so every
   * existing caller keeps the opt-out check.
   */
  assumeEnabled?: boolean;
}

export async function registerPushToken(uid: string, options: RegisterPushTokenOptions = {}): Promise<void> {
  if (!isPushSupported()) return;

  let permission: NativePushPermission;
  try {
    permission = await requestPushPermission();
  } catch (err) {
    logger.warn("push_permission_request_failed", { uid, error: parseFirebaseError(err) });
    return;
  }
  if (permission !== "granted") {
    logger.info("push_permission_not_granted", { uid, permission });
    return;
  }

  await registerAndPersist(uid, options.assumeEnabled === true);
}

/**
 * Register this device ONLY when OS notification permission is already granted.
 *
 * Mirrors the web split in src/services/fcm.ts (requestPushPermission vs
 * refreshWebPushTokenIfGranted): auth lifecycle code must never trigger a cold
 * OS permission dialog — a prompt the user didn't ask for is the fastest way to
 * get permanently denied. `checkPermissions()` is a pure query and never shows
 * UI, so this is safe from the post-sign-in effect. The prompting path
 * ({@link registerPushToken}) stays reserved for explicit user action.
 */
export async function registerPushTokenIfGranted(uid: string): Promise<void> {
  if (!isPushSupported()) return;

  try {
    const status = await PushNotifications.checkPermissions();
    if (status.receive !== "granted") return;
  } catch (err) {
    logger.warn("push_permission_check_failed", { uid, error: parseFirebaseError(err) });
    return;
  }

  await registerAndPersist(uid, false);
}

/** Shared listener-attach + register() body for both registration entry points. */
async function registerAndPersist(uid: string, assumeEnabled: boolean): Promise<void> {
  // Respect the Settings opt-out. Without this, the post-sign-in refresh would
  // repopulate /pushTargets for a user who explicitly turned push off and
  // silently resurrect their notifications on the next device. Bypassed only
  // when the caller is acting on an explicit user gesture (see
  // RegisterPushTokenOptions.assumeEnabled).
  if (!assumeEnabled && !(await getPushEnabled(uid))) {
    logger.info("push_registration_skipped_disabled", { uid });
    return;
  }

  // Attach the token listener BEFORE register() — the plugin can emit the
  // registration event synchronously on a cached APNS/FCM token, so a
  // listener added after register() can miss the event on warm starts.
  let tokenListener: Awaited<ReturnType<typeof PushNotifications.addListener>> | null = null;
  let errorListener: Awaited<ReturnType<typeof PushNotifications.addListener>> | null = null;
  try {
    tokenListener = await PushNotifications.addListener("registration", (token: Token) => {
      void persistToken(uid, token.value);
    });
    errorListener = await PushNotifications.addListener("registrationError", (err: { error: string }) => {
      logger.warn("push_registration_error", { uid, error: err.error });
    });
    await PushNotifications.register();
  } catch (err) {
    logger.warn("push_register_failed", { uid, error: parseFirebaseError(err) });
    // Clean up the listeners we just added — otherwise a retry stacks
    // duplicate handlers that each write the token on the next event.
    // Swallow remove() failures so they don't mask the real register error.
    /* v8 ignore start -- defensive cleanup; .remove() reject path is not observable from tests */
    await tokenListener?.remove().catch(() => {});
    await errorListener?.remove().catch(() => {});
    /* v8 ignore stop */
  }
}

async function persistToken(uid: string, token: string): Promise<void> {
  if (!token) return;
  try {
    const db = requireDb();
    await setDoc(
      doc(db, "users", uid, "private", PRIVATE_PROFILE_DOC_ID),
      { fcmTokens: arrayUnion(token) },
      { merge: true },
    );
    // Mirror to the cross-readable /pushTargets/{uid} doc so the dispatch
    // path (src/services/pushDispatch.ts) can embed this device's token in
    // a push_dispatch doc when an opponent triggers a notifiable event.
    // Same rationale as the web path in src/services/fcm.ts — the canonical
    // list stays owner-only, the mirror unlocks cross-user delivery.
    await setDoc(
      doc(db, PUSH_TARGETS_COLLECTION, uid),
      { tokens: arrayUnion(token), updatedAt: serverTimestamp() },
      { merge: true },
    );
    activePushToken = token;
  } catch (err) {
    logger.warn("push_token_persist_failed", { uid, error: parseFirebaseError(err) });
  }
}

/* ────────────────────────────────────────────
 * Push tap → deep link
 * ──────────────────────────────────────────── */

/**
 * Pull the gameId out of a native push payload.
 *
 * The dispatch doc (buildAdminDispatchDoc / buildDispatchDoc) puts it at
 * `data.gameId`, and FCM delivers the whole `data` map on the notification.
 * `click_action` (`/?game=<id>`) is the fallback for payloads minted before
 * `data.gameId` existed, matching what the web service worker parses.
 */
function gameIdFromPushData(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const gameId = record.gameId;
  if (typeof gameId === "string" && gameId.length > 0) return gameId;
  const clickAction = record.click_action;
  if (typeof clickAction === "string") {
    const match = /[?&]game=([^&]+)/.exec(clickAction);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

/**
 * Subscribe to native push TAPS and surface the game the push points at.
 *
 * The native counterpart of the web service-worker → OPEN_GAME_EVENT bridge:
 * without it, tapping a "your turn" push on iOS/Android just opened the app at
 * whatever screen it was last on, with no way to reach the game. `cb` receives
 * the gameId; the UI layer decides how to navigate.
 *
 * Returns an unsubscribe function. Safe to call on web (no-op unsubscribe) so
 * consumers can mount it unconditionally.
 */
export function subscribeToNativePushOpens(cb: (gameId: string) => void): () => void {
  if (!isPushSupported()) return () => {};

  let removed = false;
  const handle = PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const gameId = gameIdFromPushData(action.notification.data);
    if (gameId) cb(gameId);
  }).catch((err: unknown) => {
    logger.warn("push_action_listener_failed", { error: parseFirebaseError(err) });
    return null;
  });

  return () => {
    if (removed) return;
    removed = true;
    void handle.then((h) => h?.remove()).catch(() => {});
  };
}

/**
 * Remove this device's push token from the user's private profile and
 * unregister from the native service. Best-effort — errors are swallowed
 * so sign-out / account deletion is never blocked by a transient push
 * failure.
 *
 * Must be called BEFORE Firebase Auth sign-out (owner-only rules deny
 * the write once the ID token is revoked). Callers in AuthContext already
 * respect this ordering.
 */
export async function unregisterPushToken(uid: string): Promise<void> {
  if (!isPushSupported()) return;

  const token = activePushToken;
  if (token) {
    try {
      const db = requireDb();
      await setDoc(
        doc(db, "users", uid, "private", PRIVATE_PROFILE_DOC_ID),
        { fcmTokens: arrayRemove(token) },
        { merge: true },
      );
      // Scrub the mirror in lockstep — a stale entry here would route
      // pushes to the device after sign-out / account swap.
      await setDoc(
        doc(db, PUSH_TARGETS_COLLECTION, uid),
        { tokens: arrayRemove(token), updatedAt: serverTimestamp() },
        { merge: true },
      );
      activePushToken = null;
    } catch (err) {
      logger.warn("push_token_remove_failed", { uid, error: parseFirebaseError(err) });
    }
  }

  // Best-effort native unregister — deletes the FCM token on Android and
  // unregisters APNS on iOS. Errors are non-fatal.
  try {
    await PushNotifications.removeAllListeners();
    await PushNotifications.unregister();
  } catch (err) {
    logger.warn("push_native_unregister_failed", { uid, error: parseFirebaseError(err) });
  }
}
