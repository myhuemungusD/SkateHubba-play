import { getMessaging, getToken, onMessage, type MessagePayload } from "firebase/messaging";
import { doc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import app, { requireDb } from "../firebase";

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
      console.warn("VITE_FIREBASE_VAPID_KEY not set — push notifications disabled");
      return null;
    }

    const token = await getToken(messaging, { vapidKey: String(vapidKey) });
    if (!token) return null;

    // Store token on the user's profile
    await updateDoc(doc(requireDb(), "users", uid), {
      fcmTokens: arrayUnion(token),
    });

    return token;
  } catch (err) {
    console.warn("Failed to get FCM token:", err);
    return null;
  }
}

/**
 * Remove a specific FCM token from the user's profile (call on sign-out).
 */
export async function removeFcmToken(uid: string, token: string): Promise<void> {
  try {
    await updateDoc(doc(requireDb(), "users", uid), {
      fcmTokens: arrayRemove(token),
    });
  } catch {
    // Best-effort cleanup
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
