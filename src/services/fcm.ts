import { getMessaging, getToken, onMessage, type MessagePayload } from "firebase/messaging";
import { doc, setDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import app, { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { USER_PRIVATE_PROFILE_DOC_ID } from "./users";

/**
 * The FCM token issued for this tab/device during the current session.
 * Captured by {@link requestPushPermission} so {@link removeCurrentFcmToken}
 * can scrub only THIS device's token on sign-out (not every device the user
 * has ever signed in from). Cleared after a successful remove.
 */
let activeFcmToken: string | null = null;

/** @internal Reset the cached active token (for tests only). */
export function _resetActiveFcmToken(): void {
  activeFcmToken = null;
}

let messagingInstance: ReturnType<typeof getMessaging> | null = null;

function getMessagingInstance() {
  /* v8 ignore start -- guard for null Firebase app; always truthy when firebase.ts init succeeds */
  if (!app) throw new Error("Firebase not initialized");
  /* v8 ignore stop */
  if (!messagingInstance) {
    messagingInstance = getMessaging(app);
  }
  return messagingInstance;
}

/**
 * Register the Firebase messaging service worker with Firebase config passed
 * via URL search params. This ensures the SW has real config values in dev
 * mode (where the Vite build plugin doesn't run). In production the SW file
 * already has config baked in by the plugin, so the params act as a no-op
 * fallback.
 */
let swRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;

export function getSwRegistration(): Promise<ServiceWorkerRegistration> {
  if (swRegistrationPromise) return swRegistrationPromise;

  /* v8 ignore start -- env vars are always present when firebase.ts init succeeds; ?? guards are defensive */
  const params = new URLSearchParams({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
  });
  /* v8 ignore stop */

  swRegistrationPromise = navigator.serviceWorker.register(`/firebase-messaging-sw.js?${params.toString()}`);

  return swRegistrationPromise;
}

/** @internal Reset cached SW registration (for tests only) */
export function _resetSwRegistration(): void {
  swRegistrationPromise = null;
}

/**
 * Request push notification permission and store the FCM token in Firestore.
 * Returns the token if successful, or null if denied/unsupported.
 */
export async function requestPushPermission(uid: string): Promise<string | null> {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return null;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  try {
    const messaging = getMessagingInstance();
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      logger.warn("vapid_key_missing", { hint: "set VITE_FIREBASE_VAPID_KEY to enable push notifications" });
      return null;
    }

    const serviceWorkerRegistration = await getSwRegistration();
    const token = await getToken(messaging, { vapidKey: String(vapidKey), serviceWorkerRegistration });
    if (!token) return null;

    // Store token on the owner-only private profile subcollection —
    // never on the publicly readable users/{uid} root.
    await setDoc(
      doc(requireDb(), "users", uid, "private", USER_PRIVATE_PROFILE_DOC_ID),
      { fcmTokens: arrayUnion(token) },
      { merge: true },
    );

    // Cache so sign-out can scrub exactly this device's token.
    activeFcmToken = token;
    return token;
  } catch (err) {
    logger.warn("fcm_token_failed", { error: parseFirebaseError(err) });
    return null;
  }
}

/**
 * Remove a specific FCM token from the user's private profile.
 * Prefer {@link removeCurrentFcmToken} which uses the token cached from
 * the last successful {@link requestPushPermission} call.
 */
export async function removeFcmToken(uid: string, token: string): Promise<void> {
  try {
    await setDoc(
      doc(requireDb(), "users", uid, "private", USER_PRIVATE_PROFILE_DOC_ID),
      { fcmTokens: arrayRemove(token) },
      { merge: true },
    );
    if (activeFcmToken === token) {
      activeFcmToken = null;
    }
  } catch (err) {
    logger.warn("fcm_token_removal_failed", { uid, error: parseFirebaseError(err) });
  }
}

/**
 * Remove this device's FCM token from the user's private profile before
 * sign-out. No-ops when no token was registered in this session. Must be
 * called BEFORE the Firebase Auth sign-out — once the ID token is gone,
 * the owner-only rules on `users/{uid}/private/profile` deny the write.
 *
 * Without this, the next user who signs in on the same device inherits
 * the previous user's push notifications until the browser revokes the
 * registration — a real privacy leak (game challenges and turn pings
 * routed to the wrong account).
 */
export async function removeCurrentFcmToken(uid: string): Promise<void> {
  const token = activeFcmToken;
  if (!token) return;
  await removeFcmToken(uid, token);
}

/**
 * Listen for foreground FCM messages. Returns an unsubscribe function.
 * The caller should convert the payload into an in-app notification.
 */
export function onForegroundMessage(callback: (payload: MessagePayload) => void): () => void {
  try {
    const messaging = getMessagingInstance();
    return onMessage(messaging, callback);
  } catch {
    return () => {};
  }
}
