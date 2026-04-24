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
 *
 * NOTE: the underlying plugin previously shipped here was
 * `@capacitor/camera`'s `Camera.getPhoto`, which is a *still-photo* API
 * and therefore never produced a video — breaking the core gameplay
 * loop on native builds. This module is the fix.
 */

import { Capacitor } from "@capacitor/core";
import {
  VideoRecorder,
  VideoRecorderCamera,
  VideoRecorderQuality,
  type VideoRecorderPreviewFrame,
} from "@capacitor-community/video-recorder";
import { MAX_VIDEO_DURATION_MS } from "../constants/video";

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
 *   3. After `MAX_VIDEO_DURATION_MS` the recording auto-stops (the plugin
 *      has no native hard cap, so we enforce it here).
 *   4. `stopRecording()` returns the temp-file URI, which we `fetch()`
 *      into a Blob for the uploader.
 *   5. `destroy()` releases the capture device in a `finally` block so
 *      we never leak the camera handle, even on error.
 *
 * Resolves with `{ blob, mimeType }` where `mimeType.startsWith("video/")`
 * is always true. Rejects on permission denial, user cancel, or when the
 * plugin fails to return a file URI.
 */
export async function recordNativeVideo(): Promise<NativeVideoResult> {
  let initialized = false;
  let autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    await VideoRecorder.initialize({
      camera: VideoRecorderCamera.BACK,
      quality: VideoRecorderQuality.MAX_720P,
      autoShow: true,
      previewFrames: [PREVIEW_FRAME],
    });
    initialized = true;

    await VideoRecorder.startRecording();

    // Hard-cap duration client-side. The plugin does not expose a native
    // max-duration option, and a runaway recording could blow past the
    // 50 MB Storage rule ceiling.
    const autoStop = new Promise<void>((resolve) => {
      autoStopTimer = setTimeout(resolve, MAX_VIDEO_DURATION_MS);
    });
    await autoStop;

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
    if (initialized) {
      // Release the native camera + preview layer. Swallow errors here —
      // a failure to tear down shouldn't mask the real error (if any)
      // that's already propagating out of the try block.
      try {
        await VideoRecorder.destroy();
      } catch {
        // best-effort cleanup
      }
    }
  }
}
