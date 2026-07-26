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
import { dispatchPushNotification, type PushDispatchOutbox } from "./pushDispatch";

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

    // Background push fan-out. Fire-and-forget after the batch commits so
    // a dispatch failure (recipient has no tokens, dispatch cooldown hit,
    // …) can never undo the in-app notification or wedge the caller.
    // No await — the original writeNotification contract is "best-effort,
    // never blocks the game action", and adding latency here would break it.
    void dispatchPushNotification({
      senderUid: params.senderUid,
      recipientUid: params.recipientUid,
      type: params.type,
      title: params.title,
      body: params.body,
      gameId: params.gameId,
    });

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
export function writeNotificationInTx(
  tx: Transaction,
  params: WriteNotificationParams,
  pushOutbox?: PushDispatchOutbox,
): void {
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
  // Stage the push dispatch for after the tx commits. Callers that pass an
  // outbox are responsible for calling drainPushDispatchOutbox(outbox) AFTER
  // runTransaction returns — staging in-tx is wrong (would fire on retried
  // or aborted transactions); firing in-tx is wrong (would do non-tx reads
  // and creates inside a transaction body). Optional so callers that don't
  // need OS-level push (tests, transient writes) stay zero-overhead.
  if (pushOutbox) {
    pushOutbox.staged.push(params);
  }
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

/** Firestore hard-caps a writeBatch at 500 operations. */
const DELETE_PAGE_SIZE = 500;

/**
 * Delete all notification documents for a user.
 *
 * Paginated rather than "fetch everything, fire one deleteDoc per doc in
 * parallel": /notifications has no TTL, so a long-lived account accumulates
 * thousands of docs and the naive version issued that many concurrent writes in
 * one burst. Loops a page at a time until a short page signals the end.
 */
export async function deleteUserNotifications(uid: string): Promise<void> {
  const db = requireDb();
  for (;;) {
    const q = query(collection(db, "notifications"), where("recipientUid", "==", uid), limit(DELETE_PAGE_SIZE));
    const snap = await getDocs(q);
    if (snap.empty) return;

    const batch = writeBatch(db);
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();

    // A short page means we just drained the tail — no further query needed.
    if (snap.size < DELETE_PAGE_SIZE) return;
  }
}

// ── Real-time subscriptions (extracted from GameNotificationWatcher) ──

export interface NudgeEvent {
  senderUsername: string;
  gameId: string;
}

/**
 * Subscribe to incoming nudges for a user. Fires `onNudge` only for
 * newly added docs (skips the initial snapshot seed).
 *
 * Deliberately NOT given the createdAt watermark that `subscribeToNotifications`
 * needs. That guard exists because the notifications query filters on
 * `read == false`, so marking one read pulls an older doc into the window and
 * re-fires it as `added`. This query has no such filter: /nudges docs are never
 * updated (`allow update: if false`) and never deleted, so the limit(5) window
 * only ever changes by a NEW nudge arriving at the head. No doc can re-enter,
 * and the seed-id check is sufficient.
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

  return onSnapshot(
    q,
    (snap) => {
      if (initialIds === null) {
        initialIds = new Set(snap.docs.map((d) => d.id));
        return;
      }

      // Dedupe via initialIds alone — no setTimeout(0) `ready` gate. The
      // previous gate dropped snapshots that arrived in the same microtask
      // as the initial seed (server reconcile after a cache hit), silently
      // swallowing nudges. initialIds is populated synchronously on the
      // first snapshot, so the membership check is sufficient.
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
  /** Server `createdAt` in epoch millis. 0 when the timestamp hasn't resolved. */
  createdAtMs: number;
}

/** Cap on the emitted-id set. Safe to trim: see the note in the snapshot handler. */
const MAX_EMITTED_IDS = 200;

/** Resolve a notification doc's server timestamp to millis, or 0 if unresolved. */
function createdAtMillis(data: Record<string, unknown>): number {
  const createdAt = data.createdAt;
  if (createdAt && typeof (createdAt as { toMillis?: unknown }).toMillis === "function") {
    return (createdAt as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function toNotificationEvent(id: string, data: Record<string, unknown>): NotificationEvent {
  return {
    firestoreId: id,
    type: typeof data.type === "string" ? data.type : "",
    title: typeof data.title === "string" ? data.title : "SkateHubba",
    body: typeof data.body === "string" ? data.body : "",
    gameId: typeof data.gameId === "string" ? data.gameId : "",
    createdAtMs: createdAtMillis(data),
  };
}

/**
 * Subscribe to unread notifications for a user.
 *
 * `onNotification` fires for genuinely NEW docs only — it is the toast path.
 * `onSeed` receives the initial snapshot (newest first) exactly once per
 * subscription and must not toast; it exists so the notification bell can be
 * backed by Firestore rather than only by this device's localStorage. Without
 * it, a challenge that arrived while the app was closed left no in-app record
 * at all, and a fresh device showed an empty bell despite unread docs on the
 * server.
 *
 * The caller is responsible for marking notifications as read when the user has
 * actually seen them (via `markNotificationRead`).
 */
export function subscribeToNotifications(
  uid: string,
  onNotification: (notif: NotificationEvent) => void,
  onSeed?: (notifs: NotificationEvent[]) => void,
): Unsubscribe {
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

  // Docs present in the very first snapshot. Never toasted (the user was not
  // looking when they arrived, so a burst of chimes on launch is wrong) but
  // handed to `onSeed` so they can populate the bell.
  let seedIds: Set<string> | null = null;
  // Newest createdAt observed at seed time, advanced as newer docs are emitted.
  // This — not set membership — is what decides whether an `added` doc is new.
  let watermarkMs = 0;
  const emittedIds = new Set<string>();

  return onSnapshot(
    q,
    (snap) => {
      if (seedIds === null) {
        seedIds = new Set(snap.docs.map((d) => d.id));
        const seeded = snap.docs.map((d) => toNotificationEvent(d.id, d.data()));
        for (const evt of seeded) {
          if (evt.createdAtMs > watermarkMs) watermarkMs = evt.createdAtMs;
        }
        // An empty seed leaves the watermark at 0, so the first genuinely-new
        // notification (createdAtMs > 0) still fires. Guarding on membership
        // alone here would be fine; the watermark is what the *later* branch
        // needs.
        onSeed?.(seeded);
        return;
      }

      // Why a timestamp watermark and not just "is this id in the seed set":
      // the query is `read == false ORDER BY createdAt DESC LIMIT 10`. Seeded
      // docs are never toasted, so they are never marked read, so unread grows
      // across sessions. Past 10 unread, docs ranked 11+ sit OUTSIDE the window
      // and are absent from the seed set — and the moment the user marks a
      // toasted notification read, one of them slides into the window as an
      // `added` change, passes a membership check, and toasts (with a chime)
      // for a challenge from days ago. Comparing createdAt against the
      // high-water mark makes an older doc entering the window a no-op no
      // matter how it got there.
      for (const change of snap.docChanges()) {
        if (change.type !== "added") continue;
        const id = change.doc.id;
        if (seedIds.has(id) || emittedIds.has(id)) continue;

        const evt = toNotificationEvent(id, change.doc.data());
        // Unresolved server timestamp: cannot be ordered against the watermark,
        // so neither toast nor advance. Firestore re-delivers the doc as a
        // `modified` change once the write resolves — and in practice the
        // recipient never authors these, so this is defensive only.
        if (evt.createdAtMs === 0) continue;
        // `>=` rather than `>` so two notifications landing in the same
        // millisecond both surface; only a strictly-older doc is suppressed.
        if (evt.createdAtMs < watermarkMs) continue;

        onNotification(evt);
        emittedIds.add(id);
        watermarkMs = evt.createdAtMs;
      }

      // Bound the emitted set. Trimming is safe precisely because the watermark
      // only ever moves forward: a trimmed id's doc is older than the current
      // watermark, so it can never toast again even without its membership entry.
      if (emittedIds.size > MAX_EMITTED_IDS) {
        const keep = Array.from(emittedIds).slice(-MAX_EMITTED_IDS / 2);
        emittedIds.clear();
        for (const id of keep) emittedIds.add(id);
      }
    },
    (err) => {
      logger.warn("notification_subscription_error", { uid, error: parseFirebaseError(err) });
    },
  );
}
