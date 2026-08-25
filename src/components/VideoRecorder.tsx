import { useEffect, useState } from "react";
import { Btn } from "./ui/Btn";
import { FilmIcon, CameraIcon, RecordIcon, StopIcon, FisheyeIcon, FlipCameraIcon } from "./icons";
import { FisheyeRenderer } from "./FisheyeRenderer";
import { useMediaRecorder, isIOSSafari } from "../hooks/useMediaRecorder";
import { MAX_VIDEO_DURATION_SECONDS } from "../constants/video";

/**
 * Seconds of lead-in for the "Auto-stop in Ns" warning. The old 60s cap warned
 * 10s out; at the shared 20s cap that same absolute lead-in would nag for half
 * the take, so it scales down with the cap.
 */
const AUTO_STOP_WARNING_SECONDS = 5;

/** Shared classes for the viewfinder chrome toggles — 44px touch target. */
const CHROME_BTN =
  "w-11 h-11 inline-flex items-center justify-center rounded-full transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";

/**
 * Permissions the recorder needs. Neither is in the DOM lib's `PermissionName`
 * union (it only covers the names every engine implements), hence the cast at
 * the query site.
 */
type MediaPermissionName = "camera" | "microphone";

/**
 * Current grant state, or "unknown" when we cannot tell. Safari and Firefox
 * throw for names they don't support and older engines have no
 * `navigator.permissions` at all; every failure resolves to "unknown" so we
 * never assume access we don't have.
 */
async function queryMediaPermission(name: MediaPermissionName): Promise<PermissionState | "unknown"> {
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}

/** True only when camera AND mic are already granted, i.e. no prompt will show. */
async function hasGrantedCameraAndMic(): Promise<boolean> {
  const [camera, microphone] = await Promise.all([queryMediaPermission("camera"), queryMediaPermission("microphone")]);
  return camera === "granted" && microphone === "granted";
}

export function VideoRecorder({
  onRecorded,
  label,
  doneLabel = "Recorded",
  maxDurationSeconds = MAX_VIDEO_DURATION_SECONDS,
}: {
  onRecorded: (blob: Blob | null) => void;
  label: string;
  doneLabel?: string;
  /**
   * Hard auto-stop for the take, in seconds. Defaults to the game-turn cap;
   * standalone user-clip capture passes `USER_CLIP_MAX_DURATION_SECONDS`.
   * Drives both the recorder's own timer and the "Auto-stop in Ns" warning,
   * so the two can never disagree about when the take ends.
   */
  maxDurationSeconds?: number;
}) {
  const {
    state,
    blobUrl,
    seconds,
    cameraError,
    cameraErrorDetail,
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
  } = useMediaRecorder(onRecorded, maxDurationSeconds);

  const [permissionGranted, setPermissionGranted] = useState(false);

  useEffect(() => {
    // Never call getUserMedia outside a user gesture.
    //
    // WebKit — which backs *every* iOS browser, Chrome and Firefox included —
    // refuses a request that would need to raise a permission prompt but was
    // not user-initiated. It rejects with NotAllowedError and shows no prompt
    // at all, so the user is told access was "denied" for something they were
    // never asked. The denial then sticks for the rest of the page load: the
    // "Retry Camera" tap that *would* have prompted is refused too, and a
    // reload only repeats the gesture-less call. Toggling the camera switch in
    // iOS Settings never helps either, because no per-site grant was ever
    // recorded to fix. This screen used to take that path whenever `autoOpen`
    // was set, which is the setter's "Land Your Trick" recorder.
    //
    // So the stream is opened unprompted only when camera AND mic are already
    // granted — the one case where no prompt appears. Anything else
    // (prompt/denied/unknown, and iOS is always "unknown" because WebKit ships
    // no permissions.query for camera) waits for the user to tap Open Camera.
    // openCamera is async (it awaits getUserMedia before any setState), so this
    // is not a synchronous set-state-in-effect. Native has its own entry point.
    if (isNative) return;
    let cancelled = false;
    void hasGrantedCameraAndMic().then((granted) => {
      if (cancelled || !granted) return;
      setPermissionGranted(true);
      void openCamera();
    });
    return () => {
      cancelled = true;
    };
  }, [openCamera, isNative]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // Fisheye and camera-flip are PRE-RECORD decisions on a one-take recorder.
  // Mid-recording the fisheye toggle destroyed the take (turning it off unmounts
  // FisheyeRenderer, killing the very canvas MediaRecorder is capturing; turning
  // it on changed the preview but not the output) and a device swap would strand
  // the recorder on a stopped stream. The fisheye *overlay* still renders while
  // recording — the user must keep seeing the framing they're filming; only the
  // interactive controls go away.
  const showChromeToggles = state === "preview";
  const showFisheyeOverlay = fisheyeOn && (state === "preview" || state === "recording");
  const secondsLeft = maxDurationSeconds - seconds;

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
              ref={setVideoRef}
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
                onCanvas={setFisheyeCanvas}
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
          </>
        )}

        {(state === "preview" || state === "recording") && (
          <div
            data-testid="camera-crosshair"
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div className="relative flex items-center justify-center">
              <div className="absolute w-8 h-px bg-white/70" />
              <div className="absolute h-8 w-px bg-white/70" />
              <div className="w-3 h-3 rounded-full border border-white/70" />
            </div>
          </div>
        )}

        {state === "preview" && (
          <p
            data-testid="crosshair-instruction"
            className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/70 px-3 py-1.5 rounded-full font-body text-xs text-white whitespace-nowrap pointer-events-none"
          >
            Land your trick where the crosshair is aiming
          </p>
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
            {!permissionGranted && (
              <span className="font-body text-xs text-subtle px-4 text-center">
                {isIOSSafari()
                  ? 'Tip: in Safari choose "Allow" — or aA → Website Settings → Camera: Allow to stop repeat prompts'
                  : "Allow camera & mic once — we won't ask again"}
              </span>
            )}
          </div>
        )}

        {state !== "done" && (
          <div className="absolute top-4 right-4 flex items-center gap-2">
            {showChromeToggles && (
              <>
                <button
                  type="button"
                  onClick={flipCamera}
                  aria-label={facingMode === "environment" ? "Switch to front camera" : "Switch to rear camera"}
                  aria-pressed={facingMode === "user"}
                  className={`${CHROME_BTN} ${
                    facingMode === "user"
                      ? "bg-brand-orange/90 shadow-[0_0_12px_rgba(255,107,0,0.4)]"
                      : "bg-black/60 hover:bg-black/80 backdrop-blur-sm"
                  }`}
                >
                  <FlipCameraIcon size={18} className="text-white" />
                </button>
                <button
                  type="button"
                  onClick={toggleFisheye}
                  aria-label={fisheyeOn ? "Disable fisheye" : "Enable fisheye"}
                  aria-pressed={fisheyeOn}
                  className={`${CHROME_BTN} ${
                    fisheyeOn
                      ? "bg-purple-500/90 shadow-[0_0_12px_rgba(147,51,234,0.4)]"
                      : "bg-black/60 hover:bg-black/80 backdrop-blur-sm"
                  }`}
                >
                  <FisheyeIcon size={18} className="text-white" />
                </button>
              </>
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
          {/* Small print, but the part that makes a bug report actionable: the
              friendly copy above reads the same whether the browser refused the
              permission or a policy blocked the API outright. */}
          {cameraErrorDetail && <p className="font-body text-[11px] text-subtle mb-2">{cameraErrorDetail}</p>}
          <Btn onClick={openCamera} variant="secondary">
            Retry Camera
          </Btn>
        </div>
      )}

      {/* Controls */}
      {state === "idle" && !cameraError && (
        <Btn onClick={isNative ? startNativeRec : openCamera} variant="secondary">
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
          <Btn onClick={isNative ? stopNativeRec : stopRec} variant="danger" className="text-2xl py-5 animate-rec-ring">
            <StopIcon size={16} className="inline -mt-0.5" /> Stop Recording
          </Btn>
          {seconds >= maxDurationSeconds - AUTO_STOP_WARNING_SECONDS && secondsLeft > 0 && (
            <span className="font-body text-xs text-brand-red animate-pulse">Auto-stop in {secondsLeft}s</span>
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
