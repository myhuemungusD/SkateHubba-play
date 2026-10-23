import { doc, collection, serverTimestamp, writeBatch } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

export type ReportReason =
  | "inappropriate_video"
  | "inappropriate"
  | "abusive_behavior"
  | "cheating"
  | "spam"
  | "non_skate_content"
  | "not_skating"
  | "illegal_content"
  | "other";

/** DSA Art. 16 notices have to explain what is illegal. Shorter text is rejected. */
export const ILLEGAL_CONTENT_MIN_EXPLANATION = 20;

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  inappropriate_video: "Inappropriate video content",
  inappropriate: "Inappropriate",
  abusive_behavior: "Abusive or threatening behavior",
  cheating: "Cheating or exploiting",
  spam: "Spam or bot activity",
  // Distinct from "inappropriate": the clip is fine, it just isn't
  // skateboarding. Kept so older reports still label correctly.
  non_skate_content: "Not skateboarding",
  not_skating: "Not skating",
  illegal_content: "Illegal content",
  other: "Other",
};

/** Reasons that make sense for one written comment (no video or gameplay reasons). */
export const COMMENT_REPORT_REASONS: readonly ReportReason[] = [
  "inappropriate",
  "abusive_behavior",
  "spam",
  "illegal_content",
  "other",
];

export interface SubmitReportParams {
  reporterUid: string;
  reportedUid: string;
  reportedUsername: string;
  /**
   * Game the report was filed from, or `null` when there isn't one — a
   * user-posted clip belongs to no game. `clipId` identifies the target in
   * that case, and the written doc carries `gameId: null` rather than
   * omitting the field so the moderation queue can distinguish "no game"
   * from a doc that lost the field.
   */
  gameId?: string | null;
  reason: ReportReason;
  description: string;
  /**
   * Optional id of the specific clip being reported. Passed from the feed's
   * report button so moderators can action a single video instead of the
   * whole game. Shape matches clips.ts deterministic id
   * (`${gameId}_${turnNumber}_${role}`).
   */
  clipId?: string;
  /**
   * Community dispute this report is about. The admin queue uses it to hide
   * the dispute. It never auto-hides a video: dispute and game videos stay
   * up until a person takes them down.
   */
  disputeId?: string;
  /** Spot a reported spot comment belongs to (no game, no clip). */
  spotId?: string;
  /**
   * A single comment under `clipId` or `spotId` (clips/{clipId}/comments/{id}). The text
   * is snapshotted so the moderator still sees what was said if the author
   * deletes it before review. Requires `clipId` or `spotId`.
   */
  comment?: { id: string; text: string };
  /**
   * Report the player themselves, filed from their profile. There is no game,
   * clip or spot to point at, so the doc carries `target: "profile"` and
   * `gameId: null` instead.
   */
  profile?: boolean;
  /**
   * A single spot-chat message (spots/{spotId}/messages/{id}). Needs `spotId`
   * and can't be combined with `clipId` or `comment`. The text is snapshotted
   * like a comment's, so the moderator sees it even after the message changes.
   */
  message?: { id: string; text: string };
}

/** Same bound as a comment body (firestore.rules clip comments: 1–300 chars). */
const COMMENT_TEXT_MAX = 300;
/** Same bound as a spot-chat message body (firestore.rules spot messages: 1–500 chars). */
const MESSAGE_TEXT_MAX = 500;

function optionalTargetId(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes("/")) throw new Error("That report target is not valid.");
  return trimmed.slice(0, 128);
}

/**
 * Submit a content/player report to the `reports` collection.
 *
 * Rate-limited server-side: one report per (reporter, reported) pair per
 * 1 hour. Enforced via a companion write to
 * `reports_limits/{reporterUid}_{reportedUid}` in the SAME batch — the
 * Firestore rule uses `getAfter()` to verify the limit doc's `lastSentAt`
 * is pinned to `request.time`, and `get()` to verify the previous report
 * was more than 1 hour ago. No client-query bypass possible.
 */
export async function submitReport(params: SubmitReportParams): Promise<string> {
  const {
    reporterUid,
    reportedUid,
    reportedUsername,
    gameId,
    reason,
    description,
    clipId,
    disputeId,
    spotId,
    comment,
    profile,
    message,
  } = params;

  if (!reason) throw new Error("Please select a reason for your report.");
  if (reporterUid === reportedUid) throw new Error("You cannot report yourself.");
  // A report that identifies neither a game nor a clip gives moderators
  // nothing to look at.
  const targetGameId = typeof gameId === "string" && gameId.length > 0 ? gameId : null;
  const targetClipId = typeof clipId === "string" && clipId.length > 0 ? clipId.slice(0, 128) : null;
  const targetDisputeId = optionalTargetId(disputeId);
  const targetSpotId = optionalTargetId(spotId);
  if (targetGameId === null && targetClipId === null && targetSpotId === null && profile !== true) {
    throw new Error("Nothing to report — no game, clip, spot or player was identified.");
  }
  if (
    comment &&
    // Exactly one parent: the comment lives under a clip or a spot, never both.
    ((targetClipId === null) === (targetSpotId === null) || comment.id.length === 0 || comment.id.includes("/"))
  ) {
    throw new Error("That report target is not valid.");
  }
  if (
    message &&
    // A chat message lives under a spot only, and is never also a comment.
    (targetSpotId === null ||
      targetClipId !== null ||
      comment !== undefined ||
      message.id.length === 0 ||
      message.id.includes("/"))
  ) {
    throw new Error("That report target is not valid.");
  }
  const trimmedDescription = description.trim().slice(0, 500);
  if (reason === "illegal_content" && trimmedDescription.length < ILLEGAL_CONTENT_MIN_EXPLANATION) {
    throw new Error("Illegal-content reports need an explanation of at least 20 characters.");
  }

  try {
    const db = requireDb();
    const reportRef = doc(collection(db, "reports"));
    const limitRef = doc(db, "reports_limits", `${reporterUid}_${reportedUid}`);

    const payload: Record<string, unknown> = {
      reporterUid,
      reportedUid,
      reportedUsername,
      gameId: targetGameId,
      reason,
      description: trimmedDescription,
      status: "pending",
      createdAt: serverTimestamp(),
    };
    if (targetClipId !== null) {
      payload.clipId = targetClipId;
    }
    if (targetDisputeId !== null) {
      payload.disputeId = targetDisputeId;
    }
    if (targetSpotId !== null) {
      payload.spotId = targetSpotId;
    }
    if (comment) {
      payload.commentId = comment.id.slice(0, 128);
      payload.commentText = comment.text.slice(0, COMMENT_TEXT_MAX);
    }
    if (message) {
      payload.messageId = message.id.slice(0, 128);
      payload.messageText = message.text.slice(0, MESSAGE_TEXT_MAX);
    }
    if (profile === true) {
      payload.target = "profile";
    }

    // Atomic batch: report + companion cooldown anchor. The rule requires
    // both writes land in the same commit (getAfter() on the limit doc).
    // `set` (without merge) handles both the first-ever report and a
    // subsequent one past the 1h cooldown — the reports_limits update rule
    // gates the cooldown refresh, and the create rule gates the first
    // insertion; Firestore auto-dispatches based on existence.
    const batch = writeBatch(db);
    batch.set(reportRef, payload);
    batch.set(limitRef, {
      reporterUid,
      reportedUid,
      lastSentAt: serverTimestamp(),
    });
    await batch.commit();

    return reportRef.id;
  } catch (err) {
    logger.warn("report_submit_failed", {
      reporterUid,
      gameId: targetGameId,
      error: parseFirebaseError(err),
    });
    throw new Error("Failed to submit report. Please try again.");
  }
}
