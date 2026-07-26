/**
 * Maximum video recording duration (seconds) — shared by BOTH capture paths.
 *
 * Enforced client-side by `recordNativeVideo()` in `src/services/nativeVideo.ts`
 * (the native recorder plugin exposes no hard cap, so the service auto-stops
 * after this long) and by the browser MediaRecorder path in
 * `src/components/VideoRecorder.tsx`. The two platforms must produce clips of
 * the same length or the same trick reads differently depending on the device,
 * so they read this single constant rather than each holding a literal.
 * Keep this conservative — the 50 MB Firebase Storage cap (storage.rules) is
 * the backstop if a high-bitrate camera happens to produce unusually large
 * files.
 */
export const MAX_VIDEO_DURATION_SECONDS = 20;

/** Millisecond form of {@link MAX_VIDEO_DURATION_SECONDS}, for timer APIs. */
export const MAX_VIDEO_DURATION_MS = MAX_VIDEO_DURATION_SECONDS * 1000;
