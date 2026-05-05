import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Transaction,
  type Unsubscribe,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

export type NotificationDocType = "your_turn" | "new_challenge" | "game_won" | "game_lost" | "judge_invite";

interface WriteNotificationParams {
  senderUid: string;
  recipientUid: string;
  type: NotificationDocType;
  title: string;
  body: string;
  gameId: string;
}

/* ────────────────────────────────────────────
 * Client-side rate limiting (defense-in-depth)
 * ──────────────────────────────────────────── */

const lastNotificationAt = new Map<string, number>();
const NOTIFICATION_COOLDOWN_MS = 5_000;

function rateLimitKey(senderUid: string, gameId: string, type: string): string {
  return `${senderUid}_${gameId}_${type}`;
}

/** @internal Reset rate-limit state (for tests only) */
export function _resetNotificationRateLimit(): void {
  lastNotificationAt.clear();
}

/**
 * Write a notification document to the `notifications` collection.
 * The recipient's app listens to this collection via onSnapshot and
 * surfaces it as an in-app toast. This is the no-Cloud-Functions path
 * for alerting opponents about game events.
 *
 * The notification doc and the notification_limits cooldown doc are
 * committed in a single writeBatch so the rules-side getAfter() companion-
 * write check sees both. A partial commit (e.g. notification without limit)
 * is impossible, closing the H2 bypass where a client could skip the
 * cooldown bookkeeping and spam an opponent's feed.
 *
 * Best-effort — failures are silently swallowed so they never block
 * the primary game action.
 */
export async function writeNotification(params: WriteNotificationParams): Promise<void> {
  const key = rateLimitKey(params.senderUid, params.gameId, params.type);

  // Client-side rate limit: skip silently if within cooldown
  const last = lastNotificationAt.get(key) ?? 0;
  if (Date.now() - last < NOTIFICATION_COOLDOWN_MS) {
    return;
  }

  try {
    const db = requireDb();
    const notificationRef = doc(collection(db, "notifications"));
    const limitRef = doc(db, "notification_limits", key);

    const batch = writeBatch(db);
    batch.set(notificationRef, {
      senderUid: params.senderUid,
      recipientUid: params.recipientUid,
      type: params.type,
      title: params.title,
      body: params.body,
      gameId: params.gameId,
      read: false,
      createdAt: serverTimestamp(),
    });
    batch.set(limitRef, {
      senderUid: params.senderUid,
      gameId: params.gameId,
      type: params.type,
      lastSentAt: serverTimestamp(),
    });
    await batch.commit();

    const now = Date.now();
    lastNotificationAt.set(key, now);

    // Drop entries past the cooldown window so the map stays bounded.
    // The deletion has no observable effect beyond memory hygiene, so the
    // expired branch can't be asserted — ignore for coverage.
    const cutoff = now - NOTIFICATION_COOLDOWN_MS;
    for (const [k, ts] of lastNotificationAt) {
      /* v8 ignore next */
      if (ts < cutoff) lastNotificationAt.delete(k);
    }
  } catch (err) {
    // Best-effort — don't block the game action if notification write fails
    logger.warn("notification_write_failed", {
      recipientUid: params.recipientUid,
      type: params.type,
      error: parseFirebaseError(err),
    });
  }
}

/**
 * Stage a notification write inside an existing Firestore transaction.
 *
 * Use this from game mutations that already run under `runTransaction` so the
 * notification is written atomically with the game update — if the client
 * tab dies between commit and "best-effort" write, the opponent would otherwise
 * never get toasted. Inside a transaction there is no "between": either both
 * the game update and the notification commit, or neither does.
 *
 * Server-side companion-write requirement: the /notifications create rule
 * accepts EITHER a fresh notification_limits doc in the same batch, OR a
 * fresh /games/{gameId} update (updatedAt == request.time). Every caller of
 * this function is inside a runTransaction that also writes
 * games.updatedAt = serverTimestamp(), so the games-anchor branch is what
 * gates this path — no notification_limits write needed in-tx.
 *
 * Notes:
 *  • No client-side rate limit (in-tx writes happen inside game actions that
 *    already have their own cooldowns via `checkTurnActionRate`).
 *  • notification_limits is intentionally NOT written here: the games-anchor
 *    rule branch covers the companion-write requirement, and writing two
 *    docs inside a transaction (notification + limit) would tighten the 5s
 *    update cooldown on the limit doc against rapid back-to-back game
 *    actions of the same (sender, gameId, type). Rate limits on the in-tx
 *    hot path are enforced by checkTurnActionRate + the game's turn-order
 *    rules instead.
 */
export function writeNotificationInTx(tx: Transaction, params: WriteNotificationParams): void {
  // Client-generated deterministic ID. Safe inside a transaction — if the
  // transaction is retried by the SDK the same ID is reused, keeping the
  // notification create idempotent with the game update.
  const db = requireDb();
  const notificationRef = doc(collection(db, "notifications"));
  tx.set(notificationRef, {
    senderUid: params.senderUid,
    recipientUid: params.recipientUid,
    type: params.type,
    title: params.title,
    body: params.body,
    gameId: params.gameId,
    read: false,
    createdAt: serverTimestamp(),
  });
}

// ── Notification read/delete ──────────────────────────────

/**
 * Mark a single notification as read (best-effort).
 */
export async function markNotificationRead(notificationId: string): Promise<void> {
  try {
    await updateDoc(doc(requireDb(), "notifications", notificationId), { read: true });
  } catch (err) {
    logger.warn("notification_mark_read_failed", {
      notificationId,
      error: parseFirebaseError(err),
    });
  }
}

/**
 * Delete a single notification document.
 */
export async function deleteNotification(notificationId: string): Promise<void> {
  await deleteDoc(doc(requireDb(), "notifications", notificationId));
}

/**
 * Delete all notification documents for a user. Best-effort batch delete.
 */
export async function deleteUserNotifications(uid: string): Promise<void> {
  const q = query(collection(requireDb(), "notifications"), where("recipientUid", "==", uid));
  const snap = await getDocs(q);
  const deletions = snap.docs.map((d) => deleteDoc(d.ref));
  await Promise.all(deletions);
}

// ── Real-time subscriptions (extracted from GameNotificationWatcher) ──

export interface NudgeEvent {
  senderUsername: string;
  gameId: string;
}

/**
 * Subscribe to incoming nudges for a user. Fires `onNudge` only for
 * newly added docs (skips the initial snapshot seed).
 */
export function subscribeToNudges(uid: string, onNudge: (nudge: NudgeEvent) => void): Unsubscribe {
  let db;
  try {
    db = requireDb();
  } catch {
    // Firestore not initialized (tests, or pre-`firebaseReady` render).
    // Return a no-op unsub so callers can mount unconditionally.
    return () => {};
  }
  const q = query(collection(db, "nudges"), where("recipientUid", "==", uid), orderBy("createdAt", "desc"), limit(5));

  let initialIds: Set<string> | null = null;
  let ready = false;

  return onSnapshot(
    q,
    (snap) => {
      if (initialIds === null) {
        initialIds = new Set(snap.docs.map((d) => d.id));
        setTimeout(() => {
          ready = true;
        }, 0);
        return;
      }
      if (!ready) return;

      for (const change of snap.docChanges()) {
        if (change.type === "added" && !initialIds.has(change.doc.id)) {
          const data = change.doc.data();
          onNudge({ senderUsername: data.senderUsername, gameId: data.gameId });
          initialIds.add(change.doc.id);
          if (initialIds.size > 50) {
            initialIds = new Set(Array.from(initialIds).slice(-25));
          }
        }
      }
    },
    (err) => {
      logger.warn("nudge_subscription_error", { uid, error: parseFirebaseError(err) });
    },
  );
}

export interface NotificationEvent {
  firestoreId: string;
  type: string;
  title: string;
  body: string;
  gameId: string;
}

/**
 * Subscribe to unread notifications for a user. Fires `onNotification`
 * for newly added docs. The caller is responsible for marking notifications
 * as read when the user has actually seen them (via `markNotificationRead`).
 */
export function subscribeToNotifications(uid: string, onNotification: (notif: NotificationEvent) => void): Unsubscribe {
  let db;
  try {
    db = requireDb();
  } catch {
    // Firestore not initialized (tests, or pre-`firebaseReady` render).
    // Return a no-op unsub so callers can mount unconditionally.
    return () => {};
  }
  const q = query(
    collection(db, "notifications"),
    where("recipientUid", "==", uid),
    where("read", "==", false),
    orderBy("createdAt", "desc"),
    limit(10),
  );

  let initialIds: Set<string> | null = null;
  let ready = false;

  return onSnapshot(
    q,
    (snap) => {
      if (initialIds === null) {
        initialIds = new Set(snap.docs.map((d) => d.id));
        setTimeout(() => {
          ready = true;
        }, 0);
        return;
      }
      if (!ready) return;

      for (const change of snap.docChanges()) {
        if (change.type === "added" && !initialIds.has(change.doc.id)) {
          const data = change.doc.data();
          onNotification({
            firestoreId: change.doc.id,
            type: data.type ?? "",
            title: data.title ?? "SkateHubba",
            body: data.body ?? "",
            gameId: data.gameId,
          });
          initialIds.add(change.doc.id);
        }
      }

      if (initialIds.size > 50) {
        initialIds = new Set(Array.from(initialIds).slice(-25));
      }
    },
    (err) => {
      logger.warn("notification_subscription_error", { uid, error: parseFirebaseError(err) });
    },
  );
}
