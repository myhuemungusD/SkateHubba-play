import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { requireDb } from "../firebase";

const COOLDOWN_MS = 1 * 60 * 60 * 1000; // 1 hour

interface SendNudgeParams {
  gameId: string;
  senderUid: string;
  senderUsername: string;
  recipientUid: string;
}

/**
 * Send a nudge to an opponent. Writes a doc to the /nudges collection.
 *
 * IN-APP ONLY. A nudge does NOT wake an offline device. There are no
 * application Cloud Functions, and the `firestore-send-fcm` extension only
 * watches /push_dispatch — not /nudges. Delivery is via the in-app
 * `subscribeToNudges` listener (see GameNotificationWatcher), which surfaces
 * the nudge as a toast the next time the recipient has the app open. Routing
 * nudges through the OS-push path (`dispatchPushNotification`) is not wired:
 * the push_dispatch rules whitelist only the NotificationDocType values
 * (your_turn/new_challenge/game_won/game_lost/judge_invite) and reject a
 * "nudge" type, so enabling OS push for nudges is a rules + product change,
 * not a service-only one.
 *
 * Rate-limited both client-side (localStorage) and server-side (Firestore rules).
 *
 * The nudge doc and the nudge_limits cooldown doc are committed in a single
 * writeBatch so the rules-side getAfter() companion-write check sees both —
 * a partial commit (e.g. nudge without limit) is impossible, which closes the
 * H1 bypass where a client could spam /nudges by simply not writing the
 * cooldown doc.
 */
export async function sendNudge({ gameId, senderUid, senderUsername, recipientUid }: SendNudgeParams): Promise<void> {
  // Client-side cooldown check (keyed by user+game to avoid cross-user interference)
  const key = `nudge_${senderUid}_${gameId}`;
  const last = parseInt(localStorage.getItem(key) ?? "0", 10) || 0;
  if (Date.now() - last < COOLDOWN_MS) {
    throw new Error("You can only nudge once per hour per game");
  }

  const db = requireDb();

  const nudgeRef = doc(collection(db, "nudges"));
  const limitRef = doc(db, "nudge_limits", `${senderUid}_${gameId}`);

  const batch = writeBatch(db);
  batch.set(nudgeRef, {
    senderUid,
    senderUsername,
    recipientUid,
    gameId,
    createdAt: serverTimestamp(),
    delivered: false,
  });
  batch.set(limitRef, { senderUid, gameId, lastNudgedAt: serverTimestamp() });
  await batch.commit();

  // Record locally for client-side cooldown
  localStorage.setItem(key, String(Date.now()));
}

/**
 * Check if the nudge cooldown has elapsed for a specific game.
 */
export function canNudge(gameId: string, senderUid: string): boolean {
  const key = `nudge_${senderUid}_${gameId}`;
  const last = parseInt(localStorage.getItem(key) ?? "0", 10) || 0;
  return Date.now() - last >= COOLDOWN_MS;
}
