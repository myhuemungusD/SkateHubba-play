import { logger } from "../services/logger";

/** Which physical camera to request. */
export type FacingMode = "environment" | "user";

/**
 * Browser capture constraints for a one-take trick clip.
 *
 * The app is vertical. Held in portrait, the ideal frame is 1080×1920
 * (9:16) so a real portrait buffer fills the viewfinder. Held in landscape,
 * the ideal is 1920×1080 (16:9). Mobile browsers swap width and height to
 * match how the phone is held, and a 16:9 preset rotated that way is the
 * full 1× video field of view — not a zoom.
 *
 * An *exact* 1080×1920 is different. Phones have no native portrait preset.
 * Satisfying 9:16 by crop-and-scale slices a 1920×1080 sensor to about
 * 608×1080, which is the zoomed-in look. Those exact sizes are therefore
 * not requested. The exact fallbacks are only the full 16:9 presets
 * (1080p, then 720p). On current iOS and Android that preset, asked for
 * while the phone is upright, is what the browser rotates into a vertical
 * picture. If a 9:16 ideal still comes back as that slice, the tune step
 * replaces it with the 16:9 preset.
 *
 * 60fps is `ideal` only. Chrome on Android cannot deliver 60fps to
 * getUserMedia / MediaRecorder (it also only encodes VP8/VP9), and a hard
 * `min`/`exact` throws OverconstrainedError instead of opening the camera.
 */

/** How the phone is held when the camera opens. Desktop windows use the same check. */
export type HoldOrientation = "portrait" | "landscape";

const LANDSCAPE_WIDTH = 1920;
const LANDSCAPE_HEIGHT = 1080;
const PORTRAIT_WIDTH = 1080;
const PORTRAIT_HEIGHT = 1920;
const FALLBACK_LONG = 1280;
const FALLBACK_SHORT = 720;
const IDEAL_FPS = 60;
const FALLBACK_FPS = 30;

/** Full 16:9 presets. Exact, so a browser cannot satisfy them by slicing to 9:16. */
const WIDE_PRESETS: MediaTrackConstraintSet[] = [
  { width: LANDSCAPE_WIDTH, height: LANDSCAPE_HEIGHT, frameRate: IDEAL_FPS },
  { width: LANDSCAPE_WIDTH, height: LANDSCAPE_HEIGHT, frameRate: FALLBACK_FPS },
  { width: FALLBACK_LONG, height: FALLBACK_SHORT, frameRate: IDEAL_FPS },
  { width: FALLBACK_LONG, height: FALLBACK_SHORT, frameRate: FALLBACK_FPS },
];

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

function readPortrait(): boolean {
  try {
    return window.matchMedia("(orientation: portrait)").matches;
  } catch {
    return false;
  }
}

export function holdOrientation(): HoldOrientation {
  return readPortrait() ? "portrait" : "landscape";
}

export function videoConstraints(
  facingMode: FacingMode,
  deviceId?: string,
  orientation: HoldOrientation = holdOrientation(),
): MediaTrackConstraints {
  // deviceId and facingMode together overconstrain iOS. The id was chosen
  // because facingMode picked the wrong lens; don't send both.
  const lens: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: { ideal: facingMode } };
  const portrait = orientation === "portrait";
  return {
    ...lens,
    width: { ideal: portrait ? PORTRAIT_WIDTH : LANDSCAPE_WIDTH },
    height: { ideal: portrait ? PORTRAIT_HEIGHT : LANDSCAPE_HEIGHT },
    aspectRatio: { ideal: portrait ? PORTRAIT_WIDTH / PORTRAIT_HEIGHT : LANDSCAPE_WIDTH / LANDSCAPE_HEIGHT },
    frameRate: { ideal: IDEAL_FPS },
    advanced: WIDE_PRESETS,
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

function frameSize(settings: MediaTrackSettings): { width: number; height: number } | null {
  const { width, height } = settings;
  if (!width || !height) return null;
  return { width, height };
}

/**
 * True when a portrait frame is a center slice of a wider sensor mode.
 *
 * A rotated 1080p preset is 1080×1920: its long side is the sensor's long
 * side. A 9:16 crop of 1920×1080 is about 608×1080: its long side is the
 * sensor's short side. The second one is the digital zoom. Capabilities
 * that report the same max width and height are not a landscape sensor, so
 * they are left alone.
 */
export function portraitFrameIsSensorCrop(track: MediaStreamTrack): boolean {
  const { width, height } = track.getSettings();
  if (!width || !height || height <= width) return false;
  let maxWidth: number | undefined;
  let maxHeight: number | undefined;
  try {
    const caps = track.getCapabilities();
    maxWidth = caps.width?.max;
    maxHeight = caps.height?.max;
  } catch {
    return false;
  }
  if (maxWidth === undefined || maxHeight === undefined || maxWidth <= 0 || maxHeight <= 0) return false;
  const sensorLong = Math.max(maxWidth, maxHeight);
  const sensorShort = Math.min(maxWidth, maxHeight);
  if (sensorShort / sensorLong > 0.92) return false;
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  const longSideIsSensorShort = Math.abs(longSide - sensorShort) / sensorShort <= 0.08;
  return longSideIsSensorShort && longSide < sensorLong * 0.75 && shortSide / longSide < 0.7;
}

/** Raise a small frame without flipping it from portrait to landscape. */
function resolutionUpgrade(width: number, height: number): MediaTrackConstraints {
  const portrait = height > width;
  const nextWidth = portrait ? FALLBACK_SHORT : FALLBACK_LONG;
  const nextHeight = portrait ? FALLBACK_LONG : FALLBACK_SHORT;
  return {
    width: { ideal: nextWidth },
    height: { ideal: nextHeight },
    aspectRatio: { ideal: nextWidth / nextHeight },
    frameRate: { ideal: FALLBACK_FPS },
  };
}

/** The full 16:9 preset, used when a 9:16 frame is only a slice of it. */
function widePreset(): MediaTrackConstraints {
  return {
    width: { ideal: LANDSCAPE_WIDTH },
    height: { ideal: LANDSCAPE_HEIGHT },
    aspectRatio: { ideal: LANDSCAPE_WIDTH / LANDSCAPE_HEIGHT },
    frameRate: { ideal: IDEAL_FPS },
  };
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
    hold: holdOrientation(),
  });
}

/**
 * Pull a sub-720p default (commonly 640×480) up to 720p, and set optical zoom
 * to 1× when the track can express it. Failures are logged and swallowed —
 * a rejected zoom must not throw away a camera that is already open.
 */
export async function tuneVideoTrack(track: MediaStreamTrack): Promise<void> {
  if (portraitFrameIsSensorCrop(track)) {
    const settings = track.getSettings();
    logger.warn("camera_portrait_crop_rejected", {
      width: settings.width,
      height: settings.height,
    });
    try {
      // Widest 1080p field of view. Replaces the 9:16 slice; does not
      // center-crop the preset down to fill the viewfinder.
      await track.applyConstraints(widePreset());
    } catch (err) {
      logger.warn("camera_portrait_crop_fallback_failed", { error: errorMessage(err) });
    }
  } else {
    const size = frameSize(track.getSettings());
    if (
      size &&
      (Math.min(size.width, size.height) < FALLBACK_SHORT || Math.max(size.width, size.height) < FALLBACK_LONG)
    ) {
      try {
        await track.applyConstraints(resolutionUpgrade(size.width, size.height));
      } catch (err) {
        logger.warn("camera_resolution_fallback_failed", { error: errorMessage(err) });
      }
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
