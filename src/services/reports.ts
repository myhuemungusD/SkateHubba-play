import { addDoc, collection, serverTimestamp } from "firebase/firestore";
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
 * Rate-limited: one report per game per reporter. The client checks for an
 * existing report before writing; Firestore rules enforce this server-side.
 */
export async function submitReport(params: SubmitReportParams): Promise<string> {
  const { reporterUid, reportedUid, reportedUsername, gameId, reason, description, clipId } = params;

  if (!reason) throw new Error("Please select a reason for your report.");
  if (reporterUid === reportedUid) throw new Error("You cannot report yourself.");

  try {
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
    const docRef = await addDoc(collection(requireDb(), "reports"), payload);
    return docRef.id;
  } catch (err) {
    logger.warn("report_submit_failed", {
      reporterUid,
      gameId,
      error: parseFirebaseError(err),
    });
    throw new Error("Failed to submit report. Please try again.");
  }
}
