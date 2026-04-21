import { getMessaging, getToken, onMessage, type MessagePayload } from "firebase/messaging";
import { doc, setDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import app, { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

/**
 * Path to the owner-only subcollection doc that stores FCM push tokens.
 * Kept out of the publicly readable `users/{uid}` root so another signed-in
 * user cannot enumerate tokens for bulk-push abuse. See firestore.rules
 * `match /users/{uid}/private/{docId}`.
 */
const PRIVATE_PROFILE_DOC = "profile";

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
      doc(requireDb(), "users", uid, "private", PRIVATE_PROFILE_DOC),
      { fcmTokens: arrayUnion(token) },
      { merge: true },
    );

    return token;
  } catch (err) {
    logger.warn("fcm_token_failed", { error: parseFirebaseError(err) });
    return null;
  }
}

/**
 * Remove a specific FCM token from the user's private profile (call on sign-out).
 */
export async function removeFcmToken(uid: string, token: string): Promise<void> {
  try {
    await setDoc(
      doc(requireDb(), "users", uid, "private", PRIVATE_PROFILE_DOC),
      { fcmTokens: arrayRemove(token) },
      { merge: true },
    );
  } catch (err) {
    logger.warn("fcm_token_removal_failed", { uid, error: parseFirebaseError(err) });
  }
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
