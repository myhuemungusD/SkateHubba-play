import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { requireAuth, requireStorage } from "../firebase";
import { isAvatarSafe } from "./avatarModeration";
import { logger } from "./logger";

/**
 * Avatar service.
 *
 * Owns the upload + delete + fallback contract for `users/{uid}/avatar.{ext}`.
 *
 * All avatars are encoded as `image/webp` after a client-side resize to
 * a max 400×400 square (`AvatarPicker` performs the square crop earlier).
 * WebP is mandatory — it's the smallest of the three formats the storage
 * rules accept (rules also allow `.jpeg` / `.png` so legacy variants
 * uploaded by older clients can still be deleted on account teardown).
 *
 * Pre-upload we run the blob through {@link isAvatarSafe} (NSFWjs on-device
 * model). Score >0.85 → reject with {@link AvatarRejectedError}. Score
 * 0.5–0.85 returns to the caller so `AvatarPicker` can prompt the user;
 * a re-call with `acceptBorderlineNsfw: true` skips the gate after the
 * user explicitly confirms.
 *
 * Storage rules + Firestore profileImageUrl pinning are the canonical
 * security boundary; the in-app moderation is a UX/cost optimisation.
 */

/** Storage extensions the rules allow. WebP is canonical; jpeg/png are
 *  legacy variants from older clients that the deletion path still has
 *  to clean up on account teardown. */
const AVATAR_EXTENSIONS = ["webp", "jpeg", "png"] as const;
type AvatarExt = (typeof AVATAR_EXTENSIONS)[number];

/** Maximum side length of the encoded avatar in pixels. */
const MAX_DIMENSION = 400;
/** Storage rules upper bound — must match `storage.rules`. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Storage rules lower bound — anything ≤1 KB is rejected by the rules. */
const MIN_UPLOAD_BYTES = 1024;
/** Quality target for WebP encoding. Tuned to land a 400×400 portrait
 *  comfortably under the 2 MB cap with headroom for noisy / high-frequency
 *  source material (selfies, photos with grain). */
const WEBP_QUALITY = 0.85;
/** Reject threshold — same as `avatarModeration.ts` REJECT_THRESHOLD. */
const NSFW_REJECT_THRESHOLD = 0.85;
/** Warn-band lower bound — same as `avatarModeration.ts` WARN_THRESHOLD. */
const NSFW_WARN_THRESHOLD = 0.5;

/** Path to the SVG fallback shipped from the public/ folder. */
const FALLBACK_SVG_URL = "/default-skater.svg";

/** Thrown when the moderation gate hard-rejects an upload (score >0.85). */
export class AvatarRejectedError extends Error {
  readonly reason: "nsfw";
  readonly score: number;
  readonly category?: string;
  constructor(score: number, category?: string) {
    super("Avatar rejected by content safety check");
    this.name = "AvatarRejectedError";
    this.reason = "nsfw";
    this.score = score;
    this.category = category;
  }
}

/** Thrown when the resized blob still exceeds 2 MB (extreme corner — e.g.
 *  pathological source resolutions; the resize path normally lands at
 *  ~50–200 KB). */
export class AvatarTooLargeError extends Error {
  readonly sizeBytes: number;
  constructor(sizeBytes: number) {
    super(`Avatar exceeds the 2 MB cap (${sizeBytes} bytes)`);
    this.name = "AvatarTooLargeError";
    this.sizeBytes = sizeBytes;
  }
}

/** Thrown when the blob the caller hands us is below the 1 KB floor the
 *  storage rules require — typically a corrupted re-encode or empty crop. */
export class AvatarTooSmallError extends Error {
  readonly sizeBytes: number;
  constructor(sizeBytes: number) {
    super(`Avatar below the 1 KB minimum (${sizeBytes} bytes)`);
    this.name = "AvatarTooSmallError";
    this.sizeBytes = sizeBytes;
  }
}

/** Returned to the caller when moderation says "borderline" — the upload
 *  is held until the user confirms via {@link uploadAvatar}'s
 *  `acceptBorderlineNsfw` option. */
export class AvatarBorderlineError extends Error {
  readonly score: number;
  readonly category?: string;
  constructor(score: number, category?: string) {
    super("Avatar borderline — confirmation required");
    this.name = "AvatarBorderlineError";
    this.score = score;
    this.category = category;
  }
}

export interface UploadAvatarOptions {
  /**
   * When true, skip the borderline confirmation gate. The hard reject
   * (score > 0.85) still applies. Set to `true` after the user explicitly
   * confirms a borderline image in the AvatarPicker UI.
   */
  acceptBorderlineNsfw?: boolean;
}

/**
 * Decode a Blob into a same-origin HTMLImageElement. The Object URL
 * bridge keeps the dependency surface small and lets the caller treat
 * any image source (camera capture, file picker, paste-URL) uniformly.
 */
async function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("avatar_decode_failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Compute the post-resize dimensions for an arbitrary source image.
 * Aspect ratio is preserved, max side clamped to {@link MAX_DIMENSION}.
 * The square crop happens in `AvatarPicker`'s preview before this runs.
 *
 * Exported for the test suite — exercising the math directly avoids
 * canvas-rendering quirks under jsdom.
 */
export function computeResizeDimensions(
  width: number,
  height: number,
  maxDimension: number = MAX_DIMENSION,
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }
  // Preserve aspect ratio by scaling on the longest side.
  if (width >= height) {
    return {
      width: maxDimension,
      height: Math.round((height * maxDimension) / width),
    };
  }
  return {
    width: Math.round((width * maxDimension) / height),
    height: maxDimension,
  };
}

/**
 * Resize a source blob to fit inside MAX_DIMENSION and re-encode as
 * WebP. Returns the new blob — never the original. The caller is
 * responsible for passing a square-cropped source if a 1:1 aspect is
 * required (the AvatarPicker preview handles that).
 */
async function resizeToWebp(blob: Blob): Promise<Blob> {
  const img = await decodeImage(blob);
  const { width, height } = computeResizeDimensions(img.naturalWidth, img.naturalHeight);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("avatar_resize_unsupported");
  }
  ctx.drawImage(img, 0, 0, width, height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (out) => {
        if (out) resolve(out);
        else reject(new Error("avatar_encode_failed"));
      },
      "image/webp",
      WEBP_QUALITY,
    );
  });
}

/**
 * Build the storage path for a given uid + extension. Centralised so
 * tests and `deleteAvatar` can iterate the legacy variants without
 * stringly-typed paths.
 */
function avatarPath(uid: string, ext: AvatarExt): string {
  return `users/${uid}/avatar.${ext}`;
}

/**
 * Upload a user's avatar.
 *
 * Pipeline (in order):
 *   1. Resize source blob to ≤400×400 WebP via canvas.
 *   2. NSFWjs gate via {@link isAvatarSafe}.
 *      - score > 0.85 → throw {@link AvatarRejectedError}
 *      - score 0.5..0.85 → throw {@link AvatarBorderlineError} unless
 *        `opts.acceptBorderlineNsfw === true`.
 *      - score < 0.5 → silent pass.
 *   3. Size validation (>1 KB, ≤2 MB).
 *   4. Upload to `users/{uid}/avatar.webp`. Storage rules verify size,
 *      content-type, and uid binding.
 *   5. Return the resulting `getDownloadURL()` URL.
 *
 * The Firestore `profileImageUrl` write is the caller's responsibility
 * (see `setProfileImageUrl` in `users.ts`). Splitting it lets the
 * AvatarPicker drive the moderation flow without a circular dependency
 * on the users service.
 */
export async function uploadAvatar(uid: string, blob: Blob, opts: UploadAvatarOptions = {}): Promise<string> {
  // 1. Resize / re-encode.
  const resized = await resizeToWebp(blob);

  // 2. Moderation gate.
  const safety = await isAvatarSafe(resized);
  if (!safety.ok) {
    throw new AvatarRejectedError(safety.score, safety.category);
  }
  if (safety.score >= NSFW_WARN_THRESHOLD && safety.score <= NSFW_REJECT_THRESHOLD && !opts.acceptBorderlineNsfw) {
    throw new AvatarBorderlineError(safety.score, safety.category);
  }

  // 3. Size validation — defence in depth against extreme inputs.
  if (resized.size > MAX_UPLOAD_BYTES) {
    throw new AvatarTooLargeError(resized.size);
  }
  if (resized.size <= MIN_UPLOAD_BYTES) {
    throw new AvatarTooSmallError(resized.size);
  }

  // 4. Upload. Storage rules pin path + size + content-type + uid.
  const auth = requireAuth();
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error("avatar_upload_unauthenticated");
  }

  const ref = storageRef(requireStorage(), avatarPath(uid, "webp"));
  // Avatars are immutable from the client's perspective — the storage
  // rule denies UPDATE, so a re-upload requires a delete-then-create.
  // We delete the old object first so a same-path overwrite doesn't
  // wedge on the rule.
  try {
    await deleteObject(ref);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    if (code !== "storage/object-not-found") {
      logger.warn("avatar_pre_delete_failed", {
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result = await uploadBytes(ref, resized, {
    contentType: "image/webp",
    customMetadata: {
      uploaderUid: uid,
      uploadedAt: new Date().toISOString(),
    },
  });
  return await getDownloadURL(result.ref);
}

/**
 * Delete a user's avatar — best-effort across all three extension
 * variants the storage rules accept. `not-found` is the expected case
 * for variants the user never uploaded; any other failure is logged
 * but does not throw because the caller's user-facing flow (account
 * deletion, profile reset) shouldn't break on a transient Storage
 * outage.
 *
 * Does NOT touch the Firestore profile doc; the caller must still
 * `setProfileImageUrl(uid, null)` after this resolves.
 */
export async function deleteAvatar(uid: string): Promise<void> {
  const storage = requireStorage();
  await Promise.all(
    AVATAR_EXTENSIONS.map(async (ext) => {
      try {
        await deleteObject(storageRef(storage, avatarPath(uid, ext)));
      } catch (err) {
        const code = (err as { code?: string })?.code ?? "";
        if (code === "storage/object-not-found") return;
        logger.warn("avatar_delete_failed", {
          uid,
          ext,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}

/**
 * The universal fallback avatar URL. Pure function so the import
 * is tree-shakable and consumers can render it server-side without
 * touching the network.
 */
export function getAvatarFallbackUrl(): string {
  return FALLBACK_SVG_URL;
}
