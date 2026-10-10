import { decideFromAnnotation, type VideoAnnotation } from "./decide.js";
import { failurePatch, shouldApplyUploadDecision, uploadPatch, type SaveGuard } from "./patches.js";
import type { StatementOfReasons } from "./statement.js";
import { storageUriFromDownloadUrl } from "./uri.js";

export type UploadOutcome = "skipped" | "approved" | "review" | "rejected";

export interface UploadModerationInput {
  enabled: boolean;
  clipId: string;
  clip: Record<string, unknown> | undefined;
  annotate: (gcsUri: string) => Promise<VideoAnnotation>;
  save: (patch: Record<string, unknown>, guard: SaveGuard) => Promise<boolean>;
  notify: (ownerUid: string, statement: StatementOfReasons) => Promise<void>;
  capture: (error: unknown, extra: Record<string, string>) => Promise<void>;
}

async function alert(input: UploadModerationInput, error: unknown): Promise<void> {
  try {
    await input.capture(error, { clipId: input.clipId });
  } catch (captureError) {
    console.warn("moderation_sentry_failed", {
      clipId: input.clipId,
      error: captureError instanceof Error ? captureError.message : "sentry failed",
    });
  }
}

/**
 * Screen one newly created public clip.
 *
 * Does nothing unless the server switch is on and the clip is a user upload
 * still marked pending. An API error, a timeout, or a video we cannot read
 * sends the clip to review. It is never approved on a failure.
 */
export async function runUploadModeration(input: UploadModerationInput): Promise<UploadOutcome> {
  if (!input.enabled) return "skipped";
  const clip = input.clip;
  if (!clip || clip.source !== "user" || !shouldApplyUploadDecision(clip.moderation)) return "skipped";

  const videoUrl = typeof clip.videoUrl === "string" ? clip.videoUrl : "";
  const gcsUri = storageUriFromDownloadUrl(videoUrl);
  const ownerUid = typeof clip.playerUid === "string" ? clip.playerUid : "";

  const sendToReview = async (message: string): Promise<UploadOutcome> => {
    const built = failurePatch(message);
    await input.save(built.patch, built.guard);
    return "review";
  };

  if (!gcsUri) {
    await alert(input, new Error("clip video is not in Cloud Storage"));
    return sendToReview("unreadable video url");
  }

  try {
    const annotation = await input.annotate(gcsUri);
    const decision = decideFromAnnotation(annotation);
    const built = uploadPatch(input.clipId, decision);
    const applied = await input.save(built.patch, built.guard);
    if (applied && built.statement && ownerUid.length > 0) {
      await input.notify(ownerUid, built.statement);
    }
    return applied ? decision.decision : "skipped";
  } catch (error) {
    await alert(input, error);
    const message = error instanceof Error ? error.message : "video intelligence failed";
    return sendToReview(message);
  }
}
