/**
 * Firebase download URLs look like
 * `https://firebasestorage.googleapis.com/v0/b/BUCKET/o/userClips%2Fuid%2Fid.webm?...`.
 * Video Intelligence reads a `gs://` URI in the same bucket.
 */
export function storageUriFromDownloadUrl(url: string): string | null {
  const match = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/.exec(url);
  if (!match) return null;
  const bucket = match[1];
  let path: string;
  try {
    path = decodeURIComponent(match[2] ?? "");
  } catch {
    return null;
  }
  if (!path.startsWith("userClips/")) return null;
  if (bucket.length === 0 || path.includes("..")) return null;
  return `gs://${bucket}/${path}`;
}
