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

/**
 * Target video bitrate (bits/second) — shared by BOTH capture paths, for the
 * same reason the duration cap is: a clip must not look better or worse purely
 * because of the device it was filmed on.
 *
 * Passed to `MediaRecorder` as `videoBitsPerSecond` on the web and to the
 * Capacitor plugin as `videoBitrate` on native. Without it the two drift far
 * apart — the plugin defaults to 3 Mbps (hardcoded in its native sources, note
 * its published typings wrongly claim 4.5 Mbps) while browsers pick their own
 * unrelated default.
 *
 * Arithmetic against the ceiling: 8 Mbit/s × 20 s = 160 Mbit = 20 MB, plus
 * ~0.3 MB of audio. Firebase Storage rejects anything ≥ 50 MB
 * (`MAX_UPLOAD_BYTES` in src/services/storage.ts, mirroring storage.rules), so
 * a full-length clip keeps ~2.4× headroom for container overhead and encoders
 * that overshoot. 8 Mbps is the floor for clean 1080p at speed — below it fast
 * board movement smears into mush, which is the whole subject of the footage.
 */
export const VIDEO_BITS_PER_SECOND = 8_000_000;
