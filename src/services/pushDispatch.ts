/**
 * Push dispatch — server-side wake-up for offline recipients.
 *
 * The in-app /notifications collection only reaches users whose tab is open
 * (Firestore onSnapshot in GameNotificationWatcher). For an async game,
 * "your opponent moved" needs to wake the OS notification center on a
 * device that hasn't loaded the app in hours or days. That requires the
 * FCM HTTP API, which is OAuth2-gated and cannot be called from a client.
 *
 * The dispatcher is the `firebase/firestore-send-fcm` Firebase Extension
 * (configured in `extensions/firestore-send-fcm.env` and `firebase.json`).
 * It triggers on creates in /push_dispatch/{id}, reads `tokens`, `notification`,
 * and `data` from the doc, calls the FCM API server-side, and cleans up
 * stale tokens on `messaging/registration-token-not-registered`.
 *
 * Why a SEPARATE collection from /notifications:
 *  - /notifications carries user-visible feed entries. Schema is stable
 *    (recipientUid + title + body + read flag) and consumed by the in-app
 *    listener. Pushing the extension's wire format (tokens, notification,
 *    data) into the same doc would couple two unrelated lifecycles.
 *  - /push_dispatch is fire-and-forget. The extension processes the doc and
 *    can be configured to delete-on-success. Notifications are NOT deleted
 *    on read — they persist in the feed until the user clears them.
 *
 * Tokens live at /pushTargets/{uid} — a mirror of users/{uid}/private/profile
 * .fcmTokens that's READABLE by signed-in users. The mirror exists because
 * tokens cannot stay owner-only AND be embeddable in a dispatch doc by a
 * sender. The privacy regression is bounded: FCM tokens alone cannot be
 * abused without server credentials (the extension owns the only legitimate
 * dispatch surface), and the /push_dispatch create rule still requires the
 * sender to be a game participant — so a leaked token can't be turned into
 * an attack vector by another authenticated user.
 *
 * Best-effort by design. A failed dispatch never blocks the originating
 * game action — the recipient still gets the in-app notification via
 * /notifications onSnapshot the next time they open the tab.
 */

import { collection, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import type { NotificationDocType } from "./notifications";

export interface PushDispatchParams {
  senderUid: string;
  recipientUid: string;
  type: NotificationDocType;
  title: string;
  body: string;
  gameId: string;
}

/* ────────────────────────────────────────────
 * Push-target mirror (tokens collection)
 * ──────────────────────────────────────────── */

/**
 * Collection path for the cross-readable token mirror. One doc per user,
 * keyed by uid. Kept top-level (not nested under /users/{uid}) so the rules
 * stay short and the reader doesn't accidentally inherit /users/{uid}
 * permissions on adjacent fields.
 */
export const PUSH_TARGETS_COLLECTION = "pushTargets" as const;

/**
 * Collection path the Firebase Extension watches. Matches the value of
 * COLLECTION_PATH in extensions/firestore-send-fcm.env — if you rename
 * one, rename the other in lockstep.
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

interface PushTargetsDoc {
  tokens: string[];
}

/**
 * Read the cross-readable token mirror for a user. Returns the deduplicated
 * token list, or [] if no mirror exists yet (no devices registered, or the
 * user signed up before the mirror was introduced).
 */
export async function getRecipientPushTokens(uid: string): Promise<string[]> {
  try {
    const snap = await getDoc(doc(requireDb(), PUSH_TARGETS_COLLECTION, uid));
    if (!snap.exists()) return [];
    const data = snap.data() as Partial<PushTargetsDoc>;
    const tokens = Array.isArray(data.tokens) ? data.tokens : [];
    // Filter non-string entries defensively — Firestore preserves array
    // shape but a malicious or legacy writer could have stuffed nulls in.
    return tokens.filter((t): t is string => typeof t === "string" && t.length > 0);
  } catch (err) {
    logger.warn("push_targets_read_failed", { uid, error: parseFirebaseError(err) });
    return [];
  }
}

/* ────────────────────────────────────────────
 * Dispatch
 * ──────────────────────────────────────────── */

/**
 * Cap on tokens per dispatch doc. Matches the per-user fcmTokens cap in
 * firestore.rules (≤10) so the worst-case fan-out is bounded: even if the
 * recipient signed in on every device they own, one game event triggers
 * at most 10 FCM API calls via the extension.
 */
const MAX_TOKENS_PER_DISPATCH = 10;

/**
 * Hard caps on user-visible strings, mirrored on the /push_dispatch create
 * rule. The extension forwards these verbatim to FCM; without caps a
 * malicious sender could wedge multi-megabyte payloads through and burn
 * the recipient's quota.
 */
const MAX_TITLE_LEN = 80;
const MAX_BODY_LEN = 200;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Build the dispatch doc shape consumed by `firebase/firestore-send-fcm`.
 * The extension reads `tokens`, `notification.{title,body}`, and `data` —
 * everything else (senderUid, recipientUid, gameId, type) is metadata used
 * by firestore.rules to enforce write permissions and rate limits.
 *
 * `data.gameId` is what the service worker's notificationclick handler
 * (public/firebase-messaging-sw.js) reads to deep-link into the right game.
 */
function buildDispatchDoc(params: PushDispatchParams, tokens: string[]): Record<string, unknown> {
  return {
    // Extension contract
    tokens,
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
 * Dispatch a single push notification to the recipient's registered devices.
 * No-ops (without error) when the recipient has no tokens — common during
 * the rollout window before users have granted notification permission.
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
  const allTokens = await getRecipientPushTokens(params.recipientUid);
  if (allTokens.length === 0) return;

  // De-duplicate then cap. A user with a stale token list (>10 from before
  // a rules tighten or a manual cleanup) should still get a push.
  const unique = Array.from(new Set(allTokens));
  const tokens = unique.slice(0, MAX_TOKENS_PER_DISPATCH);

  try {
    const db = requireDb();
    const dispatchRef = doc(collection(db, PUSH_DISPATCH_COLLECTION));
    const limitRef = doc(db, PUSH_DISPATCH_LIMITS_COLLECTION, dispatchLimitKey(params));

    const batch = writeBatch(db);
    batch.set(dispatchRef, buildDispatchDoc(params, tokens));
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
 * Why not inside the tx? `dispatchPushNotification` reads /pushTargets and
 * writes /push_dispatch — neither belongs in a game tx. The push is a
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
