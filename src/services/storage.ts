import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { requireStorage } from "../firebase";
import { analytics } from "./analytics";
import { metrics } from "./logger";

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
 *
 * Uses uploadBytesResumable for real-time progress tracking.
 * Retries with exponential backoff on transient failures.
 */
/** Minimum upload size (1 KB) — must match storage.rules */
const MIN_UPLOAD_BYTES = 1024;
/** Maximum upload size (50 MB) — must match storage.rules */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Base delay for exponential backoff on upload retries */
const RETRY_BACKOFF_MS = 1000;

export async function uploadVideo(
  gameId: string,
  turnNumber: number,
  role: "set" | "match",
  blob: Blob,
  onProgress?: (progress: UploadProgress) => void,
  maxRetries = 2,
): Promise<string> {
  // Pre-validate size to fail fast before wasting bandwidth.
  // These limits mirror the Firebase Storage security rules.
  if (blob.size < MIN_UPLOAD_BYTES) {
    throw new Error("Video is too small to upload. Please record a longer clip.");
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error("Video exceeds the 50 MB limit. Please record a shorter clip.");
  }

  // Determine file extension from the blob's MIME type.
  // Native (Capacitor) recordings produce mp4; web recordings produce webm.
  const ext = blob.type.includes("mp4") ? "mp4" : "webm";
  const contentType = ext === "mp4" ? "video/mp4" : "video/webm";
  const path = `games/${gameId}/turn-${turnNumber}/${role}.${ext}`;
  const storageRef = ref(requireStorage(), path);
  const startTime = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, blob, {
          contentType,
          customMetadata: {
            gameId,
            turn: String(turnNumber),
            role,
            uploadedAt: new Date().toISOString(),
            // Retention hint: videos older than 90 days may be purged by a
            // scheduled Cloud Function or a Storage lifecycle rule.
            retainUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
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
      metrics.videoUploaded(gameId, blob.size, Date.now() - startTime);
      return url;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      // Exponential backoff: 1s, 2s
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt + 1)));
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error("Upload failed after retries");
}
