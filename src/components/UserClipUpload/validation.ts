/**
 * Client-side gates for a standalone user clip, kept as pure functions so the
 * modal stays presentational and every rule is unit-testable without a DOM
 * fixture or a Firebase mock.
 *
 * None of these are security boundaries — `storage.rules` and
 * `firestore.rules` are. They exist to fail a bad file in the picker, where
 * the skater can just choose another one, instead of after a 30 MB upload
 * bounces off the rules with a generic permission error.
 */

import { MAX_UPLOAD_BYTES, MIN_UPLOAD_BYTES, USER_CLIP_MAX_DURATION_SECONDS } from "../../constants/video";

/**
 * MIME types `storage.rules` accepts for a clip. Also the `accept` attribute
 * on the file input — but that is a hint the OS picker may ignore (and
 * "All files" defeats entirely), so the same list is re-checked here.
 */
export const ACCEPTED_VIDEO_MIME_TYPES = ["video/webm", "video/mp4"] as const;

/** Value for the file input's `accept` attribute. */
export const VIDEO_ACCEPT_ATTR = ACCEPTED_VIDEO_MIME_TYPES.join(",");

/** Longest trick name a clip may carry. Mirrors the Firestore create rule. */
export const TRICK_NAME_MAX_LENGTH = 80;

/**
 * Validate the trick caption. Returns an error string for the user, or null
 * when the name is acceptable. Callers should submit `name.trim()`, which is
 * what the length is measured against — a caption of pure whitespace is
 * empty, not 12 characters long.
 */
export function validateTrickName(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "Name the trick before posting.";
  if (trimmed.length > TRICK_NAME_MAX_LENGTH) {
    return `Trick name must be ${TRICK_NAME_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

/**
 * Validate a picked file's type and size. Returns an error string for the
 * user, or null when the file may proceed to the (async) duration probe.
 *
 * Size bounds are exclusive on both ends to match `storage.rules`, which
 * enforces `size > MIN` and `size < MAX`.
 */
export function validateVideoFile(file: { type: string; size: number }): string | null {
  if (!(ACCEPTED_VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Pick an MP4 or WebM video.";
  }
  if (file.size <= MIN_UPLOAD_BYTES) return "That file is empty or corrupted.";
  if (file.size >= MAX_UPLOAD_BYTES) {
    return `That video is too large. Keep it under ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`;
  }
  return null;
}

/**
 * Validate a probed duration in seconds. Returns an error string, or null.
 *
 * A non-finite duration means the browser could not parse the container's
 * metadata — some WebM files written by streaming encoders genuinely report
 * `Infinity`. That is treated as unverifiable rather than as a pass: letting
 * it through would make the cap trivially bypassable by re-muxing.
 */
export function validateVideoDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "Couldn't read that video. Try a different file.";
  }
  // Round down before comparing so a 30.04 s clip — the length a recorder
  // that stops "at 30 seconds" actually produces — isn't rejected for
  // rounding error the user cannot see or fix.
  if (Math.floor(seconds) > USER_CLIP_MAX_DURATION_SECONDS) {
    return `Clips must be ${USER_CLIP_MAX_DURATION_SECONDS} seconds or shorter.`;
  }
  return null;
}

/**
 * Read a video blob's duration via a detached <video> element's metadata.
 *
 * Resolves with the duration in seconds, or rejects when the browser cannot
 * decode the file. `preload="metadata"` keeps this to the container header
 * rather than pulling the whole file through the decoder. The object URL is
 * revoked on every exit path — a leaked one pins the entire blob in memory,
 * which for a 30 MB clip is not a rounding error.
 */
export function probeVideoDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement("video");
    const cleanup = (): void => {
      el.onloadedmetadata = null;
      el.onerror = null;
      el.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
    el.onloadedmetadata = () => {
      const { duration } = el;
      cleanup();
      resolve(duration);
    };
    el.onerror = () => {
      cleanup();
      reject(new Error("Couldn't read that video. Try a different file."));
    };
    el.preload = "metadata";
    el.src = url;
  });
}
