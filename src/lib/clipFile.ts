/**
 * File name + MIME type for a downloaded clip. Uploads are mp4 on iOS
 * (and sometimes webm/quicktime elsewhere), so read the blob's real type
 * instead of assuming one; anything unknown or missing is treated as mp4,
 * the format every share target and the Photos app accept.
 */
const EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export const DEFAULT_CLIP_MIME = "video/mp4";

export function clipFileType(blobType: string | undefined): { mime: string; ext: string } {
  const mime = (blobType ?? "").split(";")[0].trim().toLowerCase();
  const ext = EXTENSIONS[mime];
  return ext ? { mime, ext } : { mime: DEFAULT_CLIP_MIME, ext: "mp4" };
}

export function clipFileName(trickName: string, ext: string): string {
  return `skatehubba-${trickName.replace(/\s+/g, "-").toLowerCase()}.${ext}`;
}
