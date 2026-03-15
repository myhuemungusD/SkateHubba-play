import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { requireStorage } from "../firebase";
import { withRetry } from "../utils/retry";

/**
 * Upload a video blob to Firebase Storage and return the download URL.
 *
 * Path: games/{gameId}/turn-{turnNumber}/{role}.webm
 * role = "set" | "match"
 *
 * The upload and the URL fetch are kept as separate retry scopes:
 * - If the upload itself fails transiently, we retry the full upload.
 * - If the upload succeeds but getDownloadURL fails, we retry only the URL
 *   fetch — the blob is already safely in Storage and we don't re-upload it.
 * This prevents a double-upload when only the URL fetch was flaky.
 */
export async function uploadVideo(
  gameId: string,
  turnNumber: number,
  role: "set" | "match",
  blob: Blob
): Promise<string> {
  const path = `games/${gameId}/turn-${turnNumber}/${role}.webm`;
  const storageRef = ref(requireStorage(), path);

  // Retry the upload up to 3 times with exponential backoff.
  // Mobile networks are unreliable; Storage write is idempotent for the same path.
  await withRetry(() =>
    uploadBytes(storageRef, blob, {
      contentType: "video/webm",
      customMetadata: {
        gameId,
        turn: String(turnNumber),
        role,
        uploadedAt: new Date().toISOString(),
        // Retention hint: videos older than 90 days may be purged by a
        // scheduled Cloud Function or a Storage lifecycle rule.
        retainUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      },
    })
  );

  // The blob is now in Storage regardless of what happens next.
  // Retry getDownloadURL separately — if this fails the video is not lost;
  // the caller can re-derive the URL from the known path if needed.
  return withRetry(() => getDownloadURL(storageRef));
}
