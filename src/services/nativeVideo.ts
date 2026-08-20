/**
 * Native video recording bridge.
 *
 * On iOS/Android (Capacitor native shell) this drives the
 * `@capacitor-community/video-recorder` plugin — a purpose-built video
 * capture pipeline backed by AVFoundation (iOS) and FancyCamera/CameraX
 * (Android). The plugin's preview-and-record model is wrapped here so
 * the rest of the app only sees a single async "record a clip" call
 * that returns a Blob ready for upload to Firebase Storage.
 *
 * On the web this module is not used — `VideoRecorder.tsx` falls back
 * to the browser MediaRecorder API directly. See `isNativePlatform()`.
 */

import { Capacitor } from "@capacitor/core";
import {
  VideoRecorder,
  VideoRecorderCamera,
  VideoRecorderQuality,
  type VideoRecorderPreviewFrame,
} from "@capacitor-community/video-recorder";
import { MAX_VIDEO_DURATION_SECONDS, VIDEO_BITS_PER_SECOND } from "../constants/video";
import { addBreadcrumb } from "../lib/sentry";

/** True when the app is running inside a Capacitor native shell. */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/** Result returned by the native video capture flow. */
export interface NativeVideoResult {
  /** Local file blob ready for upload. */
  blob: Blob;
  /** MIME type of the recorded video — always starts with "video/" on success. */
  mimeType: string;
}

/**
 * Preview-frame config used by `@capacitor-community/video-recorder`.
 *
 * The plugin renders the camera behind the webview (`stackPosition: 'back'`)
 * so our existing Tailwind-styled `VideoRecorder.tsx` overlay stays visible
 * while the camera streams underneath. `width/height: 'fill'` makes it
 * cover the full screen.
 */
const PREVIEW_FRAME: VideoRecorderPreviewFrame = {
  id: "skatehubba-video-preview",
  stackPosition: "back",
  width: "fill",
  height: "fill",
  x: 0,
  y: 0,
  borderRadius: 0,
};

/**
 * Launch the native video recorder and capture a clip.
 *
 * Flow:
 *   1. `initialize(...)` spins up the capture device and preview layer.
 *   2. `startRecording()` begins writing to a temp file on device.
 *   3. Recording stops on whichever fires first:
 *        • the caller signals `signal.abort()` (user tapped "Stop"), or
 *        • `maxDurationSeconds` elapses (hard duration cap).
 *   4. `stopRecording()` returns the temp-file URI, which we `fetch()`
 *      into a Blob for the uploader.
 *   5. `destroy()` releases the capture device in a `finally` block so
 *      we never leak the camera handle, even on error.
 *
 * Resolves with `{ blob, mimeType }` where `mimeType.startsWith("video/")`
 * is always true. Rejects on permission denial, user cancel, or when the
 * plugin fails to return a file URI.
 *
 * Abort timing matters and is handled in two distinct ways:
 *   • DURING WARM-UP (before `startRecording()` resolves) the take is
 *     cancelled outright — there are no frames to keep — and this rejects
 *     with an AbortError. The listener is attached BEFORE `initialize()`
 *     rather than after, because `addEventListener("abort", …)` on a signal
 *     that already fired never runs: the caller's UI shows a working "Stop"
 *     button from the moment it flips to `recording`, which is well before
 *     the camera is ready (an OS permission dialog can sit for tens of
 *     seconds on first launch). Registering late dropped those aborts
 *     permanently — `AbortController.abort()` is a no-op once already
 *     aborted, so every later tap was dead too, the clip ran the full cap
 *     and was submitted anyway, and the unmount path could not release the
 *     camera at all.
 *   • AFTER recording has started, abort means "stop and keep the take":
 *     the clip captured so far is returned normally.
 *
 * @param signal optional AbortSignal — fires `.abort()` to stop recording
 *               early (e.g. a UI "Stop" button). Honoured at any point,
 *               including before this function is called.
 * @param onRecordingStarted invoked exactly once, immediately after frames
 *               begin being captured and the duration cap is armed. Callers
 *               use it to start their elapsed-time UI so the on-screen clock
 *               cannot lead the real recording by the warm-up latency. Never
 *               invoked when the take is aborted during warm-up.
 * @param maxDurationSeconds hard auto-stop, in seconds. Defaults to the game
 *               cap ({@link MAX_VIDEO_DURATION_SECONDS}); standalone user-clip
 *               capture passes the longer `USER_CLIP_MAX_DURATION_SECONDS`.
 *               The plugin exposes no native max-duration option, so this
 *               timer is the only thing between a forgotten recording and the
 *               50 MB Storage ceiling — callers may raise it, never remove it.
 */
export async function recordNativeVideo(
  signal?: AbortSignal,
  onRecordingStarted?: () => void,
  maxDurationSeconds: number = MAX_VIDEO_DURATION_SECONDS,
): Promise<NativeVideoResult> {
  if (signal?.aborted) {
    throw new DOMException("Recording cancelled", "AbortError");
  }

  // Teardown decision for `initialize()`. Only an outright rejection (e.g. a
  // permission denial) proves no capture session exists — that is the one case
  // where destroy() would be teardown of nothing. A resolved initialize
  // obviously needs releasing, and so does one we raced away from on abort:
  // we cannot know whether it went on to open the device, and a redundant
  // destroy() is swallowed and breadcrumbed whereas a skipped one strands the
  // camera for the rest of the session.
  let initializeRejected = false;
  let autoStopTimer: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;

  // Resolves as soon as an abort arrives, whenever that is. Created before
  // `initialize()` so a warm-up abort is captured rather than lost, and
  // consumed by whichever phase is currently in flight.
  let abortedDuringWarmUp = false;
  let signalWarmUpAbort: (() => void) | null = null;
  const warmUpAborted = new Promise<void>((resolve) => {
    signalWarmUpAbort = resolve;
  });
  if (signal) {
    onAbort = () => {
      abortedDuringWarmUp = true;
      signalWarmUpAbort?.();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  }

  /**
   * Race a warm-up step against the abort. `Promise.race` leaves the losing
   * plugin call running, which is why `destroy()` in the `finally` block is
   * load-bearing: it tears the capture session down even when we walked away
   * from a still-pending `initialize()`.
   */
  const raceAbort = async (step: Promise<unknown>): Promise<void> => {
    await Promise.race([step, warmUpAborted]);
    if (abortedDuringWarmUp) {
      throw new DOMException("Recording cancelled", "AbortError");
    }
  };

  try {
    // Mark BEFORE the call, not after it resolves: an abort mid-`initialize()`
    // walks away from a capture session that may already be live, and keying
    // teardown off completion would leak exactly the camera handle this
    // function exists to protect.
    await raceAbort(
      VideoRecorder.initialize({
        camera: VideoRecorderCamera.BACK,
        // 1080p matches the 1080x1920 the web MediaRecorder path requests, so
        // a clip looks the same on either platform.
        quality: VideoRecorderQuality.MAX_1080P,
        // Left unset, the plugin encodes at a 3 Mbps default hardcoded in its
        // native sources — well below what the web path asks for, so the same
        // trick came out visibly softer on native. Pass the shared constant so
        // neither platform has a quality advantage. See the ceiling arithmetic
        // in src/constants/video.ts.
        videoBitrate: VIDEO_BITS_PER_SECOND,
        autoShow: true,
        previewFrames: [PREVIEW_FRAME],
      }).catch((err: unknown) => {
        initializeRejected = true;
        throw err;
      }),
    );

    await raceAbort(VideoRecorder.startRecording());

    // Frames are now being captured. From here an abort means "stop and keep
    // what we have" rather than "cancel", so retire the warm-up handler and
    // let the duration race below take over.
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort);
      onAbort = null;
    }

    onRecordingStarted?.();

    // Stop recording on whichever fires first: an external abort (UI stop
    // button) or the hard duration cap. The plugin exposes no native
    // max-duration option, and a runaway recording could blow past the
    // 50 MB Storage rule ceiling, so we enforce both here.
    await new Promise<void>((resolve) => {
      // An abort that landed in the gap between retiring the warm-up handler
      // and arming this one would otherwise wait out the full cap.
      if (signal?.aborted) {
        resolve();
        return;
      }
      // Seconds → ms here (rather than taking a pre-multiplied constant)
      // because the cap is a per-call parameter now: the game path passes the
      // 20 s turn cap, the user-clip path the longer 30 s one.
      autoStopTimer = setTimeout(resolve, maxDurationSeconds * 1000);
      if (signal) {
        onAbort = () => resolve();
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });

    const { videoUrl } = await VideoRecorder.stopRecording();
    if (!videoUrl) {
      throw new Error("Native camera returned no file path");
    }

    // `videoUrl` is a filesystem URI (file:///…mp4 on iOS/Android). Fetching
    // it gives us a Blob; the browser runtime inside the webview handles
    // the file:// scheme for us.
    const response = await fetch(videoUrl);
    const rawBlob = await response.blob();

    // The webview sometimes returns a blob with an empty / generic MIME
    // type when reading a local file, and iOS can occasionally report
    // `video/quicktime` for .mp4-containerised clips. Firebase Storage
    // rules (storage.rules) only accept `video/mp4` or `video/webm` on
    // the native path, so coerce anything else to `video/mp4` — which
    // is what AVFoundation (iOS) and FancyCamera (Android) actually
    // produce. This keeps `mimeType.startsWith("video/")` true and
    // guarantees storage.ts picks the `.mp4` extension.
    const detected = rawBlob.type;
    const mimeType = detected === "video/mp4" || detected === "video/webm" ? detected : "video/mp4";
    // Re-wrap so downstream consumers (Firebase Storage upload) see a
    // blob whose `.type` matches the declared `mimeType`.
    const blob = detected === mimeType ? rawBlob : new Blob([rawBlob], { type: mimeType });

    return { blob, mimeType };
  } finally {
    if (autoStopTimer !== null) {
      clearTimeout(autoStopTimer);
    }
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
    if (!initializeRejected) {
      // Release the native camera + preview layer. Swallow errors here —
      // a failure to tear down shouldn't mask the real error (if any)
      // that's already propagating out of the try block. Breadcrumb so
      // operators can see if destroy() is silently failing in the field.
      try {
        await VideoRecorder.destroy();
      } catch (destroyErr) {
        // Non-Error teardown rejections are effectively unreachable — the
        // plugin rejects with real Error objects. The `String(…)` fallback
        // is a defensive safety net and not worth chasing in tests.
        /* v8 ignore next */
        const message = destroyErr instanceof Error ? destroyErr.message : String(destroyErr);
        addBreadcrumb({
          category: "lifecycle",
          message: "video_recorder_destroy_failed",
          data: { error: message },
        });
      }
    }
  }
}
