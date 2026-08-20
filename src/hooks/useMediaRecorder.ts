import { useState, useRef, useCallback, useEffect } from "react";
import { MAX_VIDEO_DURATION_SECONDS, MIN_UPLOAD_BYTES, VIDEO_BITS_PER_SECOND } from "../constants/video";
import { isNativePlatform, recordNativeVideo } from "../services/nativeVideo";
import { logger } from "../services/logger";
import { parseFirebaseError } from "../utils/helpers";

/* ────────────────────────────────────────────
 * Capture controller for <VideoRecorder>.
 *
 * Owns every moving part of a "ONE TAKE" clip: getUserMedia acquisition,
 * MediaRecorder lifecycle on the web, the Capacitor plugin on native, the
 * elapsed-seconds timer, the hard duration cap, and teardown. The component
 * that consumes it is pure chrome — it renders what this returns.
 *
 * Extracted from VideoRecorder.tsx because the component was ~70 LOC over
 * its 250 LOC budget before this round of fixes and would have landed at
 * ~410 with them.
 * ──────────────────────────────────────────── */

/** Lifecycle of a single take. Shared by the web and native capture paths. */
export type CaptureState = "idle" | "preview" | "recording" | "done";

/** Which physical camera to request. */
export type FacingMode = "environment" | "user";

/**
 * MediaRecorder container/codec candidates, most-preferred first.
 *
 * Order matters and the MP4 entries are load-bearing: Safari's MediaRecorder
 * supports NEITHER `video/webm;codecs=vp9` NOR `video/webm`, so probing only
 * those two left `mimeType` empty and handed Safari its H.264/MP4 default —
 * which we then mislabelled as WebM (see `recordedBlobType`).
 */
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=h264",
  "video/mp4",
] as const;

/** Canvas capture rate used when the camera track won't report its own fps. */
const FALLBACK_CAPTURE_FPS = 30;

/**
 * Interval passed to `MediaRecorder.start()`, forcing a `dataavailable` chunk
 * every second.
 *
 * Without a timeslice the recorder is free to hold the entire take in its
 * internal buffer and emit it as one blob at `stop()`. iOS Safari regularly
 * materialises nothing at all that way for short clips, producing an empty or
 * near-empty file. Flushing on a fixed cadence means chunks exist by the time
 * we stop, whatever the platform decides to do.
 */
const RECORDER_TIMESLICE_MS = 1000;

/**
 * True on iOS Safari (including iPadOS), where WebGL-canvas `captureStream`
 * into MediaRecorder is unreliable and commonly yields black or near-empty
 * files. Chrome/Firefox on iOS are excluded — they are WebKit shells but do
 * not exhibit the same capture path.
 */
export function isIOSSafari(): boolean {
  // No `typeof navigator` guard: every caller runs in the browser — startRec
  // (after getUserMedia resolved) and VideoRecorder's render path. There is no
  // SSR in this app.
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
  return isIOS && isSafari;
}

/**
 * Mic constraints. Voice-call DSP is tuned for speech and is destructive to
 * skate audio: echoCancellation ducks the ambient street bed, noiseSuppression
 * eats board pop and grind transients as "noise", and autoGainControl pumps the
 * level between silence and impact. Record the raw mic instead.
 */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/**
 * Portrait HD to match the 9/16 viewfinder. Every field is `ideal`, never
 * `exact`/`min`/`max` — those are hard constraints, and one the hardware can't
 * satisfy throws OverconstrainedError, leaving the user with no camera at all.
 * `ideal` degrades to the closest supported mode instead. Browsers otherwise
 * commonly default to 640×480. Skating reads far better at 60fps, hence the
 * high `ideal` rate, but a 30fps sensor must still be allowed to open.
 */
function videoConstraints(facingMode: FacingMode): MediaTrackConstraints {
  return {
    facingMode: { ideal: facingMode },
    width: { ideal: 1080 },
    height: { ideal: 1920 },
    frameRate: { ideal: 60 },
  };
}

/** First supported candidate, or "" to let the browser pick its default. */
function pickRecorderMimeType(): string {
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

/** Strip codec parameters: `video/webm;codecs=vp9,opus` → `video/webm`. */
function containerOf(mime: string | undefined): string {
  if (typeof mime !== "string") return "";
  return mime.split(";")[0].trim().toLowerCase();
}

/**
 * MIME type to stamp on the finished blob.
 *
 * This used to be the string literal "video/webm", which corrupted every
 * Safari/iOS-web clip: Safari records H.264/MP4, `classifyVideoBlob` in
 * src/services/storage.ts trusts `blob.type`, so MP4 bytes were uploaded to
 * `set.webm` with `Content-Type: video/webm`. storage.rules only checks that
 * the extension and the content-type agree with EACH OTHER — never that either
 * matches the actual bytes — so the write succeeded and the clip was
 * unplayable. `mr.mimeType` is the spec-guaranteed property reflecting what the
 * recorder actually produced, so read that first.
 *
 * Codec parameters must be stripped because `classifyVideoBlob` matches the
 * exact strings "video/mp4", "video/quicktime" and "video/webm";
 * "video/webm;codecs=vp9,opus" would fall through to its platform-default
 * branch instead.
 *
 * Some older browsers leave `mr.mimeType` blank, so fall back to the first
 * chunk's own type and finally to WebM (the web default container).
 */
function recordedBlobType(mr: MediaRecorder, chunks: Blob[]): string {
  return containerOf(mr.mimeType) || containerOf(chunks[0]?.type) || "video/webm";
}

/** Safely read the first video track — the stream may be absent entirely. */
function firstVideoTrack(stream: MediaStream | null): MediaStreamTrack | undefined {
  if (!stream) return undefined;
  return stream.getVideoTracks()[0];
}

/**
 * Frame rate the camera is actually delivering. Hardcoding 30 for the fisheye
 * canvas capture threw away half the frames on the 60fps sensors we now ask for.
 */
function captureFrameRate(stream: MediaStream | null): number {
  const track = firstVideoTrack(stream);
  if (!track) return FALLBACK_CAPTURE_FPS;
  return track.getSettings().frameRate ?? FALLBACK_CAPTURE_FPS;
}

/**
 * Platform-specific recovery hint for a denied camera permission. iOS Safari
 * requires users to toggle the permission in system Settings (the in-app
 * re-prompt is permanent after the first denial); desktop Chrome/Firefox allow
 * re-granting from the URL bar. We tailor the copy so users know *where* to look.
 */
function permissionHint(): string {
  if (typeof navigator === "undefined") return "Check your browser permissions and try again.";
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) {
    // Every iOS browser renders through WebKit, which makes it tempting to
    // treat them all as Safari — but camera access on iOS is granted PER APP,
    // so the app named here has to be the one the user is actually holding.
    // Settings → Safari → Camera does not govern Chrome, so sending a Chrome
    // user there is a dead end: they follow the instruction exactly, nothing
    // changes, and the app looks broken rather than un-permissioned.
    //
    // Order matters. These tokens must be checked BEFORE falling through to
    // Safari, because every one of them also carries a `Safari/` token.
    if (/CriOS/.test(ua)) return "Open Settings → Chrome → Camera and allow access, then reload.";
    if (/FxiOS/.test(ua)) return "Open Settings → Firefox → Camera and allow access, then reload.";
    if (/EdgiOS/.test(ua)) return "Open Settings → Edge → Camera and allow access, then reload.";
    return "Open Settings → Safari → Camera and allow access, then reload.";
  }
  if (/Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua)) {
    return "Click the camera icon in Safari's address bar and allow access.";
  }
  return "Tap the lock/camera icon in your address bar and allow access.";
}

export interface MediaRecorderController {
  /** Current lifecycle state — drives every branch of the viewfinder chrome. */
  state: CaptureState;
  /** Object URL of the finished take, or null before one exists. */
  blobUrl: string | null;
  /** Elapsed seconds of the in-flight take. */
  seconds: number;
  /** User-facing camera failure, or null. */
  cameraError: string | null;
  /** True when running inside a Capacitor native shell. */
  isNative: boolean;
  /** Which camera is currently requested. */
  facingMode: FacingMode;
  /** Ref callback for the live preview <video>. */
  setVideoRef: (el: HTMLVideoElement | null) => void;
  /** The preview element, as state, so FisheyeRenderer re-runs when it mounts. */
  videoEl: HTMLVideoElement | null;
  /** Whether the fisheye shader is armed. */
  fisheyeOn: boolean;
  toggleFisheye: () => void;
  /** Ref callback letting FisheyeRenderer hand us its canvas for captureStream. */
  setFisheyeCanvas: (canvas: HTMLCanvasElement | null) => void;
  openCamera: () => Promise<void>;
  flipCamera: () => void;
  startRec: () => void;
  stopRec: () => void;
  startNativeRec: () => Promise<void>;
  stopNativeRec: () => void;
}

/**
 * Drive a one-take video capture. `onRecorded` receives the finished blob, or
 * null when the take produced no usable bytes.
 *
 * `maxDurationSeconds` is the hard auto-stop for the take, defaulting to the
 * game cap. It is a parameter rather than a direct constant read because the
 * two clip kinds have different caps (20 s for a game turn, 30 s for a
 * standalone user clip) and the recorder itself has no way to know which one
 * it is filming — the caller does.
 */
export function useMediaRecorder(
  onRecorded: (blob: Blob | null) => void,
  maxDurationSeconds: number = MAX_VIDEO_DURATION_SECONDS,
): MediaRecorderController {
  // Mirror the cap in a ref so the recording callbacks can read the current
  // value without listing it in their deps. `startRec`'s identity feeds
  // memoized children; rebuilding it because a prop re-rendered with the same
  // number would defeat that for no behavioural gain.
  const maxDurationRef = useRef(maxDurationSeconds);
  maxDurationRef.current = maxDurationSeconds;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    setVideoEl(el);
  }, []);

  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number>(0);
  const maxTimerRef = useRef<number>(0);
  const blobUrlRef = useRef<string | null>(null);
  const trackEndedCleanupRef = useRef<(() => void) | null>(null);
  const nativeAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  // Bumped on every openCamera call so a late-resolving older acquisition can
  // tell it has been superseded. See openCamera for why this is load-bearing.
  const acquireGenerationRef = useRef(0);

  const [state, setState] = useState<CaptureState>("idle");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [fisheyeOn, setFisheyeOn] = useState(false);
  const fisheyeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fisheyeStreamRef = useRef<MediaStream | null>(null);
  const toggleFisheye = useCallback(() => setFisheyeOn((v) => !v), []);
  const setFisheyeCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    fisheyeCanvasRef.current = canvas;
  }, []);

  // Facing mode lives in a ref *and* state: the ref is what openCamera reads,
  // so flipCamera can re-acquire with the new value in the same tick instead of
  // waiting for a re-render; the state drives the toggle's aria-pressed.
  const facingModeRef = useRef<FacingMode>("environment");
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");

  /**
   * Stop the live camera/mic tracks and detach their `ended` guard.
   *
   * Clearing `streamRef` is part of the contract, not tidiness: `startRec`
   * gates on `!streamRef.current`, so leaving a stopped stream reachable let
   * that guard pass and built a MediaRecorder over dead tracks. That is
   * exactly what happened when a re-acquire failed — `openCamera` stops the
   * old stream before awaiting, so a rejected `getUserMedia` (flipping to a
   * camera that doesn't exist, permission revoked between attempts, device
   * busy) left the previous, now-stopped stream in place while the UI still
   * read "preview".
   */
  const stopTracks = useCallback(() => {
    trackEndedCleanupRef.current?.();
    trackEndedCleanupRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  /**
   * Stop a stream we acquired but are not going to use — a late arrival from a
   * superseded `openCamera`, or one that resolved after unmount. It was never
   * assigned to `streamRef`, so `stopTracks` cannot reach it.
   */
  const stopOrphanStream = useCallback((stream: MediaStream) => {
    stream.getTracks().forEach((t) => t.stop());
  }, []);

  /**
   * Clear both timers and tear the recorder down *without* letting its `onstop`
   * fire. Used by the paths where the take is unusable (encoder error, device
   * revoked, unmount) — a live `onstop` there would setState post-teardown.
   */
  const discardRecorder = useCallback(() => {
    clearInterval(timerRef.current);
    clearTimeout(maxTimerRef.current);
    const mr = mrRef.current;
    if (mr) {
      mr.ondataavailable = null;
      mr.onstop = null;
      mr.onerror = null;
      if (mr.state === "recording") {
        try {
          mr.stop();
        } catch {
          // Already stopped / never started; safe to ignore.
        }
      }
    }
    mrRef.current = null;
    chunksRef.current = [];
    fisheyeStreamRef.current = null;
  }, []);

  /**
   * The OS can revoke the camera with no error surfacing at all (iOS
   * backgrounding, another app claiming the device) — the preview simply goes
   * black. `ended` is the only signal. A deliberate `track.stop()` does NOT
   * fire `ended`, so anything reaching the handler is an involuntary loss.
   */
  const watchTrackEnded = useCallback(
    (stream: MediaStream | null) => {
      const track = firstVideoTrack(stream);
      if (!track) return;
      /* v8 ignore start -- real MediaStreamTrack events cannot be produced in JSDOM */
      const handleEnded = () => {
        // Ignore a stale listener left over from a stream we already replaced,
        // and anything arriving after unmount.
        if (streamRef.current !== stream || !mountedRef.current) return;
        discardRecorder();
        stopTracks();
        streamRef.current = null;
        setCameraError("Camera disconnected. Reopen the camera and try again.");
        setState("idle");
        logger.warn("camera_track_ended", {});
      };
      track.addEventListener("ended", handleEnded);
      trackEndedCleanupRef.current = () => track.removeEventListener("ended", handleEnded);
      /* v8 ignore stop */
    },
    [discardRecorder, stopTracks],
  );

  /**
   * Acquire the camera. Safe to call concurrently with itself.
   *
   * `openCamera` is re-entrant — the flip button and "Retry Camera" stay
   * mounted and clickable for the whole `getUserMedia` wait (which includes
   * the OS permission dialog), and the `autoOpen` effect can race a user tap.
   * Without a guard, two overlapping calls both clear the pre-await teardown
   * before either stream exists, so whichever resolves LAST wins `streamRef`
   * and the other is orphaned while still live — unreachable by `stopTracks`
   * or the unmount cleanup, both of which walk only `streamRef`. That left a
   * camera and mic hot for the rest of the session: recording indicator lit,
   * battery draining, device held against other apps.
   *
   * A generation counter makes the newest call authoritative; any older one
   * that resolves late stops the stream it acquired and returns without
   * touching state. The same check covers unmount-during-acquisition, which
   * otherwise assigned a live stream into a dead component whose cleanup had
   * already run against a null `streamRef`.
   */
  const openCamera = useCallback(async (): Promise<void> => {
    setCameraError(null);
    // Stop any existing tracks (and detach their `ended` guard) before
    // acquiring a new stream — also the re-acquire path used by flipCamera.
    stopTracks();
    const generation = ++acquireGenerationRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(facingModeRef.current),
        audio: AUDIO_CONSTRAINTS,
      });
      if (generation !== acquireGenerationRef.current || !mountedRef.current) {
        stopOrphanStream(stream);
        return;
      }
      streamRef.current = stream;
      watchTrackEnded(stream);
      /* v8 ignore start -- DOM ref assignment; videoRef always null in JSDOM tests */
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      }
      /* v8 ignore stop */
      setState("preview");
    } catch (err) {
      if (generation !== acquireGenerationRef.current || !mountedRef.current) return;
      const isPermission =
        err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      const msg = parseFirebaseError(err);
      setCameraError(isPermission ? `Camera access denied. ${permissionHint()}` : `Camera unavailable: ${msg}`);
      // The previous stream was stopped before the await and `stopTracks`
      // cleared `streamRef`, so there is no camera to return to — send the
      // user back to idle rather than leaving a "preview" that cannot record.
      setState("idle");
      logger.warn("camera_access_failed", { error: msg });
    }
  }, [stopTracks, stopOrphanStream, watchTrackEnded]);

  /**
   * Swap between the rear and selfie camera. Pre-record only (see the toggle's
   * visibility rule in VideoRecorder.tsx): swapping the device mid-take would
   * strand the MediaRecorder on a stream whose tracks we just stopped.
   */
  const flipCamera = useCallback(() => {
    facingModeRef.current = facingModeRef.current === "environment" ? "user" : "environment";
    setFacingMode(facingModeRef.current);
    void openCamera();
  }, [openCamera]);

  const startRec = useCallback(() => {
    if (!streamRef.current) {
      // Camera open silently failed (no stream acquired) — surface the error
      // and stay in pre-record state instead of pretending to record without
      // a MediaRecorder, max-timer, or onRecorded callback.
      setCameraError("Camera unavailable: no active stream. Please reopen the camera.");
      logger.warn("start_rec_without_stream", {});
      return;
    }

    chunksRef.current = [];

    // Determine the stream to record: fisheye canvas + audio, or raw camera.
    let recordStream = streamRef.current;
    /* v8 ignore start -- captureStream + fisheye canvas requires real browser; not available in JSDOM */
    if (fisheyeOn && fisheyeCanvasRef.current && isIOSSafari()) {
      // Recording the WebGL canvas is unreliable here and produces black or
      // near-empty files. Keep fisheye as a live *preview* effect and record
      // the raw camera stream, so an iPhone user gets a real clip rather than
      // an unplayable one. Logged so the telemetry shows how often the effect
      // silently degrades.
      logger.warn("fisheye_record_unsupported", { hint: "recording raw stream on iOS Safari" });
    } else if (fisheyeOn && fisheyeCanvasRef.current) {
      try {
        const canvasStream = fisheyeCanvasRef.current.captureStream(captureFrameRate(streamRef.current));
        // Add audio tracks from the camera stream to the canvas stream
        const audioTracks = streamRef.current.getAudioTracks();
        for (const track of audioTracks) {
          canvasStream.addTrack(track);
        }
        fisheyeStreamRef.current = canvasStream;
        recordStream = canvasStream;
      } catch {
        // captureStream not supported — fall back to raw stream
        logger.warn("capture_stream_unsupported", { hint: "recording without fisheye" });
      }
    }
    /* v8 ignore stop */

    const mimeType = pickRecorderMimeType();
    const options: MediaRecorderOptions = { videoBitsPerSecond: VIDEO_BITS_PER_SECOND };
    if (mimeType) options.mimeType = mimeType;
    const mr = new MediaRecorder(recordStream, options);
    mr.ondataavailable = (e) => {
      /* v8 ignore start -- MediaRecorder ondataavailable requires real browser */
      if (e.data.size > 0) chunksRef.current.push(e.data);
      /* v8 ignore stop */
    };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recordedBlobType(mr, chunksRef.current) });
      // Teardown is unconditional: the zero-byte path used to return early and
      // leave the camera + mic live (indicator light on, battery draining)
      // until the component unmounted.
      stopTracks();
      fisheyeStreamRef.current = null;
      if (blob.size === 0) {
        setState("done");
        onRecorded(null);
        return;
      }
      if (blob.size <= MIN_UPLOAD_BYTES) {
        // A non-empty but unusably small take — the failure mode iOS Safari
        // produces when the encoder yields almost nothing. Uploading it would
        // be rejected by storage.rules and surface "Video is too small to
        // upload" long after the user left the camera. Fail here instead, on
        // the recording screen, where "try again" actually means something.
        logger.warn("recording_too_small", { size: blob.size, mimeType: blob.type });
        setCameraError("Recording failed on this device. Please try again.");
        setState("idle");
        onRecorded(null);
        return;
      }
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setBlobUrl(url);
      setState("done");
      onRecorded(blob);
    };
    /* v8 ignore start -- encoder failures cannot be provoked in JSDOM */
    mr.onerror = () => {
      // Without this the encoder dying mid-take leaves the user stuck in
      // `recording` with a running timer and no exit but a page reload:
      // `onstop` is not guaranteed to fire after an error.
      discardRecorder();
      stopTracks();
      // Drop the stream so a retry has to reopen the camera — its tracks are
      // stopped and startRec's guard would otherwise wave a dead stream through.
      streamRef.current = null;
      setCameraError("Recording failed and the take was lost. Reopen the camera and try again.");
      setState("preview");
      logger.warn("media_recorder_failed", {});
    };
    /* v8 ignore stop */
    mrRef.current = mr;
    mr.start(RECORDER_TIMESLICE_MS);
    setState("recording");
    setSeconds(0);
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    // Auto-stop at max duration
    /* v8 ignore start -- auto-stop timer requires real MediaRecorder; not exercisable in JSDOM */
    maxTimerRef.current = window.setTimeout(() => {
      clearInterval(timerRef.current);
      if (mrRef.current?.state === "recording") {
        mrRef.current.stop();
      }
    }, maxDurationRef.current * 1000);
    /* v8 ignore stop */
  }, [onRecorded, fisheyeOn, discardRecorder, stopTracks]);

  const stopRec = useCallback(() => {
    clearInterval(timerRef.current);
    clearTimeout(maxTimerRef.current);
    if (mrRef.current?.state === "recording") {
      mrRef.current.stop();
    } else {
      setState("done");
      onRecorded(null);
    }
  }, [onRecorded]);

  // --- Native (Capacitor) recording path ---
  const isNative = isNativePlatform();

  /**
   * Native capture reuses the same state machine and timers as the web path so
   * the viewfinder chrome (REC chip, elapsed timer, auto-stop warning, Stop
   * button) behaves identically. Previously it stayed in `idle` for the whole
   * take: the user tapped "Record Video", stared at "Tap to open camera" for
   * the full duration, then the UI jumped straight to done with no way to stop.
   *
   * State flips to `recording` synchronously — the Stop button must exist
   * during camera warm-up, and `recordNativeVideo` honours an abort that
   * arrives then — but the elapsed timer deliberately does NOT start here. It
   * starts from the service's `onRecordingStarted` callback, once frames are
   * actually being captured. Starting it synchronously made the on-screen
   * clock lead the real take by the whole plugin startup (an OS permission
   * dialog on first launch is 10+ seconds), so the "Auto-stop in Ns" warning
   * fired far too early and then vanished while the camera was still rolling.
   */
  const startNativeRec = useCallback(async (): Promise<void> => {
    setCameraError(null);
    const controller = new AbortController();
    nativeAbortRef.current = controller;
    setState("recording");
    setSeconds(0);
    try {
      const result = await recordNativeVideo(
        controller.signal,
        () => {
          /* v8 ignore next -- guards an unmount that lands inside the plugin callback */
          if (!mountedRef.current) return;
          // Cap the displayed count: the interval outlives the recording itself
          // (stopRecording + fetch + destroy all run after the cap fires), and
          // without this the REC chip ticked past the limit — 0:21, 0:22, 0:23…
          const cap = maxDurationRef.current;
          timerRef.current = window.setInterval(() => setSeconds((s) => (s < cap ? s + 1 : s)), 1000);
        },
        maxDurationRef.current,
      );
      clearInterval(timerRef.current);
      /* v8 ignore next -- unmount-during-native-capture race; no native shell in JSDOM */
      if (!mountedRef.current) return;
      const url = URL.createObjectURL(result.blob);
      blobUrlRef.current = url;
      setBlobUrl(url);
      setState("done");
      onRecorded(result.blob);
    } catch (err) {
      clearInterval(timerRef.current);
      /* v8 ignore next -- unmount-during-native-capture race; no native shell in JSDOM */
      if (!mountedRef.current) return;
      const msg = parseFirebaseError(err);
      setState("idle");
      if (msg.toLowerCase().includes("cancel")) {
        // User cancelled — back to idle with no error surfaced.
        return;
      }
      setCameraError(`Native camera error: ${msg}`);
      logger.warn("native_camera_failed", { error: msg });
    } finally {
      nativeAbortRef.current = null;
    }
  }, [onRecorded]);

  /** Stop button on the native path — the service stops on abort. */
  const stopNativeRec = useCallback(() => {
    nativeAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Abort an in-flight native capture so a backgrounded recording doesn't
      // keep the device camera alive after we're gone.
      nativeAbortRef.current?.abort();
      // Detaches handlers before stopping, so a mid-recording unmount can't
      // fire onstop post-unmount and setState-warn.
      discardRecorder();
      stopTracks();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, [discardRecorder, stopTracks]);

  return {
    state,
    blobUrl,
    seconds,
    cameraError,
    isNative,
    facingMode,
    setVideoRef,
    videoEl,
    fisheyeOn,
    toggleFisheye,
    setFisheyeCanvas,
    openCamera,
    flipCamera,
    startRec,
    stopRec,
    startNativeRec,
    stopNativeRec,
  };
}
