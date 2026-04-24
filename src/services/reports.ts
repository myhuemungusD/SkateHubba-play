import { doc, collection, serverTimestamp, writeBatch } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

export type ReportReason = "inappropriate_video" | "abusive_behavior" | "cheating" | "spam" | "other";

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  inappropriate_video: "Inappropriate video content",
  abusive_behavior: "Abusive or threatening behavior",
  cheating: "Cheating or exploiting",
  spam: "Spam or bot activity",
  other: "Other",
};

interface SubmitReportParams {
  reporterUid: string;
  reportedUid: string;
  reportedUsername: string;
  gameId: string;
  reason: ReportReason;
  description: string;
  /**
   * Optional id of the specific clip being reported. Passed from the feed's
   * report button so moderators can action a single video instead of the
   * whole game. Shape matches clips.ts deterministic id
   * (`${gameId}_${turnNumber}_${role}`).
   */
  clipId?: string;
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
  const { reporterUid, reportedUid, reportedUsername, gameId, reason, description, clipId } = params;

  if (!reason) throw new Error("Please select a reason for your report.");
  if (reporterUid === reportedUid) throw new Error("You cannot report yourself.");

  try {
    const db = requireDb();
    const reportRef = doc(collection(db, "reports"));
    const limitRef = doc(db, "reports_limits", `${reporterUid}_${reportedUid}`);

    const payload: Record<string, unknown> = {
      reporterUid,
      reportedUid,
      reportedUsername,
      gameId,
      reason,
      description: description.trim().slice(0, 500),
      status: "pending",
      createdAt: serverTimestamp(),
    };
    if (typeof clipId === "string" && clipId.length > 0) {
      payload.clipId = clipId.slice(0, 128);
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
      gameId,
      error: parseFirebaseError(err),
    });
    throw new Error("Failed to submit report. Please try again.");
  }
}
