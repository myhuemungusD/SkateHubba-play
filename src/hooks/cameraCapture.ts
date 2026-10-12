import { logger } from "../services/logger";

/** Which physical camera to request. */
export type FacingMode = "environment" | "user";

/**
 * Browser capture constraints for a one-take trick clip.
 *
 * The viewfinder is a 9:16 frame, but phone sensors are landscape. Asking for
 * 1080×1920 (or aspectRatio 9/16) makes the browser crop that sensor to fill
 * the frame — a digital zoom — and `object-fit: cover` was cropping whatever
 * landscape frame came back a second time. 1920×1080 is the wide 1080p mode;
 * the viewfinder uses `object-contain`, so the preview shows the same pixels
 * that are recorded. The crosshair stays centered on that frame.
 *
 * 60fps is `ideal` only. Chrome on Android cannot deliver 60fps to
 * getUserMedia / MediaRecorder (it also only encodes VP8/VP9), and a hard
 * `min`/`exact` throws OverconstrainedError instead of opening the camera.
 * The `advanced` list is optional: 1080p60, then 1080p30, then 720p.
 */

export const CAPTURE_WIDTH = 1920;
export const CAPTURE_HEIGHT = 1080;
export const CAPTURE_ASPECT = CAPTURE_WIDTH / CAPTURE_HEIGHT;
const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;
const IDEAL_FPS = 60;
const FALLBACK_FPS = 30;

/**
 * Mic constraints. Voice-call DSP is destructive to skate audio:
 * echoCancellation ducks the street bed, noiseSuppression eats board pop,
 * autoGainControl pumps the level between silence and impact.
 */
export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

const WEBM_MIME_CANDIDATES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"] as const;

/** Safari/WebKit record H.264. `avc1.42E01E` is the profile `isTypeSupported` actually accepts. */
const MP4_MIME_CANDIDATES = ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=h264", "video/mp4"] as const;

/** iPhone, iPod, iPad, and iPadOS desktop mode (Macintosh UA + touch + Safari). */
export function isIOSDevice(): boolean {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return (
    /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua) && navigator.maxTouchPoints > 1
  );
}

/**
 * WebKit's MediaRecorder is H.264/MP4, including Chrome/Firefox/Edge on iOS
 * (they are WebKit shells). Chrome on Android only records VP8/VP9, so it
 * stays on WebM — forcing MP4 there yields an empty recorder.
 */
export function prefersH264Mp4(): boolean {
  if (isIOSDevice()) return true;
  const ua = navigator.userAgent || "";
  return /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
}

export function recorderMimeCandidates(): readonly string[] {
  return prefersH264Mp4()
    ? [...MP4_MIME_CANDIDATES, ...WEBM_MIME_CANDIDATES]
    : [...WEBM_MIME_CANDIDATES, ...MP4_MIME_CANDIDATES];
}

export function videoConstraints(facingMode: FacingMode, deviceId?: string): MediaTrackConstraints {
  // deviceId and facingMode together overconstrain iOS. The id was chosen
  // because facingMode picked the wrong lens; don't send both.
  const lens: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: { ideal: facingMode } };
  return {
    ...lens,
    width: { ideal: CAPTURE_WIDTH },
    height: { ideal: CAPTURE_HEIGHT },
    aspectRatio: { ideal: CAPTURE_ASPECT },
    frameRate: { ideal: IDEAL_FPS },
    advanced: [
      { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT, frameRate: IDEAL_FPS },
      { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT, frameRate: FALLBACK_FPS },
      { width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT, frameRate: IDEAL_FPS },
      { width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT, frameRate: FALLBACK_FPS },
    ],
  };
}

/**
 * Which enumerated video device is the 1× camera on iOS.
 *
 * Since iOS 16.4, `facingMode: "environment"` opens the ultra-wide lens
 * (https://bugs.webkit.org/show_bug.cgi?id=253186). Labels are localized, so
 * they cannot be matched. WebKit's enumerate order is stable: videoinputs[0]
 * is the front camera, videoinputs[1] is the main rear camera. Anything later
 * is another rear lens. This order is wrong on Android Chrome — callers must
 * not use it there.
 */
export function iosVideoDeviceId(
  devices: readonly { kind: string; deviceId: string }[],
  facingMode: FacingMode,
): string | undefined {
  const videos = devices.filter((device) => device.kind === "videoinput" && device.deviceId !== "");
  const index = cameraIndex(facingMode);
  return videos[index]?.deviceId;
}

function cameraIndex(facingMode: FacingMode): number {
  switch (facingMode) {
    case "user":
      return 0;
    case "environment":
      return 1;
    /* v8 ignore start -- closed union; this only fails the build if a facing mode is added */
    default: {
      const unreachable: never = facingMode;
      return unreachable;
    }
    /* v8 ignore stop */
  }
}

function firstVideo(stream: MediaStream): MediaStreamTrack | undefined {
  return stream.getVideoTracks()[0];
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function zoomRange(track: MediaStreamTrack): { min: number; max: number } | null {
  try {
    const zoom = track.getCapabilities().zoom;
    if (zoom?.min === undefined || zoom.max === undefined) return null;
    return { min: zoom.min, max: zoom.max };
  } catch {
    return null;
  }
}

/**
 * The device-id we picked is only kept when the opened track still looks like
 * the camera we asked for. `facingMode` rejects a front camera handed back for
 * a rear request. A zoom range that cannot express 1× is a telephoto (min > 1)
 * or an ultra-wide (max < 1). Missing capabilities are not a rejection — iOS
 * often omits them, and the enumerate order is then the only signal we have.
 */
export function trackMatchesRequestedCamera(track: MediaStreamTrack, facingMode: FacingMode): boolean {
  const reported = track.getSettings().facingMode;
  if (reported && reported !== facingMode) return false;
  const zoom = zoomRange(track);
  if (!zoom) return true;
  return zoom.min <= 1 && zoom.max >= 1;
}

/**
 * On iOS, reopen the stream on the enumerated 1× camera. Anywhere else, return
 * `stream` unchanged — the same index selects the wrong camera on Android Chrome.
 *
 * The facingMode stream is stopped before the deviceId open. iOS will not
 * start a second camera while the first track is still live, so keeping it
 * "as a fallback" makes the swap fail and leaves the ultra-wide lens in place.
 * If the 1× open fails or the track does not look like the camera we asked
 * for, the facingMode request is issued again.
 *
 * When `isStale` flips during the deviceId open, that new stream is returned
 * so the caller can release it. A stream that is never returned would keep
 * the camera running.
 */
export async function selectIosCamera(
  stream: MediaStream,
  facingMode: FacingMode,
  isStale: () => boolean,
): Promise<MediaStream> {
  if (!isIOSDevice() || isStale()) return stream;

  let devices: MediaDeviceInfo[];
  try {
    const enumerate = navigator.mediaDevices.enumerateDevices;
    if (typeof enumerate !== "function") return stream;
    devices = await enumerate.call(navigator.mediaDevices);
  } catch (err) {
    logger.warn("camera_enumerate_failed", { error: errorMessage(err) });
    return stream;
  }
  if (isStale()) return stream;

  const nextId = iosVideoDeviceId(devices, facingMode);
  const currentId = firstVideo(stream)?.getSettings().deviceId;
  if (!nextId || nextId === currentId) return stream;

  // Release the lens facingMode opened before asking for the 1× camera.
  stopStream(stream);
  if (isStale()) return stream;

  let next: MediaStream;
  try {
    next = await openCameraStream(facingMode, nextId);
  } catch (err) {
    logger.warn("camera_device_reselect_failed", { error: errorMessage(err) });
    if (isStale()) throw err;
    return restoreFacingMode(facingMode);
  }
  if (isStale()) return next;

  const nextVideo = firstVideo(next);
  if (!nextVideo || !trackMatchesRequestedCamera(nextVideo, facingMode)) {
    logger.warn("camera_device_reselect_rejected", { facingMode, deviceId: nextId });
    stopStream(next);
    if (isStale()) return next;
    return restoreFacingMode(facingMode);
  }

  return next;
}

function openCameraStream(facingMode: FacingMode, deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: videoConstraints(facingMode, deviceId),
    audio: AUDIO_CONSTRAINTS,
  });
}

/** The deviceId open failed. Ask for facingMode again — the first stream is already stopped. */
async function restoreFacingMode(facingMode: FacingMode): Promise<MediaStream> {
  try {
    return await openCameraStream(facingMode);
  } catch (err) {
    logger.warn("camera_facing_mode_restore_failed", { error: errorMessage(err) });
    throw err;
  }
}

function isBelow720p(settings: MediaTrackSettings): boolean {
  const { width, height } = settings;
  if (!width || !height) return false;
  return Math.min(width, height) < 720 || Math.max(width, height) < FALLBACK_WIDTH;
}

/** What the camera actually opened, so a grainy/zoomed report can be diagnosed. */
export function logCameraSettings(track: MediaStreamTrack): void {
  const settings = track.getSettings();
  logger.info("camera_track_settings", {
    width: settings.width ?? null,
    height: settings.height ?? null,
    frameRate: settings.frameRate ?? null,
    zoom: settings.zoom ?? null,
    facingMode: settings.facingMode ?? null,
  });
}

/**
 * Pull a sub-720p default (commonly 640×480) up to 720p, and set optical zoom
 * to 1× when the track can express it. Failures are logged and swallowed —
 * a rejected zoom must not throw away a camera that is already open.
 */
export async function tuneVideoTrack(track: MediaStreamTrack): Promise<void> {
  if (isBelow720p(track.getSettings())) {
    try {
      await track.applyConstraints({
        width: { ideal: FALLBACK_WIDTH },
        height: { ideal: FALLBACK_HEIGHT },
        aspectRatio: { ideal: CAPTURE_ASPECT },
        frameRate: { ideal: FALLBACK_FPS },
      });
    } catch (err) {
      logger.warn("camera_resolution_fallback_failed", { error: errorMessage(err) });
    }
  }

  const zoom = zoomRange(track);
  if (zoom && (zoom.min > 1 || zoom.max < 1)) {
    logger.warn("camera_zoom_not_1x", { min: zoom.min, max: zoom.max });
  } else if (zoom && track.getSettings().zoom !== 1) {
    try {
      await track.applyConstraints({ advanced: [{ zoom: 1 }] });
    } catch (err) {
      logger.warn("camera_zoom_lock_failed", { error: errorMessage(err) });
    }
  }

  logCameraSettings(track);
}
