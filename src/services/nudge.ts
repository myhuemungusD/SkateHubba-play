import { addDoc, collection, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { requireDb } from "../firebase";

const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

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
    throw new Error("You can only nudge once every 4 hours per game");
  }

  const db = requireDb();

  // Upsert the rate-limit doc (Firestore rules enforce 4h cooldown server-side)
  const limitId = `${senderUid}_${gameId}`;
  await setDoc(doc(db, "nudge_limits", limitId), { senderUid, gameId, lastNudgedAt: serverTimestamp() });

  // Create the nudge document (triggers Cloud Function)
  await addDoc(collection(db, "nudges"), {
    senderUid,
    senderUsername,
    recipientUid,
    gameId,
    createdAt: serverTimestamp(),
    delivered: false,
  });

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
