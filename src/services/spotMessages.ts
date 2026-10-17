/**
 * Spot group chat service.
 *
 * Per-spot message threads where skaters can coordinate sessions, share beta,
 * and discuss the spot. Messages live under spots/{spotId}/messages/{messageId}
 * and are readable by all signed-in users.
 *
 * Moderation:
 *  - Word filter (client + server via Firestore rules)
 *  - Rate limit: 1 message per 3 seconds per user per spot (client + rules)
 *  - Report flow: users can report messages; admins can hide/unhide
 *  - Block enforcement: blocked users' messages are hidden from the blocker
 */

import {
  collection,
  doc,
  addDoc,
  query,
  orderBy,
  limit as limitFn,
  onSnapshot,
  serverTimestamp,
  where,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import type { SpotMessage, SpotMessageReport } from "../types/spotMessage";
import { logger } from "./logger";
import { captureException } from "../lib/sentry";
import { parseFirebaseError } from "../utils/helpers";
import { checkWordFilter } from "../utils/wordFilter";

/* ────────────────────────────────────────────
 * Constants
 * ──────────────────────────────────────────── */

/** Message content max length. */
const MAX_MESSAGE_LENGTH = 500;

/** Client-side rate limit: 1 message per spot per 3 seconds. */
const MESSAGE_COOLDOWN_MS = 3_000;

/** Default message page size. */
const DEFAULT_MESSAGE_LIMIT = 50;

/** Canonical UUID shape for spotId validation. */
const SPOT_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ────────────────────────────────────────────
 * Rate limiting (client-side defense in depth)
 * ──────────────────────────────────────────── */

/** Map of spotId -> last message timestamp. */
const lastMessageTimestamps = new Map<string, number>();

/** @internal Reset rate-limit state (for tests only). */
export function _resetMessageRateLimit(): void {
  lastMessageTimestamps.clear();
}

function checkRateLimit(spotId: string): string | null {
  const now = Date.now();
  const last = lastMessageTimestamps.get(spotId);
  if (last && now - last < MESSAGE_COOLDOWN_MS) {
    const waitSeconds = Math.ceil((MESSAGE_COOLDOWN_MS - (now - last)) / 1000);
    return `Please wait ${waitSeconds}s before sending another message`;
  }
  return null;
}

function recordMessageSent(spotId: string): void {
  lastMessageTimestamps.set(spotId, Date.now());
}

/* ────────────────────────────────────────────
 * Refs
 * ──────────────────────────────────────────── */

function messagesRef(spotId: string) {
  return collection(requireDb(), "spots", spotId, "messages");
}

function messageReportsRef() {
  return collection(requireDb(), "spotMessageReports");
}

/* ────────────────────────────────────────────
 * Doc parsers
 * ──────────────────────────────────────────── */

function timestampToIso(v: unknown): string {
  if (v && typeof v === "object" && "toDate" in v) {
    const toDate = (v as { toDate: unknown }).toDate;
    if (typeof toDate === "function") {
      const d = toDate.call(v);
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return new Date().toISOString();
}

function toMessage(spotId: string, snap: { id: string; data: () => Record<string, unknown> }): SpotMessage {
  const raw = snap.data();
  if (typeof raw.userId !== "string" || typeof raw.content !== "string" || typeof raw.isHidden !== "boolean") {
    throw new Error(`Malformed spot message document: ${snap.id}`);
  }
  return {
    id: snap.id,
    spotId,
    userId: raw.userId,
    content: raw.content,
    createdAt: timestampToIso(raw.createdAt),
    isHidden: raw.isHidden,
    hiddenReason:
      typeof raw.hiddenReason === "string" && ["word_filter", "reported", "user_blocked"].includes(raw.hiddenReason)
        ? (raw.hiddenReason as SpotMessage["hiddenReason"])
        : undefined,
  };
}

/* ────────────────────────────────────────────
 * Send message
 * ──────────────────────────────────────────── */

export interface SendSpotMessageOptions {
  spotId: string;
  userId: string;
  content: string;
}

/**
 * Send a message to a spot's group chat.
 *
 * Validates content length, checks word filter, enforces client-side rate limit.
 * The message is written with isHidden=true if the word filter catches it.
 * Firestore rules enforce the same rate limit and word filter server-side.
 */
export async function sendSpotMessage(options: SendSpotMessageOptions): Promise<SpotMessage> {
  const { spotId, userId, content } = options;

  if (!SPOT_ID_SHAPE.test(spotId)) {
    throw new Error("Invalid spot ID");
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error("Message cannot be empty");
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message must be ${MAX_MESSAGE_LENGTH} characters or less`);
  }

  // Client-side rate limit
  const rateLimitError = checkRateLimit(spotId);
  if (rateLimitError) {
    throw new Error(rateLimitError);
  }

  // Word filter
  const flaggedWord = checkWordFilter(trimmed);
  const isHidden = flaggedWord !== null;

  const payload = {
    userId,
    content: trimmed,
    createdAt: serverTimestamp(),
    isHidden,
    ...(isHidden && { hiddenReason: "word_filter" as const }),
  };

  try {
    // Atomic message write + rate limit anchor (Firestore rules require both)
    const db = requireDb();
    const batch = writeBatch(db);
    const messageRef = doc(messagesRef(spotId));
    batch.set(messageRef, payload);
    batch.set(doc(db, "users", userId), { lastSpotMessageAt: serverTimestamp() }, { merge: true });
    await batch.commit();

    recordMessageSent(spotId);

    if (flaggedWord) {
      logger.info("spot_message_word_filter", { spotId, userId, flaggedWord });
    } else {
      logger.info("spot_message_sent", { spotId, userId });
    }

    // Optimistic return
    return {
      id: messageRef.id,
      spotId,
      userId,
      content: trimmed,
      createdAt: new Date().toISOString(),
      isHidden,
      hiddenReason: isHidden ? "word_filter" : undefined,
    };
  } catch (err) {
    logger.error("spot_message_send_failed", { spotId, userId, error: parseFirebaseError(err) });
    captureException(err, { tags: { op: "sendSpotMessage" }, extra: { spotId } });
    throw err;
  }
}

/* ────────────────────────────────────────────
 * Subscribe to messages
 * ──────────────────────────────────────────── */

export interface SubscribeToSpotMessagesOptions {
  spotId: string;
  limit?: number;
  onMessages: (messages: SpotMessage[]) => void;
  onError?: (error: Error) => void;
}

/**
 * Subscribe to real-time spot messages, newest first.
 *
 * The callback receives the full message list on every update. Messages with
 * isHidden=true are included — the caller decides whether to render them based
 * on context (admin console shows all, normal users hide flagged messages).
 */
export function subscribeToSpotMessages(options: SubscribeToSpotMessagesOptions): Unsubscribe {
  const { spotId, limit = DEFAULT_MESSAGE_LIMIT, onMessages, onError } = options;

  if (!SPOT_ID_SHAPE.test(spotId)) {
    throw new Error("Invalid spot ID");
  }

  const q = query(messagesRef(spotId), orderBy("createdAt", "desc"), limitFn(limit));

  return onSnapshot(
    q,
    (snapshot) => {
      const messages: SpotMessage[] = [];
      for (const docSnap of snapshot.docs) {
        try {
          messages.push(toMessage(spotId, docSnap));
        } catch (err) {
          logger.warn("malformed_spot_message", {
            spotId,
            docId: docSnap.id,
            error: parseFirebaseError(err),
          });
        }
      }
      onMessages(messages);
    },
    (err) => {
      logger.error("spot_messages_subscription_error", {
        spotId,
        error: parseFirebaseError(err),
      });
      if (onError) {
        onError(err as Error);
      } else {
        captureException(err, { tags: { op: "subscribeToSpotMessages" }, extra: { spotId } });
      }
    },
  );
}

/* ────────────────────────────────────────────
 * Report message
 * ──────────────────────────────────────────── */

export interface ReportSpotMessageOptions {
  messageId: string;
  spotId: string;
  reportedBy: string;
  reason: SpotMessageReport["reason"];
  details?: string;
}

/**
 * Report a spot message for moderation review.
 *
 * Creates a report document that admins can review in the admin console.
 * Does not automatically hide the message — that requires admin action.
 */
export async function reportSpotMessage(options: ReportSpotMessageOptions): Promise<void> {
  const { messageId, spotId, reportedBy, reason, details } = options;

  if (!SPOT_ID_SHAPE.test(spotId)) {
    throw new Error("Invalid spot ID");
  }

  if (!messageId || typeof messageId !== "string") {
    throw new Error("Invalid message ID");
  }

  // Verify the message exists
  const messageSnap = await getDoc(doc(requireDb(), "spots", spotId, "messages", messageId));
  if (!messageSnap.exists()) {
    throw new Error("Message not found");
  }

  const payload = {
    messageId,
    spotId,
    reportedBy,
    reason,
    details: details?.trim() || null,
    createdAt: serverTimestamp(),
    status: "pending" as const,
  };

  try {
    await addDoc(messageReportsRef(), payload);
    logger.info("spot_message_reported", { messageId, spotId, reportedBy, reason });
  } catch (err) {
    logger.error("spot_message_report_failed", {
      messageId,
      spotId,
      reportedBy,
      error: parseFirebaseError(err),
    });
    captureException(err, { tags: { op: "reportSpotMessage" }, extra: { messageId, spotId } });
    throw err;
  }
}

/* ────────────────────────────────────────────
 * Admin: hide/unhide message
 * ──────────────────────────────────────────── */

/**
 * Hide a message (admin only).
 *
 * Sets isHidden=true and hiddenReason='reported'. Firestore rules enforce
 * the admin claim check — this function is a thin wrapper for the UI.
 */
export async function hideSpotMessage(spotId: string, messageId: string): Promise<void> {
  if (!SPOT_ID_SHAPE.test(spotId)) {
    throw new Error("Invalid spot ID");
  }

  try {
    await setDoc(
      doc(requireDb(), "spots", spotId, "messages", messageId),
      {
        isHidden: true,
        hiddenReason: "reported",
      },
      { merge: true },
    );
    logger.info("spot_message_hidden", { spotId, messageId });
  } catch (err) {
    logger.error("spot_message_hide_failed", {
      spotId,
      messageId,
      error: parseFirebaseError(err),
    });
    throw err;
  }
}

/**
 * Unhide a message (admin only).
 *
 * Sets isHidden=false and clears hiddenReason. Firestore rules enforce the
 * admin claim check.
 */
export async function unhideSpotMessage(spotId: string, messageId: string): Promise<void> {
  if (!SPOT_ID_SHAPE.test(spotId)) {
    throw new Error("Invalid spot ID");
  }

  try {
    await setDoc(
      doc(requireDb(), "spots", spotId, "messages", messageId),
      {
        isHidden: false,
        hiddenReason: null,
      },
      { merge: true },
    );
    logger.info("spot_message_unhidden", { spotId, messageId });
  } catch (err) {
    logger.error("spot_message_unhide_failed", {
      spotId,
      messageId,
      error: parseFirebaseError(err),
    });
    throw err;
  }
}

/* ────────────────────────────────────────────
 * Fetch message reports (admin console)
 * ──────────────────────────────────────────── */

/**
 * Fetch all pending message reports (admin only).
 *
 * Returns reports ordered by creation time, newest first.
 */
export async function fetchPendingMessageReports(): Promise<SpotMessageReport[]> {
  const q = query(messageReportsRef(), where("status", "==", "pending"), orderBy("createdAt", "desc"), limitFn(100));

  try {
    const snapshot = await getDocs(q);
    const reports: SpotMessageReport[] = [];
    for (const docSnap of snapshot.docs) {
      const raw = docSnap.data();
      if (
        typeof raw.messageId === "string" &&
        typeof raw.spotId === "string" &&
        typeof raw.reportedBy === "string" &&
        typeof raw.reason === "string" &&
        typeof raw.status === "string"
      ) {
        reports.push({
          id: docSnap.id,
          messageId: raw.messageId,
          spotId: raw.spotId,
          reportedBy: raw.reportedBy,
          reason: raw.reason as SpotMessageReport["reason"],
          details: typeof raw.details === "string" ? raw.details : undefined,
          createdAt: timestampToIso(raw.createdAt),
          status: raw.status as SpotMessageReport["status"],
        });
      }
    }
    return reports;
  } catch (err) {
    logger.error("fetch_message_reports_failed", { error: parseFirebaseError(err) });
    captureException(err, { tags: { op: "fetchPendingMessageReports" } });
    return [];
  }
}
