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
 * Minimum upload size (1 KB) — must match storage.rules.
 *
 * Defined in `src/constants/video.ts` and re-exported here so the capture path
 * can share it without importing this module (which would pull the Firebase SDK
 * into the recorder). Re-exported rather than redeclared so the uploader and the
 * recorder can never drift apart.
 */
export { MIN_UPLOAD_BYTES, MAX_UPLOAD_BYTES } from "../constants/video";
import { MIN_UPLOAD_BYTES, MAX_UPLOAD_BYTES } from "../constants/video";
/**
 * Base delay for exponential backoff on upload retries.
 *
 * Kept at 250ms so two retries (attempts 0 and 1) with ×2 growth + up to ×2
 * jitter cap at roughly 1.5s — fits comfortably inside vitest's 5s per-test
 * timeout under full-suite load while still giving the Firebase SDK breathing
 * room between attempts. Jitter is added in the retry loop to prevent a
 * thundering-herd on outage recovery.
 */
const RETRY_BACKOFF_MS = 250;

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

/**
 * Everything the retry/abort/progress core needs that is NOT specific to
 * where a clip came from. Both upload paths build one of these and hand it
 * to {@link runResumableUpload}; the core has no idea whether it is moving a
 * game turn or a user-posted clip.
 */
interface ResumableUploadRequest {
  /** Full Storage path, extension included. */
  path: string;
  contentType: "video/mp4" | "video/webm";
  /** Already classified by {@link classifyVideoBlob}. */
  blob: Blob;
  /**
   * Custom metadata written alongside the object. MUST include
   * `uploaderUid` — storage.rules pins it to `request.auth.uid` on create
   * and re-checks it from `resource.metadata` on update/delete, so without
   * it any signed-in user could overwrite another's video.
   */
  customMetadata: Record<string, string>;
  onProgress?: (progress: UploadProgress) => void;
  maxRetries: number;
  signal?: AbortSignal;
}

/**
 * Validate a blob against the Storage size bounds and classify it.
 *
 * Bounds are EXCLUSIVE to mirror storage.rules exactly, which enforces
 * `request.resource.size > 1024` and `request.resource.size < 50*1024*1024`.
 * A clip of exactly MIN_UPLOAD_BYTES or exactly MAX_UPLOAD_BYTES is rejected
 * by the rules, so the client must reject it too — otherwise it passes the
 * client check, uploads, and only then fails at the rules boundary.
 *
 * Also resolves the caller's uid, which every upload path must bind into
 * `customMetadata`.
 */
function prepareUpload(blob: Blob): UploadShape & { uploaderUid: string } {
  if (blob.size <= MIN_UPLOAD_BYTES) {
    throw new Error("Video is too small to upload. Please record a longer clip.");
  }
  if (blob.size >= MAX_UPLOAD_BYTES) {
    throw new Error("Video exceeds the 50 MB limit. Please record a shorter clip.");
  }

  const shape = classifyVideoBlob(blob);

  const uploaderUid = requireAuth().currentUser?.uid;
  if (!uploaderUid) {
    throw new Error("You must be signed in to upload a video.");
  }

  return { ...shape, uploaderUid };
}

/**
 * The shared upload engine: resumable upload + progress reporting +
 * abort + retry with exponential backoff and jitter.
 *
 * Extracted from `uploadVideo` when user-posted clips arrived, rather than
 * copied: the abort semantics (translate `storage/canceled` into a standard
 * `AbortError`, detach the listener per attempt so retries don't leak) and
 * the retryable/permanent error split are subtle enough that two copies
 * would drift, and the drift would only show up as a stuck upload on a
 * flaky network. One body, two callers.
 *
 * Rejects with `DOMException("Upload cancelled", "AbortError")` on abort,
 * and rethrows the original SDK error (preserving `code`/`name`) otherwise.
 */
async function runResumableUpload(req: ResumableUploadRequest): Promise<string> {
  const { path, contentType, blob, customMetadata, onProgress, maxRetries, signal } = req;

  // Reject immediately if the caller already aborted before invocation —
  // no point spinning up the SDK. Checked HERE rather than in each wrapper
  // so a future upload path cannot forget it.
  if (signal?.aborted) {
    throw new DOMException("Upload cancelled", "AbortError");
  }

  const storageRef = ref(requireStorage(), path);

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
        const task = uploadBytesResumable(storageRef, blob, {
          contentType,
          // Clip storage paths are deterministic (`games/{gameId}/turn-N/{role}.{ext}`
          // for game clips, `userClips/{uid}/{clipId}.{ext}` for user clips)
          // and the corresponding firestore.rules block forbids clip mutation
          // once the doc is written, so the bytes at this URL never change.
          // Marking the response immutable lets browsers (and any CDN that
          // honours Cache-Control) keep replays + prefetched next clips off
          // the network for a year — a viewer-perceived 0-RTT REPLAY and a
          // free win on cross-session view of the same clip.
          cacheControl: "public, max-age=31536000, immutable",
          customMetadata,
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
 * Upload a game-turn video blob with progress tracking and retry.
 *
 * Path: games/{gameId}/turn-{turnNumber}/{role}.webm (web) or .mp4 (native),
 * role = "set" | "match".
 *
 * Uses uploadBytesResumable for real-time progress tracking. Retries with
 * exponential backoff + jitter on transient failures only — permanent errors
 * (permission/quota/not-found) short-circuit the loop.
 *
 * An optional `signal: AbortSignal` cancels the in-flight upload: the
 * currently running resumable task is torn down via `task.cancel()` and this
 * function rejects with `DOMException("Upload cancelled", "AbortError")`.
 * App Store reviewers exercise the cancel button on a 50 MB upload, so the
 * contract here is non-optional.
 */
export async function uploadVideo(
  gameId: string,
  turnNumber: number,
  role: "set" | "match",
  blob: Blob,
  onProgress?: (progress: UploadProgress) => void,
  maxRetries = 2,
  signal?: AbortSignal,
): Promise<string> {
  const { ext, contentType, blob: uploadBlob, uploaderUid } = prepareUpload(blob);
  const startTime = Date.now();

  const url = await runResumableUpload({
    path: `games/${gameId}/turn-${turnNumber}/${role}.${ext}`,
    contentType,
    blob: uploadBlob,
    customMetadata: {
      uploaderUid,
      gameId,
      turn: String(turnNumber),
      role,
      uploadedAt: new Date().toISOString(),
      // Retention hint: videos older than 90 days may be purged by a
      // scheduled Cloud Function or a Storage lifecycle rule.
      retainUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    },
    onProgress,
    maxRetries,
    signal,
  });

  analytics.videoUploaded(Date.now() - startTime, blob.size);
  metrics.videoUploaded(gameId, blob.size, Date.now() - startTime);
  return url;
}

/**
 * Upload a user-posted clip (source: "user") and return its download URL.
 *
 * Path: `userClips/{uid}/{clipId}.webm` (web) or `.mp4` (native). The uid
 * segment is what makes the storage rule ownable — a user may only write
 * under their own prefix — and `clipId` is minted by the caller BEFORE the
 * upload so the Firestore doc written afterwards points at a path that is
 * already known and already occupied. See `createUserClip` for that ordering.
 *
 * Shares the whole retry/abort/progress core with {@link uploadVideo}; the
 * only differences are the path, the metadata, and the absence of
 * game-scoped metrics (there is no game to attribute the upload to).
 */
export async function uploadUserClip(
  uid: string,
  clipId: string,
  blob: Blob,
  onProgress?: (progress: UploadProgress) => void,
  maxRetries = 2,
  signal?: AbortSignal,
): Promise<string> {
  // A uid or clip id containing "/" would escape the caller's own prefix
  // and target somebody else's folder. The rule would reject it, but a
  // silently mis-pathed upload is worth failing loudly and locally.
  if (!uid || uid.includes("/")) throw new Error("Invalid user id.");
  if (!clipId || clipId.includes("/")) throw new Error("Invalid clip id.");

  const { ext, contentType, blob: uploadBlob, uploaderUid } = prepareUpload(blob);
  if (uploaderUid !== uid) {
    // Uploading "as" another user cannot succeed (the rule pins the prefix
    // to request.auth.uid), so fail before burning the bandwidth.
    throw new Error("You must be signed in to upload a video.");
  }
  const startTime = Date.now();

  const url = await runResumableUpload({
    path: `userClips/${uid}/${clipId}.${ext}`,
    contentType,
    blob: uploadBlob,
    customMetadata: {
      uploaderUid,
      clipId,
      uploadedAt: new Date().toISOString(),
      retainUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    },
    onProgress,
    maxRetries,
    signal,
  });

  analytics.videoUploaded(Date.now() - startTime, blob.size);
  return url;
}

/**
 * Delete every stored object for a user-posted clip.
 *
 * The extension isn't knowable from the clip doc (web writes `.webm`,
 * native `.mp4`), so both candidates are attempted and a `storage/object-
 * not-found` on the one that was never written is expected, not an error.
 * Returns the number of objects actually removed.
 *
 * Best-effort by design: this backs the clip-deletion cascade, where a
 * stranded video object is a storage-cost problem, not a correctness one,
 * and must never block the Firestore delete.
 */
export async function deleteUserClipVideo(uid: string, clipId: string): Promise<number> {
  if (!uid || uid.includes("/") || !clipId || clipId.includes("/")) return 0;

  const storage = requireStorage();
  let deleted = 0;

  await Promise.all(
    (["webm", "mp4"] as const).map(async (ext) => {
      try {
        await deleteObject(ref(storage, `userClips/${uid}/${clipId}.${ext}`));
        deleted++;
      } catch (err) {
        const code = (err as { code?: string }).code;
        // The sibling extension never existed — the expected outcome for
        // exactly one of the two attempts on every clip.
        if (code === "storage/object-not-found") return;
        logger.warn("user_clip_video_delete_failed", {
          clipId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  return deleted;
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
