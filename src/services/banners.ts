import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { doc, runTransaction } from "firebase/firestore";
import { ensureStorage, requireAuth, requireDb, requireStorage } from "../firebase";
import { isAvatarSafe } from "./avatarModeration";
import { logger } from "./logger";

/**
 * Profile banner service (behind VITE_FEATURE_PROFILE_BANNER).
 *
 * Owns `users/{uid}/banner.webp` and the `users/{uid}.bannerImageUrl` field.
 * Same contract as avatars: resize + re-encode to WebP on device, NSFW gate,
 * delete-then-create (storage denies update), then pin the URL on the
 * profile. Storage + Firestore rules are the real security boundary.
 *
 * Banners have no borderline confirm step: anything at or above the warn
 * score is refused, since a banner is the biggest image on a profile.
 */

const MAX_WIDTH = 1500;
const MAX_HEIGHT = 600;
/** Mirrors storage.rules. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MIN_UPLOAD_BYTES = 1024;
const WEBP_QUALITY = 0.82;
const NSFW_WARN_THRESHOLD = 0.5;

export type BannerUploadError = "rejected" | "too_large" | "too_small" | "unauthenticated" | "no_profile";

/** Typed failure so the UI can show a plain message per case. */
export class BannerError extends Error {
  readonly code: BannerUploadError;
  constructor(code: BannerUploadError) {
    super(`banner_${code}`);
    this.name = "BannerError";
    this.code = code;
  }
}

/** Fit (w, h) inside MAX_WIDTH × MAX_HEIGHT, keeping aspect ratio. */
export function computeBannerDimensions(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("banner_decode_failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function resizeToWebp(blob: Blob): Promise<Blob> {
  const img = await decodeImage(blob);
  const { width, height } = computeBannerDimensions(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("banner_resize_unsupported");
  ctx.drawImage(img, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error("banner_encode_failed"))),
      "image/webp",
      WEBP_QUALITY,
    );
  });
}

function bannerPath(uid: string): string {
  return `users/${uid}/banner.webp`;
}

/** URL must be this project's bucket + this uid's banner object (mirrors firestore.rules). */
export function isPinnedBannerUrl(uid: string, url: string): boolean {
  /* v8 ignore next */
  const bucket = (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) ?? "";
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^https://firebasestorage\\.googleapis\\.com/v0/b/${esc(bucket)}/o/users%2F${esc(uid)}%2Fbanner\\.webp(\\?.*)?$`,
  ).test(url);
}

/** Write (or clear with null) `users/{uid}.bannerImageUrl`. */
export async function setBannerImageUrl(uid: string, url: string | null): Promise<void> {
  if (url !== null && !isPinnedBannerUrl(uid, url)) throw new Error("banner_url_not_pinned");
  const db = requireDb();
  const ref = doc(db, "users", uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new BannerError("no_profile");
    tx.update(ref, { bannerImageUrl: url });
  });
}

/** Resize, moderate, upload and attach a banner. Returns the download URL. */
export async function uploadBanner(uid: string, blob: Blob): Promise<string> {
  const auth = requireAuth();
  if (!auth.currentUser || auth.currentUser.uid !== uid) throw new BannerError("unauthenticated");

  const resized = await resizeToWebp(blob);
  const safety = await isAvatarSafe(resized);
  if (!safety.ok || safety.score >= NSFW_WARN_THRESHOLD) throw new BannerError("rejected");
  if (resized.size > MAX_UPLOAD_BYTES) throw new BannerError("too_large");
  if (resized.size <= MIN_UPLOAD_BYTES) throw new BannerError("too_small");

  await ensureStorage();
  const ref = storageRef(requireStorage(), bannerPath(uid));
  await deleteBannerObject(uid);
  const result = await uploadBytes(ref, resized, {
    contentType: "image/webp",
    customMetadata: { uploaderUid: uid, uploadedAt: new Date().toISOString() },
  });
  const url = await getDownloadURL(result.ref);
  await setBannerImageUrl(uid, url);
  return url;
}

/** Best-effort delete of the banner object. True iff something was removed. */
export async function deleteBannerObject(uid: string): Promise<boolean> {
  await ensureStorage();
  try {
    await deleteObject(storageRef(requireStorage(), bannerPath(uid)));
    return true;
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    if (code !== "storage/object-not-found") {
      logger.warn("banner_delete_failed", { uid, error: err instanceof Error ? err.message : String(err) });
    }
    return false;
  }
}

/** Remove the banner: storage object first, then the profile field. */
export async function removeBanner(uid: string): Promise<void> {
  await deleteBannerObject(uid);
  await setBannerImageUrl(uid, null);
}
