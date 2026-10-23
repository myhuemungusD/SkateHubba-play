import { useRef, useState, type CSSProperties } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { CLIP_POSTER } from "../lib/clipPoster";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";

/**
 * A game clip with in-app controls: tap to play or pause, a thin scrubber
 * and a mute toggle (the Reels / TikTok player), instead of the browser's
 * own control bar with its download and picture-in-picture menu. The frame
 * takes the clip's own shape once its metadata loads, so a landscape clip
 * isn't letterboxed inside a tall 9:16 box.
 */
export function TrickClip({ src, label }: { src: string; label: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // play() rejects when the browser blocks it; the button just stays "Play".
      v.play()?.catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const seek = (value: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    v.currentTime = (value / 100) * v.duration;
    setProgress(value);
  };

  const frameStyle = aspect ? ({ "--clip-aspect": String(aspect) } as CSSProperties) : undefined;

  return (
    <div
      className="trick-frame relative overflow-hidden rounded-2xl border border-border bg-black"
      style={frameStyle}
      data-testid="trick-clip"
    >
      <video
        ref={videoRef}
        src={src}
        playsInline
        poster={CLIP_POSTER}
        preload="metadata"
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        aria-label={label}
        className="h-full w-full object-contain"
        onLoadedMetadata={(e) => {
          const { videoWidth, videoHeight } = e.currentTarget;
          if (videoWidth > 0 && videoHeight > 0) setAspect(videoWidth / videoHeight);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const { currentTime, duration } = e.currentTarget;
          if (Number.isFinite(duration) && duration > 0) setProgress((currentTime / duration) * 100);
        }}
      />
      <button
        type="button"
        onClick={togglePlay}
        // Tap anywhere on the clip, like Reels. Keyboard and screen-reader
        // users get the labelled Play button in the bar below instead.
        tabIndex={-1}
        aria-hidden="true"
        data-testid="trick-clip-tap"
        className="absolute inset-0 flex items-center justify-center"
      >
        {!playing && (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm">
            <Play size={26} aria-hidden="true" className="ml-1" />
          </span>
        )}
      </button>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? `Pause ${label}` : `Play ${label}`}
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${FOCUS}`}
        >
          {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={progress}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
          className={`clip-scrubber h-11 min-w-0 flex-1 ${FOCUS}`}
        />
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${FOCUS}`}
        >
          {muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
