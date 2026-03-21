import { useState, useRef, useCallback, useEffect } from "react";
import type { TurnRecord } from "../services/games";
import { isFirebaseStorageUrl } from "../utils/helpers";
import { Btn } from "./ui/Btn";
import { PlayIcon, ReplayIcon } from "./icons";

interface GameReplayProps {
  turns: TurnRecord[];
}

type ClipPhase = "set" | "match";

/**
 * Sequential full-game replay: plays all clips in order
 * (setter clip → matcher clip → next round) as a highlight reel.
 */
export function GameReplay({ turns }: GameReplayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);

  // Build a flat list of playable clips
  const clips = turns.flatMap((turn, i) => {
    const result: { turnIndex: number; phase: ClipPhase; url: string; label: string }[] = [];
    if (turn.setVideoUrl && isFirebaseStorageUrl(turn.setVideoUrl)) {
      result.push({
        turnIndex: i,
        phase: "set",
        url: turn.setVideoUrl,
        label: `Round ${turn.turnNumber}: @${turn.setterUsername} sets ${turn.trickName}`,
      });
    }
    if (turn.matchVideoUrl && isFirebaseStorageUrl(turn.matchVideoUrl)) {
      result.push({
        turnIndex: i,
        phase: "match",
        url: turn.matchVideoUrl,
        label: `Round ${turn.turnNumber}: @${turn.matcherUsername} ${turn.landed ? "lands" : "misses"} ${turn.trickName}`,
      });
    }
    return result;
  });

  const [clipIndex, setClipIndex] = useState(0);
  const currentClip = clips[clipIndex];

  // Derive turnIndex and clipPhase from currentClip (no separate state needed)
  const turnIndex = currentClip?.turnIndex ?? 0;
  const clipPhase = currentClip?.phase ?? "set";

  const startReplay = useCallback(() => {
    setClipIndex(0);
    setFinished(false);
    setPlaying(true);
  }, []);

  // When clipIndex changes, load and play the video
  useEffect(() => {
    if (!playing || !currentClip || !videoRef.current) return;
    videoRef.current.src = currentClip.url;
    videoRef.current.load();
    videoRef.current.play().catch(() => {
      // Autoplay may be blocked; user can tap play
    });
  }, [clipIndex, playing, currentClip]);

  const handleClipEnded = useCallback(() => {
    const nextIndex = clipIndex + 1;
    if (nextIndex >= clips.length) {
      setFinished(true);
      setPlaying(false);
    } else {
      setClipIndex(nextIndex);
    }
  }, [clipIndex, clips.length]);

  if (clips.length === 0) return null;

  const currentTurn = turns[turnIndex];

  return (
    <div className="w-full">
      {!playing && !finished && (
        <Btn onClick={startReplay} variant="secondary" className="w-full">
          <PlayIcon size={16} className="inline -mt-0.5" /> Watch Full Replay
        </Btn>
      )}

      {finished && (
        <Btn onClick={startReplay} variant="secondary" className="w-full">
          <ReplayIcon size={16} className="inline -mt-0.5" /> Watch Again
        </Btn>
      )}

      {playing && currentClip && (
        <div className="mt-4 animate-fade-in">
          {/* Clip label */}
          <div className="text-center mb-3">
            <p className="font-display text-sm tracking-wider text-white">
              Round {currentTurn.turnNumber}: {currentTurn.trickName}
            </p>
            <p
              className={`font-display text-xs tracking-wider mt-1 ${
                clipPhase === "set" ? "text-brand-orange" : "text-brand-green"
              }`}
            >
              {clipPhase === "set"
                ? `@${currentTurn.setterUsername}'s trick`
                : `@${currentTurn.matcherUsername}'s attempt`}
            </p>
          </div>

          {/* Video player */}
          <video
            ref={videoRef}
            controls
            playsInline
            onEnded={handleClipEnded}
            aria-label={currentClip.label}
            className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
          />

          {/* Progress indicator */}
          <div className="flex justify-center gap-1.5 mt-3">
            {clips.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === clipIndex ? "w-6 bg-purple-500" : i < clipIndex ? "w-3 bg-purple-500/40" : "w-3 bg-[#333]"
                }`}
              />
            ))}
          </div>

          {/* Outcome badge */}
          {clipPhase === "match" && (
            <div className="flex justify-center mt-2">
              <span
                className={`font-display text-xs tracking-wider px-3 py-1 rounded-full ${
                  currentTurn.landed
                    ? "bg-[rgba(0,230,118,0.15)] text-brand-green"
                    : "bg-[rgba(255,61,0,0.15)] text-brand-red"
                }`}
              >
                {currentTurn.landed ? "Landed" : "Missed"}
              </span>
            </div>
          )}

          {/* Skip / controls */}
          <div className="flex justify-center gap-3 mt-3">
            {clipIndex < clips.length - 1 && (
              <button
                type="button"
                onClick={() => setClipIndex(clipIndex + 1)}
                className="font-body text-xs text-[#888] hover:text-white transition-colors"
              >
                Skip →
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setFinished(false);
              }}
              className="font-body text-xs text-[#888] hover:text-white transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
