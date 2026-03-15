import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { requireStorage } from "../firebase";
import { withRetry } from "../utils/retry";

/**
 * Upload a video blob to Firebase Storage and return the download URL.
 *
 * Path: games/{gameId}/turn-{turnNumber}/{role}.webm
 * role = "set" | "match"
 */
export async function uploadVideo(
  gameId: string,
  turnNumber: number,
  role: "set" | "match",
  blob: Blob
): Promise<string> {
  const path = `games/${gameId}/turn-${turnNumber}/${role}.webm`;
  const storageRef = ref(requireStorage(), path);

  // Retry up to 3 times with exponential backoff — mobile networks are unreliable
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

  return withRetry(() => getDownloadURL(storageRef));
}
