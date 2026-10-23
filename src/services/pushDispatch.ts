/**
 * Push dispatch — server-side wake-up for offline recipients.
 *
 * The in-app /notifications collection only reaches users whose tab is open
 * (Firestore onSnapshot in GameNotificationWatcher). For an async game,
 * "your opponent moved" needs to wake the OS notification center on a
 * device that hasn't loaded the app in hours or days. That requires the
 * FCM HTTP API, which is OAuth2-gated and cannot be called from a client.
 *
 * The dispatcher is `api/cron/drain-push-dispatch.ts` — a serverless endpoint
 * driven by a GitHub Actions schedule every ~5 minutes. It reads the oldest
 * /push_dispatch docs, sends them via the FCM API with admin credentials,
 * prunes tokens FCM reports dead, and deletes what it processed.
 *
 * It replaced a `firebase/firestore-send-fcm` Firebase Extension that this file
 * used to name as the dispatcher. That extension does not exist in the Firebase
 * Extensions registry and never did, so /push_dispatch had no consumer at all:
 * every doc written here was validated, rate-limited, and then left to rot. If
 * you are tempted to move this back onto an extension, verify the extension
 * actually exists on extensions.dev first.
 *
 * Delivery is therefore near-real-time-ish, not instant: a push lands within
 * about five minutes of the game action, and GitHub's schedule triggers are
 * best-effort so it can be longer under platform load. That is an accepted
 * trade for an async game with 24h turn deadlines.
 *
 * Why a SEPARATE collection from /notifications:
 *  - /notifications carries user-visible feed entries. Schema is stable
 *    (recipientUid + title + body + read flag) and consumed by the in-app
 *    listener. Pushing the dispatcher's wire format (tokens, notification,
 *    data) into the same doc would couple two unrelated lifecycles.
 *  - /push_dispatch is fire-and-forget. The drain endpoint deletes each doc
 *    once FCM accepts it. Notifications are NOT deleted
 *    on read — they persist in the feed until the user clears them.
 *
 * Tokens live at /pushTargets/{uid}, a mirror of users/{uid}/private/profile
 * .fcmTokens. Since the 2026-10-21 security audit (M1) the mirror is
 * OWNER-READ-ONLY: a sender no longer reads the recipient's tokens and the
 * dispatch doc carries none (the create rule forbids a `tokens` key). The
 * couriers (functions/src/push/drain.ts and api/cron/drain-push-dispatch.ts)
 * look the recipient's devices up with the Admin SDK. The create rule still
 * requires sender and recipient to be participants of the same game.
 *
 * Best-effort by design. A failed dispatch never blocks the originating
 * game action — the recipient still gets the in-app notification via
 * /notifications onSnapshot the next time they open the tab.
 */

import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import type { NotificationDocType } from "./notifications";

/**
 * Types that may be pushed to a device.
 *
 * Wider than {@link NotificationDocType} because "nudge" is push-only: a nudge
 * has no /notifications feed entry (it lives in its own /nudges collection with
 * its own 1-hour cooldown), but it absolutely needs to wake an offline device —
 * poking an opponent who already has the app open is the one case where the
 * feature is pointless. Keep this union in lockstep with the `type in [...]`
 * allowlists on /push_dispatch and /push_dispatch_limits in firestore.rules.
 */
export type PushDispatchType = NotificationDocType | "nudge";

export interface PushDispatchParams {
  senderUid: string;
  recipientUid: string;
  type: PushDispatchType;
  title: string;
  body: string;
  gameId: string;
}

/* ────────────────────────────────────────────
 * Push-target mirror (tokens collection)
 * ──────────────────────────────────────────── */

/**
 * Collection path for the owner-only token mirror (M1; the couriers read it
 * with the Admin SDK). One doc per user,
 * keyed by uid. Kept top-level (not nested under /users/{uid}) so the rules
 * stay short and the reader doesn't accidentally inherit /users/{uid}
 * permissions on adjacent fields.
 */
export const PUSH_TARGETS_COLLECTION = "pushTargets" as const;

/**
 * Collection path the drain endpoint reads. Matches PUSH_DISPATCH_COLLECTION in
 * api/cron/drain-push-dispatch.ts — if you rename one, rename the other in
 * lockstep, and update the /push_dispatch match block in firestore.rules.
 */
export const PUSH_DISPATCH_COLLECTION = "push_dispatch" as const;

/**
 * Cooldown-anchor collection. The /push_dispatch create rule REQUIRES a
 * companion-write to /push_dispatch_limits/{senderUid_recipientUid_gameId_type}
 * in the same writeBatch, with lastSentAt pinned to serverTimestamp().
 * The limits-doc rules then enforce a 5s cooldown on update — which is
 * what actually rate-limits dispatch fan-out (closes the Codex P1 burst
 * window where one legit notification authorized unbounded dispatches in
 * a 10s sliding gate).
 */
export const PUSH_DISPATCH_LIMITS_COLLECTION = "push_dispatch_limits" as const;

/* ────────────────────────────────────────────
 * Dispatch
 * ──────────────────────────────────────────── */

/**
 * Hard caps on user-visible strings, mirrored on the /push_dispatch create
 * rule. The drain endpoint forwards these verbatim to FCM; without caps a
 * malicious sender could wedge multi-megabyte payloads through and burn
 * the recipient's quota.
 */
const MAX_TITLE_LEN = 80;
const MAX_BODY_LEN = 200;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Build the dispatch doc shape consumed by the drain endpoint. It reads
 * `notification.{title,body}` and `data`, and looks the recipient's tokens
 * up in /pushTargets itself (no `tokens` key, M1). Everything else
 * (senderUid, recipientUid, gameId, type) is metadata used by firestore.rules
 * to enforce write permissions and rate limits.
 *
 * `data.gameId` is what the service worker's notificationclick handler
 * (public/firebase-messaging-sw.js) reads to deep-link into the right game.
 */
function buildDispatchDoc(params: PushDispatchParams): Record<string, unknown> {
  return {
    // Drain-endpoint contract
    notification: {
      title: truncate(params.title, MAX_TITLE_LEN),
      body: truncate(params.body, MAX_BODY_LEN),
    },
    data: {
      gameId: params.gameId,
      type: params.type,
      // The SW handler resolves /?game=<id> from data.gameId, but we also
      // surface a click_action for FCM Web Push compatibility on browsers
      // that prefer it over data-only payloads.
      click_action: `/?game=${params.gameId}`,
    },
    // Rules-side metadata
    senderUid: params.senderUid,
    recipientUid: params.recipientUid,
    gameId: params.gameId,
    type: params.type,
    createdAt: serverTimestamp(),
  };
}

/**
 * Build the deterministic /push_dispatch_limits doc id. Mirrors the
 * /push_dispatch create rule's lookup key — keep these in lockstep.
 */
function dispatchLimitKey(params: PushDispatchParams): string {
  return `${params.senderUid}_${params.recipientUid}_${params.gameId}_${params.type}`;
}

/**
 * Queue a single push notification for the recipient's registered devices.
 * The courier looks the devices up; a recipient with none is dropped there
 * without an FCM call.
 *
 * Atomic writeBatch: /push_dispatch + /push_dispatch_limits commit together.
 * The limits doc is the rate-anchor companion the create rule requires
 * (server-side 5s cooldown). Without the batch, a malicious client could
 * write the dispatch doc alone and the rule's getAfter() check would fail
 * — but writing them as a batch is also what makes the legit path work,
 * so we always co-commit.
 *
 * Best-effort: any failure is logged and swallowed so the caller's game
 * action stays uncoupled from push delivery health.
 */
export async function dispatchPushNotification(params: PushDispatchParams): Promise<void> {
  try {
    const db = requireDb();
    const dispatchRef = doc(collection(db, PUSH_DISPATCH_COLLECTION));
    const limitRef = doc(db, PUSH_DISPATCH_LIMITS_COLLECTION, dispatchLimitKey(params));

    const batch = writeBatch(db);
    batch.set(dispatchRef, buildDispatchDoc(params));
    batch.set(limitRef, {
      senderUid: params.senderUid,
      recipientUid: params.recipientUid,
      gameId: params.gameId,
      type: params.type,
      lastSentAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    // Expected on burst/duplicate dispatches: the limits-doc 5s cooldown
    // rejects the second write within the window. Logged at warn (not
    // error) because it's the rate-limit working as designed.
    logger.warn("push_dispatch_write_failed", {
      recipientUid: params.recipientUid,
      type: params.type,
      error: parseFirebaseError(err),
    });
  }
}

/* ────────────────────────────────────────────
 * In-tx outbox
 * ──────────────────────────────────────────── */

/**
 * Push dispatch happens AFTER a successful `runTransaction` so it doesn't
 * fire on retries or on transactions that ultimately roll back. The outbox
 * is a tiny container the tx body fills as it stages notifications; once
 * the tx commits, the caller drains the outbox to fire pushes.
 *
 * Why not inside the tx? `dispatchPushNotification` writes /push_dispatch,
 * which does not belong in a game tx. The push is a
 * fire-and-forget side effect, not part of the atomic state machine.
 */
export interface PushDispatchOutbox {
  staged: PushDispatchParams[];
}

export function createPushDispatchOutbox(): PushDispatchOutbox {
  return { staged: [] };
}

/**
 * Reset the outbox at the START of a transaction callback so a retry doesn't
 * accumulate duplicate dispatches. Firestore SDK retries the entire callback
 * on contention, and each retry will re-stage the notification.
 */
export function resetPushDispatchOutbox(outbox: PushDispatchOutbox): void {
  outbox.staged.length = 0;
}

/**
 * Fire every staged dispatch and clear the outbox. Awaiting is optional —
 * callers can `void drainPushDispatchOutbox(outbox)` if they don't want to
 * couple the response latency of the game action to push-delivery latency.
 */
export async function drainPushDispatchOutbox(outbox: PushDispatchOutbox): Promise<void> {
  const queue = outbox.staged.slice();
  outbox.staged.length = 0;
  await Promise.all(queue.map((params) => dispatchPushNotification(params)));
}
