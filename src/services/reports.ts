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
}

function optionalDisputeId(value: string | undefined): string | null {
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
  const { reporterUid, reportedUid, reportedUsername, gameId, reason, description, clipId, disputeId } = params;

  if (!reason) throw new Error("Please select a reason for your report.");
  if (reporterUid === reportedUid) throw new Error("You cannot report yourself.");
  // A report that identifies neither a game nor a clip gives moderators
  // nothing to look at.
  const targetGameId = typeof gameId === "string" && gameId.length > 0 ? gameId : null;
  const targetClipId = typeof clipId === "string" && clipId.length > 0 ? clipId.slice(0, 128) : null;
  const targetDisputeId = optionalDisputeId(disputeId);
  if (targetGameId === null && targetClipId === null) {
    throw new Error("Nothing to report — no game or clip was identified.");
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
