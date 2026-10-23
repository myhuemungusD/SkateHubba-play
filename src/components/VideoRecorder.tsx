import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ActionDock } from "./ActionDock";
import { Btn } from "./ui/Btn";
import { FilmIcon } from "./icons";
import { CameraChromeToggles } from "./CameraChromeToggles";
import { RecorderControls } from "./RecorderControls";
import { hasGrantedCameraAndMic } from "./mediaPermissions";
import { FisheyeRenderer } from "./FisheyeRenderer";
import { useMediaRecorder, isIOSSafari } from "../hooks/useMediaRecorder";
import { useSelfTimer } from "../hooks/useSelfTimer";
import { SelfTimerCountdown, SelfTimerToggle } from "./SelfTimerControls";
import { useCameraRelease } from "../hooks/useCameraRelease";
import { useNativeViewfinder } from "../hooks/useNativeViewfinder";
import { MAX_VIDEO_DURATION_SECONDS } from "../constants/video";
import { CLIP_POSTER } from "../lib/clipPoster";

// Lazy-load pro camera controls to keep them off the initial bundle
const NativeCameraControls = lazy(() =>
  import("./NativeCameraControls").then((m) => ({ default: m.NativeCameraControls })),
);

/**
 * Full recorded frame, centered in the 9:16 viewfinder. The crosshair is
 * centered on this same box, so it stays on the middle of the picture when
 * a non-9:16 stream letterboxes.
 */
const FRAME_FIT = "w-full h-full object-contain";

export function VideoRecorder({
  onRecorded,
  label,
  doneLabel = "Recorded",
  maxDurationSeconds = MAX_VIDEO_DURATION_SECONDS,
  pinControls = false,
  recordBlockedLabel,
}: {
  onRecorded: (blob: Blob | null) => void;
  label: string;
  doneLabel?: string;
  /**
   * Pin Open Camera / Record / Stop to the bottom of the viewport. Game turns
   * pass this so a 9:16 preview can't hide the button that starts the take.
   * The "recorded" confirmation stays under the video; the land/miss choice
   * is pinned by the decision panel instead.
   */
  pinControls?: boolean;
  /**
   * Hard auto-stop for the take, in seconds. Defaults to the game-turn cap;
   * standalone user-clip capture passes `USER_CLIP_MAX_DURATION_SECONDS`.
   * Drives both the recorder's own timer and the "Auto-stop in Ns" warning,
   * so the two can never disagree about when the take ends.
   */
  maxDurationSeconds?: number;
  /**
   * When set, the live preview stays up but Record is disabled and shows this
   * instead — the setter can frame the shot before a trick is picked.
   */
  recordBlockedLabel?: string;
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
    openNativeCamera,
    releaseCamera,
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
    // is not a synchronous set-state-in-effect.
    //
    // Native asks through the app's own permission prompt, so the live
    // preview comes up on screen entry — a skater filming alone props the
    // phone up and frames the shot before tapping Record.
    if (isNative) {
      void openNativeCamera();
      return;
    }
    let cancelled = false;
    void hasGrantedCameraAndMic().then((granted) => {
      if (cancelled || !granted) return;
      setPermissionGranted(true);
      void openCamera();
    });
    return () => {
      cancelled = true;
    };
  }, [openCamera, openNativeCamera, isNative]);

  const timer = useSelfTimer();
  const { cancel: cancelTimer } = timer;
  // A countdown only makes sense over a live preview.
  useEffect(() => {
    if (state !== "preview") cancelTimer();
  }, [state, cancelTimer]);
  // Battery + privacy: let go of the camera when the app is backgrounded,
  // bring the preview back when it returns.
  useCameraRelease({ state, isNative, releaseCamera, openNativeCamera, openCamera, cancelTimer });
  const reopen = isNative ? openNativeCamera : openCamera;
  const beginTake = () => timer.start(isNative ? startNativeRec : startRec);

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
  // Native capture draws the camera BEHIND the web view, so the viewfinder and
  // every ancestor must be see-through while it runs (see .sh-native-cam).
  // Live from the first preview frame, not just once recording starts —
  // otherwise the page covers the camera while the shot is being framed.
  const nativeLive = isNative && (state === "preview" || state === "recording");
  const viewfinderRef = useRef<HTMLDivElement>(null);
  useNativeViewfinder(viewfinderRef, nativeLive);

  const controls = {
    state,
    cameraError,
    label,
    seconds,
    secondsLeft,
    maxDurationSeconds,
    countdown: timer.countdown,
    recordBlockedLabel,
    onOpen: reopen,
    onStart: beginTake,
    onCancelCountdown: cancelTimer,
    onStop: isNative ? stopNativeRec : stopRec,
    onRetry: reopen,
  };

  return (
    <div className="w-full flex flex-col items-center gap-4">
      {/* Viewfinder */}
      <div
        ref={viewfinderRef}
        data-testid="trick-viewfinder"
        className={`trick-frame ${nativeLive ? "bg-transparent" : "bg-black"} rounded-2xl overflow-hidden relative transition-all duration-300
          ${state === "recording" ? "border-2 border-brand-red shadow-[0_0_30px_rgba(255,61,0,0.15)]" : "border border-border"}`}
      >
        {state === "done" && blobUrl ? (
          <video
            src={blobUrl}
            className={FRAME_FIT}
            controls
            playsInline
            poster={CLIP_POSTER}
            preload="metadata"
            aria-label="Your recorded trick video"
          />
        ) : (
          <>
            <video
              ref={setVideoRef}
              className={`${FRAME_FIT} ${showFisheyeOverlay ? "invisible" : ""}`}
              muted
              playsInline
              preload="none"
              aria-label="Camera preview"
            />
            {showFisheyeOverlay && (
              <FisheyeRenderer
                videoEl={videoEl}
                active={true}
                strength={2.0}
                onCanvas={setFisheyeCanvas}
                className={`absolute inset-0 ${FRAME_FIT}`}
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

        {state === "preview" && (
          <SelfTimerToggle enabled={timer.enabled} onToggle={timer.toggle} disabled={timer.countdown !== null} />
        )}
        {timer.countdown !== null && <SelfTimerCountdown seconds={timer.countdown} />}

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

        <Suspense fallback={null}>
          <NativeCameraControls active={isNative && state === "recording"} />
        </Suspense>

        {state !== "done" && (
          <div className="absolute top-4 right-4 flex items-center gap-2">
            {showChromeToggles && !isNative && (
              <CameraChromeToggles
                facingMode={facingMode}
                fisheyeOn={fisheyeOn}
                onFlip={flipCamera}
                onToggleFisheye={toggleFisheye}
              />
            )}
            <div className="bg-brand-orange/90 px-2.5 py-1 rounded-md">
              <span className="font-display text-sm text-black tracking-[0.1em]">ONE TAKE</span>
            </div>
          </div>
        )}
      </div>

      {/* Camera error copy stays with the viewfinder. The retry is a control. */}
      {cameraError && (
        <div className="w-full max-w-[360px] p-3 rounded-xl bg-[rgba(255,61,0,0.08)] border border-brand-red text-center">
          <p className="font-body text-sm text-brand-red mb-2">{cameraError}</p>
          {/* Small print, but the part that makes a bug report actionable: the
              friendly copy above reads the same whether the browser refused the
              permission or a policy blocked the API outright. */}
          {cameraErrorDetail && <p className="font-body text-xs text-bright mb-2">{cameraErrorDetail}</p>}
          {!pinControls && (
            <Btn onClick={reopen} variant="secondary">
              Retry Camera
            </Btn>
          )}
        </div>
      )}

      {/* Controls. On a game turn these are pinned so the take can be started
          without scrolling past the preview. */}
      {pinControls && state !== "done" ? (
        <ActionDock testId="recorder-actions">
          <RecorderControls {...controls} />
        </ActionDock>
      ) : (
        <RecorderControls {...controls} doneLabel={doneLabel} />
      )}
    </div>
  );
}
