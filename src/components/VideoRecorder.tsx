import { useState, useRef, useCallback, useEffect } from "react";
import { Btn } from "./ui/Btn";

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
  const videoRef = useRef<HTMLVideoElement>(null);
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

  const openCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: true,
      });
      streamRef.current = stream;
      /* v8 ignore start */
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      }
      /* v8 ignore stop */
      setState("preview");
    } catch (err) {
      const isPermission =
        err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      const msg = err instanceof Error ? err.message : String(err);
      setCameraError(
        isPermission
          ? "Camera access denied. Check your browser permissions and try again."
          : `Camera unavailable: ${msg}`,
      );
      console.warn("Camera access failed:", msg);
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
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "";
    const mr = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    mr.ondataavailable = (e) => {
      /* v8 ignore start */
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
    };
    mrRef.current = mr;
    mr.start();
    setState("recording");
    setSeconds(0);
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    // Auto-stop at max duration
    /* v8 ignore start */
    maxTimerRef.current = window.setTimeout(() => {
      clearInterval(timerRef.current);
      if (mrRef.current?.state === "recording") {
        mrRef.current.stop();
      }
    }, MAX_RECORDING_SECONDS * 1000);
    /* v8 ignore stop */
  }, [onRecorded]);

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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const autoOpenRef = useRef(autoOpen);
  useEffect(() => {
    // openCamera is async (awaits getUserMedia before setState) — not a synchronous setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (autoOpenRef.current) openCamera();
  }, [openCamera]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

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
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline aria-label="Camera preview" />
        )}

        {state === "recording" && (
          <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/70 px-3 py-1.5 rounded-full">
            <div className="w-2.5 h-2.5 rounded-full bg-brand-red animate-rec-pulse" />
            <span className="font-display text-lg text-white tracking-wider">{fmt(seconds)}</span>
          </div>
        )}

        {state === "idle" && !cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span className="text-5xl opacity-30">📹</span>
            <span className="font-body text-sm text-[#555]">Tap to open camera</span>
          </div>
        )}

        <div className="absolute top-4 right-4 bg-brand-orange/90 px-2.5 py-1 rounded-md">
          <span className="font-display text-[11px] text-white tracking-[0.1em]">ONE TAKE</span>
        </div>
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
        <Btn onClick={openCamera} variant="secondary">
          📷 Open Camera
        </Btn>
      )}
      {state === "preview" && (
        <Btn onClick={startRec} variant="danger" className="text-2xl py-5">
          ⏺ Record — {label}
        </Btn>
      )}
      {state === "recording" && (
        <>
          <Btn onClick={stopRec} variant="danger" className="text-2xl py-5 animate-rec-ring">
            ⏹ Stop Recording
          </Btn>
          {seconds >= MAX_RECORDING_SECONDS - 10 && (
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
