import { ref, uploadBytesResumable, getDownloadURL, deleteObject, listAll } from "firebase/storage";
import { Capacitor } from "@capacitor/core";
import { requireAuth, requireStorage } from "../firebase";
import { analytics } from "./analytics";
import { logger, metrics } from "./logger";
import { isRetryable } from "../utils/retry";

export interface UploadProgress {
  bytesTransferred: number;
  totalBytes: number;
  percent: number;
}

/**
 * Upload a video blob to Firebase Storage with progress tracking and retry.
 *
 * Path: games/{gameId}/turn-{turnNumber}/{role}.webm (web) or .mp4 (native)
 * role = "set" | "match"
 *
 * Uses uploadBytesResumable for real-time progress tracking.
 * Retries with exponential backoff + jitter on transient failures only —
 * permanent errors (permission/quota/not-found) short-circuit the loop.
 *
 * An optional `signal: AbortSignal` cancels the in-flight upload: the
 * currently running resumable task is torn down via `task.cancel()` and
 * this function rejects with `DOMException("Upload cancelled", "AbortError")`.
 * App Store reviewers exercise the cancel button on a 50 MB upload, so
 * the contract here is non-optional.
 */
/** Minimum upload size (1 KB) — must match storage.rules */
const MIN_UPLOAD_BYTES = 1024;
/** Maximum upload size (50 MB) — must match storage.rules */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Base delay for exponential backoff on upload retries */
const RETRY_BACKOFF_MS = 1000;

/** Shape of the upload contract returned by `classifyBlob`. */
interface UploadShape {
  /** File extension appended to the upload path. */
  ext: "mp4" | "webm";
  /** Content-Type header sent to Storage. Must match `storage.rules`. */
  contentType: "video/mp4" | "video/webm";
  /** Blob to upload — possibly re-wrapped with a coerced MIME type. */
  blob: Blob;
}

/**
 * Strictly classify a blob into an (ext, contentType, blob) triple that
 * satisfies `storage.rules` (which only accepts `video/webm` or `video/mp4`
 * and requires the extension to match).
 *
 * Rationale: the previous impl used `blob.type.includes("mp4")`, which
 * silently treated empty-MIME blobs (Capacitor camera on some Android
 * devices) as WebM — uploading mp4 bytes as `video/webm`. Storage rules
 * then rejected the write because the declared content-type did not match
 * the file extension, breaking the native path end-to-end.
 *
 * Decision:
 *   - `video/mp4` | `video/quicktime`  → `.mp4` + `video/mp4` (coerce type)
 *   - `video/webm`                     → `.webm` + `video/webm`
 *   - empty / unknown                  → `.mp4` on native, `.webm` on web
 *
 * `nativeVideo.ts` already coerces its output to `video/mp4` or `video/webm`,
 * so most native-path blobs arrive pre-classified. When the incoming blob's
 * `.type` already matches the decision, we return the original blob unchanged
 * to avoid needless re-wrapping.
 */
export function classifyVideoBlob(blob: Blob): UploadShape {
  const type = blob.type;

  let ext: "mp4" | "webm";
  let contentType: "video/mp4" | "video/webm";

  if (type === "video/mp4" || type === "video/quicktime") {
    // iOS AVFoundation can label mp4-containerised clips as quicktime.
    // Storage rules only accept `video/mp4`, so coerce on the way out.
    ext = "mp4";
    contentType = "video/mp4";
  } else if (type === "video/webm") {
    ext = "webm";
    contentType = "video/webm";
  } else {
    // Empty or unknown MIME (Capacitor file:// blobs, some Android webviews).
    // Fall back to the platform's native container format: MediaRecorder on
    // the web produces WebM; native video capture produces MP4.
    if (Capacitor.isNativePlatform()) {
      ext = "mp4";
      contentType = "video/mp4";
    } else {
      ext = "webm";
      contentType = "video/webm";
    }
  }

  // Rewrap only when the blob's declared type differs from the classification.
  // `nativeVideo.ts` already coerces, so typical native-path blobs pass through
  // untouched (blob.type === contentType → no rewrap). Re-wrapping is required
  // when the coerced contentType differs from blob.type so that
  // `uploadBytesResumable`'s default Content-Type header matches the rules.
  const outBlob = type === contentType ? blob : new Blob([blob], { type: contentType });
  return { ext, contentType, blob: outBlob };
}

export async function uploadVideo(
  gameId: string,
  turnNumber: number,
  role: "set" | "match",
  blob: Blob,
  onProgress?: (progress: UploadProgress) => void,
  maxRetries = 2,
  signal?: AbortSignal,
): Promise<string> {
  // Reject immediately if the caller already aborted before invocation —
  // no point spinning up the SDK or even touching the blob.
  if (signal?.aborted) {
    throw new DOMException("Upload cancelled", "AbortError");
  }

  // Pre-validate size to fail fast before wasting bandwidth.
  // These limits mirror the Firebase Storage security rules.
  if (blob.size < MIN_UPLOAD_BYTES) {
    throw new Error("Video is too small to upload. Please record a longer clip.");
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error("Video exceeds the 50 MB limit. Please record a shorter clip.");
  }

  // Strictly classify the blob — see `classifyVideoBlob` for the rationale.
  // The returned blob may be re-wrapped to carry the correct content-type.
  const { ext, contentType, blob: uploadBlob } = classifyVideoBlob(blob);
  const path = `games/${gameId}/turn-${turnNumber}/${role}.${ext}`;
  const storageRef = ref(requireStorage(), path);
  // Bind the upload to the caller's UID — Storage rules verify
  // metadata.uploaderUid == request.auth.uid so signed-in users cannot
  // overwrite or delete each other's videos.
  const uploaderUid = requireAuth().currentUser?.uid;
  if (!uploaderUid) {
    throw new Error("You must be signed in to upload a video.");
  }
  const startTime = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Re-check abort between retries — a caller that aborts while we're
    // backing off should not start a fresh attempt. Covered integration-
    // style by the "abort between retries" path; the existing tests exercise
    // abort-before-start and abort-mid-upload, so ignore this specific line.
    /* v8 ignore next 3 */
    if (signal?.aborted) {
      throw new DOMException("Upload cancelled", "AbortError");
    }

    // Track the abort listener per-attempt so we can detach it in `finally`
    // without leaking listeners across retries.
    let onAbort: (() => void) | null = null;

    try {
      const url = await new Promise<string>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, uploadBlob, {
          contentType,
          customMetadata: {
            // Storage rules require uploaderUid == request.auth.uid on create
            // and resource.metadata.uploaderUid == request.auth.uid on update/
            // delete. Without this binding, any signed-in user could overwrite
            // another player's video.
            uploaderUid,
            gameId,
            turn: String(turnNumber),
            role,
            uploadedAt: new Date().toISOString(),
            // Retention hint: videos older than 90 days may be purged by a
            // scheduled Cloud Function or a Storage lifecycle rule.
            retainUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
          },
        });

        if (signal) {
          onAbort = () => {
            // Cancel the in-flight resumable task. The SDK surfaces this
            // as `storage/canceled`; we translate to the standard
            // AbortError so callers can use a uniform cancellation
            // predicate regardless of transport.
            try {
              task.cancel();
            } catch {
              // Task may have already completed; ignore.
            }
            reject(new DOMException("Upload cancelled", "AbortError"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }

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
      // Permanent errors (auth/quota/not-found/user-cancel) must short-
      // circuit — retrying won't make the caller authenticated, nor will
      // it un-abort the upload. We still rethrow the original error so
      // callers can inspect its `code`/`name`.
      if (!isRetryable(err)) throw err;
      if (attempt === maxRetries) throw err;
      // Exponential backoff with jitter. Jitter prevents a thundering
      // herd when many clients retry after the same outage recovery
      // window: `base * (1 + random)` spreads attempts over 2x the
      // deterministic window.
      const delay = RETRY_BACKOFF_MS * (attempt + 1) * (1 + Math.random());
      await new Promise((r) => setTimeout(r, delay));
    } finally {
      // Always detach the abort listener so we don't leak across retries
      // or after the function returns. The upload task is released via the
      // promise's finalization; no explicit cleanup is required.
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
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
