/**
 * Maximum native-video recording duration (milliseconds).
 *
 * Enforced client-side by `recordNativeVideo()` in `src/services/nativeVideo.ts`.
 * The native recorder plugin does not expose a hard cap, so the service auto-
 * stops recording after this many milliseconds. Keep this conservative — the
 * 50 MB Firebase Storage cap (storage.rules) is the backstop if a high-bitrate
 * camera happens to produce unusually large files.
 */
export const MAX_VIDEO_DURATION_MS = 10_000;
