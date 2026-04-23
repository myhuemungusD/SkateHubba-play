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
import { doc, setDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { PRIVATE_PROFILE_DOC_ID } from "./users";

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

/**
 * Prompt the OS for push notification permission. On Android 12 and below
 * this is always granted at install time; on Android 13+ and iOS it shows
 * the system dialog. Returns the resulting permission state — the caller
 * decides whether to proceed to {@link registerPushToken}.
 */
export async function requestPushPermission(): Promise<"granted" | "denied" | "prompt"> {
  const status = await PushNotifications.requestPermissions();
  // PermissionState values: "granted" | "denied" | "prompt" | "prompt-with-rationale"
  // Collapse the rationale variant into "prompt" so consumers have a tight
  // three-value contract.
  if (status.receive === "granted") return "granted";
  if (status.receive === "denied") return "denied";
  return "prompt";
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
export async function registerPushToken(uid: string): Promise<void> {
  if (!isPushSupported()) return;

  let permission: "granted" | "denied" | "prompt";
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
    // Clean up the listener we just added — otherwise a retry stacks
    // duplicate handlers that each write the token on the next event.
    await tokenListener?.remove().catch(() => {});
    await errorListener?.remove().catch(() => {});
  }
}

async function persistToken(uid: string, token: string): Promise<void> {
  if (!token) return;
  try {
    await setDoc(
      doc(requireDb(), "users", uid, "private", PRIVATE_PROFILE_DOC_ID),
      { fcmTokens: arrayUnion(token) },
      { merge: true },
    );
    activePushToken = token;
  } catch (err) {
    logger.warn("push_token_persist_failed", { uid, error: parseFirebaseError(err) });
  }
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
      await setDoc(
        doc(requireDb(), "users", uid, "private", PRIVATE_PROFILE_DOC_ID),
        { fcmTokens: arrayRemove(token) },
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
