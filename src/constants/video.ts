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
 * Duration cap for a standalone user clip (source: "user") — the footage a
 * skater uploads to the feed outside of a game.
 *
 * Deliberately LONGER than {@link MAX_VIDEO_DURATION_SECONDS}. The 20 s game
 * cap exists so a S.K.A.T.E. turn reads as one attempt at one trick and both
 * players' clips are directly comparable; a user clip has no opponent to be
 * fair to, so the only thing constraining it is the 50 MB Storage ceiling.
 * At {@link VIDEO_BITS_PER_SECOND} (8 Mbit/s) a full 30 s take is ~30 MB —
 * still under the rule, with less headroom than a game clip but enough for
 * container overhead.
 *
 * Callers thread this into the capture path explicitly (VideoRecorder's
 * `maxDurationSeconds` prop) rather than the recorder branching on clip type:
 * the recorder has no concept of why it is filming.
 */
export const USER_CLIP_MAX_DURATION_SECONDS = 30;

/** Millisecond form of {@link USER_CLIP_MAX_DURATION_SECONDS}, for timer APIs. */
export const USER_CLIP_MAX_DURATION_MS = USER_CLIP_MAX_DURATION_SECONDS * 1000;

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
 *
 * The 30 s case ({@link USER_CLIP_MAX_DURATION_SECONDS}, user-uploaded feed
 * clips) is tighter: 8 Mbit/s × 30 s = 240 Mbit = 30 MB, plus ~0.5 MB of audio.
 * That still clears the 50 MB ceiling, but the headroom drops to roughly 1.6×
 * — thin enough that an encoder overshooting its target bitrate on a busy,
 * high-motion 30 s clip can realistically reach the cap, where the upload is
 * rejected client-side by `MAX_UPLOAD_BYTES` before it ever leaves the device.
 * Raising either the bitrate or the user-clip duration eats that margin
 * directly; do the multiplication before touching either.
 */
export const VIDEO_BITS_PER_SECOND = 8_000_000;

/**
 * Smallest clip Firebase Storage will accept (1 KB) — mirrors `storage.rules`,
 * which enforces `request.resource.size > 1024`. The bound is EXCLUSIVE: a blob
 * of exactly this size is rejected, so callers must test `size <= MIN`.
 *
 * Lives here rather than in `src/services/storage.ts` so the capture path can
 * reject a failed encode the moment it is produced — while the user is still on
 * the camera screen and can simply shoot again — without importing the service
 * layer and pulling the Firebase SDK into the recorder. `storage.ts` re-exports
 * it, so the uploader and the recorder cannot drift apart.
 */
export const MIN_UPLOAD_BYTES = 1024;

/**
 * Largest clip Firebase Storage will accept (50 MB) — mirrors `storage.rules`.
 * The bound is EXCLUSIVE: a blob of exactly this size is rejected, so callers
 * must test `size >= MAX`.
 *
 * `src/services/storage.ts` holds the authoritative check (nothing reaches the
 * network without passing it). This copy exists for the same reason
 * {@link MIN_UPLOAD_BYTES} does: the user-clip picker has to reject an
 * oversized file the instant it is chosen — before reading it, before probing
 * its duration — and it cannot pull the Firebase SDK in to do that. If you
 * change one, change both.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
