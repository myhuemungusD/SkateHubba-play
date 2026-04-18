import { useState, useRef, useCallback, useEffect } from "react";
import { Btn } from "./ui/Btn";
import { FilmIcon, CameraIcon, RecordIcon, StopIcon, FisheyeIcon } from "./icons";
import { FisheyeRenderer } from "./FisheyeRenderer";
import { isNativePlatform, recordNativeVideo } from "../services/nativeVideo";
import { logger } from "../services/logger";
import { parseFirebaseError } from "../utils/helpers";

const MAX_RECORDING_SECONDS = 60;

export function VideoRecorder({
  onRecorded,
  label,
  autoOpen = false,
  doneLabel = "Recorded",
}: {
  onRecorded: (blob: Blob | null) => void;
  label: string;
  autoOpen?: boolean;
  doneLabel?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const videoCallbackRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    setVideoEl(el);
  }, []);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number>(0);
  const maxTimerRef = useRef<number>(0);
  const blobUrlRef = useRef<string | null>(null);

  const [state, setState] = useState<"idle" | "preview" | "recording" | "done">("idle");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Fisheye state
  const [fisheyeOn, setFisheyeOn] = useState(false);
  const fisheyeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fisheyeStreamRef = useRef<MediaStream | null>(null);

  const handleFisheyeCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    fisheyeCanvasRef.current = canvas;
  }, []);

  const openCamera = useCallback(async () => {
    setCameraError(null);
    // Stop any existing tracks before acquiring a new stream
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: true,
      });
      streamRef.current = stream;
      /* v8 ignore start -- DOM ref assignment; videoRef always null in JSDOM tests */
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      }
      /* v8 ignore stop */
      setState("preview");
    } catch (err) {
      const isPermission =
        err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      const msg = parseFirebaseError(err);
      // Platform-specific recovery hint. iOS Safari requires users to toggle
      // the permission in system Settings (the in-app re-prompt is permanent
      // after the first denial); desktop Chrome/Firefox allow re-granting from
      // the URL bar. We tailor the copy so users know *where* to look.
      let permissionHint = "Check your browser permissions and try again.";
      if (typeof navigator !== "undefined") {
        const ua = navigator.userAgent || "";
        const isIOS = /iPad|iPhone|iPod/.test(ua);
        const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);
        if (isIOS) {
          permissionHint = "Open Settings → Safari → Camera and allow access, then reload.";
        } else if (isSafari) {
          permissionHint = "Click the camera icon in Safari's address bar and allow access.";
        } else {
          permissionHint = "Tap the lock/camera icon in your address bar and allow access.";
        }
      }
      setCameraError(isPermission ? `Camera access denied. ${permissionHint}` : `Camera unavailable: ${msg}`);
      logger.warn("camera_access_failed", { error: msg });
    }
  }, []);

  const startRec = useCallback(() => {
    if (!streamRef.current) {
      setState("recording");
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
      return;
    }

    chunksRef.current = [];

    // Determine the stream to record: fisheye canvas + audio, or raw camera
    let recordStream = streamRef.current;
    /* v8 ignore start -- captureStream + fisheye canvas requires real browser; not available in JSDOM */
    if (fisheyeOn && fisheyeCanvasRef.current) {
      try {
        const canvasStream = fisheyeCanvasRef.current.captureStream(30);
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

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "";
    const mr = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
    mr.ondataavailable = (e) => {
      /* v8 ignore start -- MediaRecorder ondataavailable requires real browser */
      if (e.data.size > 0) chunksRef.current.push(e.data);
      /* v8 ignore stop */
    };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      if (blob.size === 0) {
        setState("done");
        onRecorded(null);
        return;
      }
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setBlobUrl(url);
      setState("done");
      onRecorded(blob);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      fisheyeStreamRef.current = null;
    };
    mrRef.current = mr;
    mr.start();
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
    }, MAX_RECORDING_SECONDS * 1000);
    /* v8 ignore stop */
  }, [onRecorded, fisheyeOn]);

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

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      clearTimeout(maxTimerRef.current);
      // If we unmount mid-recording, stop the MediaRecorder after detaching its
      // handlers — otherwise onstop fires post-unmount and setState warns.
      const mr = mrRef.current;
      if (mr && mr.state === "recording") {
        mr.ondataavailable = null;
        mr.onstop = null;
        try {
          mr.stop();
        } catch {
          // Already stopped / not started; safe to ignore.
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      fisheyeStreamRef.current = null;
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  // --- Native (Capacitor) recording path ---
  const isNative = isNativePlatform();

  const handleNativeRecord = useCallback(async () => {
    setCameraError(null);
    try {
      const result = await recordNativeVideo();
      const url = URL.createObjectURL(result.blob);
      blobUrlRef.current = url;
      setBlobUrl(url);
      setState("done");
      onRecorded(result.blob);
    } catch (err) {
      const msg = parseFirebaseError(err);
      if (msg.toLowerCase().includes("cancel")) {
        // User cancelled — stay on idle
        return;
      }
      setCameraError(`Native camera error: ${msg}`);
      logger.warn("native_camera_failed", { error: msg });
    }
  }, [onRecorded]);

  const autoOpenRef = useRef(autoOpen);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- openCamera is async (awaits getUserMedia before setState), not a synchronous setState
    if (autoOpenRef.current && !isNative) openCamera();
  }, [openCamera, isNative]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const showFisheyeToggle = state === "preview" || state === "recording";
  const showFisheyeOverlay = fisheyeOn && (state === "preview" || state === "recording");

  return (
    <div className="w-full flex flex-col items-center gap-4">
      {/* Viewfinder */}
      <div
        className={`w-full max-w-[360px] aspect-[9/16] bg-black rounded-2xl overflow-hidden relative transition-all duration-300
          ${state === "recording" ? "border-2 border-brand-red shadow-[0_0_30px_rgba(255,61,0,0.15)]" : "border border-border"}`}
      >
        {state === "done" && blobUrl ? (
          <video
            src={blobUrl}
            className="w-full h-full object-cover"
            controls
            playsInline
            aria-label="Your recorded trick video"
          />
        ) : (
          <>
            <video
              ref={videoCallbackRef}
              className={`w-full h-full object-cover ${showFisheyeOverlay ? "invisible" : ""}`}
              muted
              playsInline
              aria-label="Camera preview"
            />
            {showFisheyeOverlay && (
              <FisheyeRenderer
                videoEl={videoEl}
                active={true}
                strength={2.0}
                onCanvas={handleFisheyeCanvas}
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
          </>
        )}

        {state === "recording" && (
          <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/70 px-3 py-1.5 rounded-full">
            <div className="w-2.5 h-2.5 rounded-full bg-brand-red animate-rec-pulse" />
            <span className="font-display text-lg text-white tracking-wider">{fmt(seconds)}</span>
          </div>
        )}

        {state === "idle" && !cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <FilmIcon size={48} className="opacity-30 text-subtle" />
            <span className="font-body text-sm text-subtle">Tap to open camera</span>
          </div>
        )}

        {state !== "done" && (
          <div className="absolute top-4 right-4 flex items-center gap-2">
            {showFisheyeToggle && (
              <button
                type="button"
                onClick={() => setFisheyeOn((v) => !v)}
                aria-label={fisheyeOn ? "Disable fisheye" : "Enable fisheye"}
                aria-pressed={fisheyeOn}
                className={`w-11 h-11 inline-flex items-center justify-center rounded-full transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${
                  fisheyeOn
                    ? "bg-purple-500/90 shadow-[0_0_12px_rgba(147,51,234,0.4)]"
                    : "bg-black/60 hover:bg-black/80 backdrop-blur-sm"
                }`}
              >
                <FisheyeIcon size={18} className="text-white" />
              </button>
            )}
            <div className="bg-brand-orange/90 px-2.5 py-1 rounded-md">
              <span className="font-display text-[11px] text-white tracking-[0.1em]">ONE TAKE</span>
            </div>
          </div>
        )}
      </div>

      {/* Camera error */}
      {cameraError && (
        <div className="w-full max-w-[360px] p-3 rounded-xl bg-[rgba(255,61,0,0.08)] border border-brand-red text-center">
          <p className="font-body text-sm text-brand-red mb-2">{cameraError}</p>
          <Btn onClick={openCamera} variant="secondary">
            Retry Camera
          </Btn>
        </div>
      )}

      {/* Controls */}
      {state === "idle" && !cameraError && (
        <Btn onClick={isNative ? handleNativeRecord : openCamera} variant="secondary">
          <CameraIcon size={16} className="inline -mt-0.5" /> {isNative ? "Record Video" : "Open Camera"}
        </Btn>
      )}
      {state === "preview" && (
        <Btn onClick={startRec} variant="danger" className="text-2xl py-5">
          <RecordIcon size={16} className="inline -mt-0.5" /> Record — {label}
        </Btn>
      )}
      {state === "recording" && (
        <>
          <Btn onClick={stopRec} variant="danger" className="text-2xl py-5 animate-rec-ring">
            <StopIcon size={16} className="inline -mt-0.5" /> Stop Recording
          </Btn>
          {seconds >= MAX_RECORDING_SECONDS - 10 && MAX_RECORDING_SECONDS - seconds > 0 && (
            <span className="font-body text-xs text-brand-red animate-pulse">
              Auto-stop in {MAX_RECORDING_SECONDS - seconds}s
            </span>
          )}
        </>
      )}
      {state === "done" && (
        <div className="flex items-center gap-2 px-5 py-3 rounded-xl bg-[rgba(0,230,118,0.08)] border border-brand-green">
          <span className="text-brand-green font-display text-lg tracking-wider">✓ {doneLabel}</span>
        </div>
      )}
    </div>
  );
}
