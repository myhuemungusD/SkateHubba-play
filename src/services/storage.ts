import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { requireStorage } from "../firebase";
import { analytics } from "./analytics";

export interface UploadProgress {
  bytesTransferred: number;
  totalBytes: number;
  percent: number;
}

/**
 * Upload a video blob to Firebase Storage with progress tracking and retry.
 *
 * Path: games/{gameId}/turn-{turnNumber}/{role}.webm
 * role = "set" | "match"
 */
export async function uploadVideo(
  gameId: string,
  turnNumber: number,
  role: "set" | "match",
  blob: Blob,
  onProgress?: (progress: UploadProgress) => void,
  maxRetries = 2,
): Promise<string> {
  const path = `games/${gameId}/turn-${turnNumber}/${role}.webm`;
  const storageRef = ref(requireStorage(), path);
  const startTime = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, blob, {
          contentType: "video/webm",
          customMetadata: {
            gameId,
            turn: String(turnNumber),
            role,
            uploadedAt: new Date().toISOString(),
          },
        });

        task.on(
          "state_changed",
          (snapshot) => {
            if (onProgress) {
              onProgress({
                bytesTransferred: snapshot.bytesTransferred,
                totalBytes: snapshot.totalBytes,
                percent:
                  snapshot.totalBytes > 0 ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100) : 0,
              });
            }
          },
          (error) => reject(error),
          async () => {
            try {
              const downloadUrl = await getDownloadURL(task.snapshot.ref);
              resolve(downloadUrl);
            } catch (err) {
              reject(err);
            }
          },
        );
      });

      analytics.videoUploaded(Date.now() - startTime, blob.size);
      return url;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      // Exponential backoff: 1s, 2s
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error("Upload failed after retries");
}
