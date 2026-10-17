/**
 * Move a user clip's video between the private prefix and the approved one.
 *
 * Storage rules cannot read the named "skatehubba" database, so approval is
 * a path, not a firestore.get() on every ranged video request. The private
 * object stays at userClips/{uid}/. A public copy lives at approvedClips/{uid}/.
 */

import { randomUUID } from "node:crypto";
import { getStorage } from "firebase-admin/storage";

export interface ClipObjectStore {
  copy(bucket: string, fromPath: string, toPath: string): Promise<void>;
  remove(bucket: string, path: string): Promise<void>;
  downloadUrl(bucket: string, path: string): Promise<string>;
}

export interface ParsedStorageUrl {
  bucket: string;
  path: string;
}

const DOWNLOAD_URL = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/;

export function parseClipStorageUrl(url: string): ParsedStorageUrl | null {
  const match = DOWNLOAD_URL.exec(url);
  if (!match) return null;
  const bucket = match[1] ?? "";
  if (bucket.length === 0) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[2] ?? "");
  } catch {
    return null;
  }
  if (path.includes("..") || path.length === 0) return null;
  if (!path.startsWith("userClips/") && !path.startsWith("approvedClips/")) return null;
  return { bucket, path };
}

export function downloadUrlFor(bucket: string, path: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

/**
 * When `visible` is true, copy a private object onto the approved path and
 * return that download URL. When it is false, copy an approved object back
 * to the private path, delete the public one, and return the private URL.
 * Returns null when the URL is already where it should be.
 */
export async function reconcileClipVideo(
  store: ClipObjectStore,
  input: { ownerUid: string; videoUrl: string; visible: boolean },
): Promise<string | null> {
  const parsed = parseClipStorageUrl(input.videoUrl);
  if (!parsed || input.ownerUid.length === 0) return null;
  const fileName = parsed.path.split("/").pop() ?? "";
  if (fileName.length === 0 || fileName.includes("/")) return null;
  const privatePath = `userClips/${input.ownerUid}/${fileName}`;
  const publicPath = `approvedClips/${input.ownerUid}/${fileName}`;

  if (input.visible) {
    if (parsed.path.startsWith("approvedClips/")) return null;
    await store.copy(parsed.bucket, parsed.path, publicPath);
    return store.downloadUrl(parsed.bucket, publicPath);
  }

  if (parsed.path.startsWith("approvedClips/")) {
    await store.copy(parsed.bucket, parsed.path, privatePath);
    await store.remove(parsed.bucket, parsed.path);
    return store.downloadUrl(parsed.bucket, privatePath);
  }
  await store.remove(parsed.bucket, publicPath);
  return null;
}

export function adminClipStore(): ClipObjectStore {
  return {
    async copy(bucket, fromPath, toPath) {
      const target = getStorage().bucket(bucket);
      await target.file(fromPath).copy(target.file(toPath));
    },
    async remove(bucket, path) {
      await getStorage().bucket(bucket).file(path).delete({ ignoreNotFound: true });
    },
    async downloadUrl(bucket, path) {
      const token = randomUUID();
      const file = getStorage().bucket(bucket).file(path);
      await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
      return downloadUrlFor(bucket, path, token);
    },
  };
}
