import { ref, uploadBytesResumable, getDownloadURL, deleteObject, listAll } from "firebase/storage";
import { requireStorage } from "../firebase";
import { analytics } from "./analytics";
import { logger, metrics } from "./logger";

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

/**
 * Delete all video files for a specific game.
 * Walks the games/{gameId}/ prefix in Storage and deletes every object found.
 * Best-effort: logs failures but does not throw (caller handles cleanup).
 */
export async function deleteGameVideos(gameId: string): Promise<number> {
  const storage = requireStorage();
  const gameRef = ref(storage, `games/${gameId}`);
  let deleted = 0;

  try {
    const listResult = await listAll(gameRef);

    // listAll returns prefixes (subdirectories) — recurse into turn-N folders
    const subResults = await Promise.all(listResult.prefixes.map((prefix) => listAll(prefix)));

    const allItems = [...listResult.items, ...subResults.flatMap((r) => r.items)];

    await Promise.all(
      allItems.map((item) =>
        deleteObject(item)
          .then(() => {
            deleted++;
          })
          .catch((err) => {
            logger.warn("video_delete_failed", {
              path: item.fullPath,
              error: err instanceof Error ? err.message : String(err),
            });
          }),
      ),
    );
  } catch (err) {
    // listAll may fail if the prefix doesn't exist — this is fine
    logger.warn("video_list_failed", {
      gameId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return deleted;
}

/** Minimum duration in seconds for a valid video clip. */
export const MIN_VIDEO_DURATION_S = 0.5;
/** Maximum duration in seconds for a valid video clip. */
export const MAX_VIDEO_DURATION_S = 120;

/**
 * Validate a video blob before upload.
 * Checks file format magic bytes and optionally duration via a temporary video element.
 *
 * Returns null if valid, or an error message string if invalid.
 */
export async function validateVideo(blob: Blob): Promise<string | null> {
  // Check MIME type
  if (blob.type !== "video/webm" && blob.type !== "video/mp4") {
    return "Invalid video format. Only WebM and MP4 are supported.";
  }

  // Check magic bytes for format verification
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());

  const isWebM = header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
  const isMp4 = header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70;

  if (blob.type === "video/webm" && !isWebM) {
    return "File does not appear to be a valid WebM video.";
  }
  if (blob.type === "video/mp4" && !isMp4) {
    return "File does not appear to be a valid MP4 video.";
  }

  // Duration check via HTMLVideoElement (browser only)
  /* v8 ignore next -- environment guard: URL/document unavailable outside browser */
  if (typeof URL !== "undefined" && typeof document !== "undefined") {
    try {
      const duration = await getVideoDuration(blob);
      if (duration < MIN_VIDEO_DURATION_S) {
        return "Video is too short. Please record at least 1 second.";
      }
      if (duration > MAX_VIDEO_DURATION_S) {
        return `Video exceeds the ${MAX_VIDEO_DURATION_S}-second limit. Please record a shorter clip.`;
      }
    } catch {
      // Duration check is best-effort; don't block upload if it fails
    }
  }

  return null;
}

/** Extract duration from a video blob using an off-screen video element. */
function getVideoDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    video.onloadedmetadata = () => {
      const d = video.duration;
      cleanup();
      if (isFinite(d)) {
        resolve(d);
      } else {
        reject(new Error("Could not determine video duration"));
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Failed to load video metadata"));
    };

    video.src = url;
  });
}
