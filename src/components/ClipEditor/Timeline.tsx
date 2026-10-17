import { useRef, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import type { EditProject } from "../../lib/clipEditor/types";
import { outputDuration, sourceToOutput } from "../../lib/clipEditor/speed";
import { getSound } from "../../lib/clipEditor/sfxLibrary";

export const SFX_DRAG_TYPE = "application/x-skatehubba-sfx";

export interface TimelineProps {
  project: EditProject;
  /** Output seconds. */
  playhead: number;
  beats: number[];
  onSeek: (outSec: number) => void;
  onDropSfx: (soundId: string, outSec: number) => void;
  onMoveSfx: (id: string, outSec: number) => void;
  onRemoveSfx: (id: string) => void;
}

const pct = (t: number, dur: number): string => `${dur > 0 ? (t / dur) * 100 : 0}%`;

/**
 * Output-time timeline: scrub bar with the landing marker and line cuts,
 * beat ticks for the chosen track, and an SFX lane you drag sounds onto.
 * Everything is keyboard-operable too (arrows nudge the playhead / a sound).
 */
export function Timeline({ project, playhead, beats, onSeek, onDropSfx, onMoveSfx, onRemoveSfx }: TimelineProps) {
  const dur = outputDuration(project);
  const laneRef = useRef<HTMLDivElement>(null);

  const timeAt = (clientX: number): number => {
    const r = laneRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(dur, Math.max(0, ((clientX - r.left) / r.width) * dur));
  };

  const landingOut = project.landingSec === null ? null : sourceToOutput(project, project.landingSec);

  const onScrubKey = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 1 : 1 / 30;
    if (e.key === "ArrowRight") onSeek(Math.min(dur, playhead + step));
    else if (e.key === "ArrowLeft") onSeek(Math.max(0, playhead - step));
    else if (e.key === "Home") onSeek(0);
    else if (e.key === "End") onSeek(dur);
    else return;
    e.preventDefault();
  };

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    const id = e.dataTransfer.getData(SFX_DRAG_TYPE);
    const move = e.dataTransfer.getData("text/sfx-placement");
    if (move) onMoveSfx(move, timeAt(e.clientX));
    else if (id) onDropSfx(id, timeAt(e.clientX));
  };

  return (
    <div ref={laneRef} className="relative select-none">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={Number(dur.toFixed(2))}
        aria-valuenow={Number(playhead.toFixed(2))}
        aria-valuetext={`${playhead.toFixed(1)} of ${dur.toFixed(1)} seconds`}
        onKeyDown={onScrubKey}
        onPointerDown={(e: PointerEvent) => onSeek(timeAt(e.clientX))}
        className="relative h-10 rounded-lg bg-surface-alt focus-visible:outline-2 focus-visible:outline-brand-orange"
      >
        {beats.map((b) => (
          <span key={b} aria-hidden className="absolute top-0 h-2 w-px bg-white/30" style={{ left: pct(b, dur) }} />
        ))}
        {project.cuts.map((c) => (
          <span
            key={`${c.atSec}-${c.angleId}`}
            aria-hidden
            className="absolute inset-y-0 w-0.5 bg-sky-400"
            style={{ left: pct(sourceToOutput(project, c.atSec), dur) }}
          />
        ))}
        {landingOut !== null && (
          <span
            data-testid="landing-marker"
            aria-hidden
            className="absolute -top-1 bottom-0 w-1 rounded bg-emerald-400"
            style={{ left: pct(landingOut, dur) }}
          />
        )}
        <span aria-hidden className="absolute inset-y-0 w-0.5 bg-brand-orange" style={{ left: pct(playhead, dur) }} />
      </div>

      <div
        data-testid="sfx-lane"
        aria-label="Sound effects lane — drop a sound here"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="relative mt-2 h-9 rounded-lg border border-dashed border-border bg-black/30"
      >
        {project.sfx.map((s) => (
          <button
            key={s.id}
            type="button"
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/sfx-placement", s.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") onMoveSfx(s.id, s.outAtSec + 1 / 30);
              else if (e.key === "ArrowLeft") onMoveSfx(s.id, s.outAtSec - 1 / 30);
              else if (e.key === "Delete" || e.key === "Backspace") onRemoveSfx(s.id);
              else return;
              e.preventDefault();
            }}
            aria-label={`${getSound(s.soundId)?.label ?? s.soundId} at ${s.outAtSec.toFixed(2)}s. Arrows to move, Delete to remove`}
            className="absolute top-1 h-7 -translate-x-1/2 rounded bg-brand-orange/80 px-1.5 font-body text-[10px] text-black focus-visible:outline-2 focus-visible:outline-white"
            style={{ left: pct(s.outAtSec, dur) }}
          >
            {getSound(s.soundId)?.label.split(" ")[0] ?? "SFX"}
          </button>
        ))}
      </div>
    </div>
  );
}
