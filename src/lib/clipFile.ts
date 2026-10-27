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

/**
 * A flat, portable file name for a clip. Trick names are free text: "50/50"
 * would put a path separator in the name, which share targets reject or cut
 * short. Accents are folded ("Flîp" → "flip"), anything else that isn't a
 * letter or digit becomes one dash, and a name with nothing usable left
 * (emoji only, blank) falls back to "clip".
 */
export function clipFileName(trickName: string, ext: string): string {
  const slug = trickName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `skatehubba-${slug || "clip"}.${ext}`;
}

/**
 * Best guess at a stored clip's extension from its download URL, before the
 * file is fetched (the native share sheet needs a name up front). Storage
 * paths end in `.mp4` (native) or `.webm` (web); anything else is mp4.
 */
export function clipExtFromUrl(url: string): string {
  let path = url.split("?")[0];
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    // Not a parseable URL — match on the raw string.
  }
  const m = /\.(mp4|mov|webm)$/i.exec(path);
  return m ? m[1].toLowerCase() : "mp4";
}
