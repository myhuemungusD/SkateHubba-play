import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
  where,
  type QuerySnapshot,
  type DocumentData,
} from "firebase/firestore";
import { requireDb } from "../firebase";

const COOLDOWN_MS = 1 * 60 * 60 * 1000; // 1 hour

interface SendNudgeParams {
  gameId: string;
  senderUid: string;
  senderUsername: string;
  recipientUid: string;
}

/**
 * Send a nudge to an opponent. Writes to Firestore which triggers
 * a Cloud Function to send a push notification.
 *
 * Rate-limited both client-side (localStorage) and server-side (Firestore rules).
 */
export async function sendNudge({ gameId, senderUid, senderUsername, recipientUid }: SendNudgeParams): Promise<void> {
  // Client-side cooldown check
  const key = `nudge_${gameId}`;
  const last = parseInt(localStorage.getItem(key) || "0", 10);
  if (Date.now() - last < COOLDOWN_MS) {
    throw new Error("You can only nudge once per hour per game");
  }

  const db = requireDb();

  // Create the nudge document first (triggers Cloud Function).
  // Written before the rate-limit doc so a failed nudge write doesn't
  // poison the cooldown and block future attempts.
  await addDoc(collection(db, "nudges"), {
    senderUid,
    senderUsername,
    recipientUid,
    gameId,
    createdAt: serverTimestamp(),
    delivered: false,
  });

  // Upsert the rate-limit doc (Firestore rules enforce 1h cooldown server-side)
  const limitId = `${senderUid}_${gameId}`;
  await setDoc(doc(db, "nudge_limits", limitId), { senderUid, gameId, lastNudgedAt: serverTimestamp() });

  // Record locally for client-side cooldown
  localStorage.setItem(key, String(Date.now()));
}

/**
 * Check if the nudge cooldown has elapsed for a specific game.
 */
export function canNudge(gameId: string): boolean {
  const key = `nudge_${gameId}`;
  const last = parseInt(localStorage.getItem(key) || "0", 10);
  return Date.now() - last >= COOLDOWN_MS;
}

/**
 * Subscribe to incoming nudges for a user in real time.
 * Returns an unsubscribe function.
 */
export function subscribeToNudges(uid: string, callback: (snap: QuerySnapshot<DocumentData>) => void): () => void {
  const q = query(
    collection(requireDb(), "nudges"),
    where("recipientUid", "==", uid),
    orderBy("createdAt", "desc"),
    limit(5),
  );
  return onSnapshot(q, callback);
}
