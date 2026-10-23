import { useRef, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { sfxSpan } from "../../lib/clipEditor/overlays";
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
  /** The sound open in the inspector (highlighted). */
  selectedSfxId?: string | null;
  /** Tap a sound on the lane to open it for trim / volume / delete. */
  onSelectSfx?: (id: string) => void;
}

/** Pointer travel (px) before a press on a sound counts as a drag instead of a tap. */
const DRAG_SLOP_PX = 6;

const pct = (t: number, dur: number): string => `${dur > 0 ? (t / dur) * 100 : 0}%`;

/**
 * Output-time timeline: scrub bar with the landing marker and line cuts,
 * beat ticks for the chosen track, and an SFX lane you drag sounds onto.
 * Everything is keyboard-operable too (arrows nudge the playhead / a sound).
 */
export function Timeline({
  project,
  playhead,
  beats,
  onSeek,
  onDropSfx,
  onMoveSfx,
  onRemoveSfx,
  selectedSfxId = null,
  onSelectSfx,
}: TimelineProps) {
  const dur = outputDuration(project);
  const laneRef = useRef<HTMLDivElement>(null);

  const timeAt = (clientX: number): number => {
    const r = laneRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(dur, Math.max(0, ((clientX - r.left) / r.width) * dur));
  };

  // Press-drag a sound to slide it along the lane; a press without travel is a tap (select).
  const drag = useRef<{ id: string; startX: number; startAt: number; moved: boolean } | null>(null);
  const pxToSec = (px: number): number => {
    const w = laneRef.current?.getBoundingClientRect().width ?? 0;
    return w > 0 ? (px / w) * dur : 0;
  };
  const onSfxPointerDown = (e: PointerEvent, id: string, at: number): void => {
    e.stopPropagation();
    drag.current = { id, startX: e.clientX, startAt: at, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onSfxPointerMove = (e: PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < DRAG_SLOP_PX) return;
    d.moved = true;
    onMoveSfx(d.id, d.startAt + pxToSec(dx));
  };
  const onSfxPointerUp = (): void => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onSelectSfx?.(d.id);
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
        {project.sfx.map((s) => {
          const label = getSound(s.soundId)?.label ?? s.soundId;
          const len = sfxSpan(s).length;
          const selected = s.id === selectedSfxId;
          return (
            <button
              key={s.id}
              type="button"
              data-testid="sfx-clip"
              onPointerDown={(e) => onSfxPointerDown(e, s.id, s.outAtSec)}
              onPointerMove={onSfxPointerMove}
              onPointerUp={onSfxPointerUp}
              onPointerCancel={() => (drag.current = null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") onMoveSfx(s.id, s.outAtSec + 1 / 30);
                else if (e.key === "ArrowLeft") onMoveSfx(s.id, s.outAtSec - 1 / 30);
                else if (e.key === "Delete" || e.key === "Backspace") onRemoveSfx(s.id);
                else if (e.key === "Enter" || e.key === " ") onSelectSfx?.(s.id);
                else return;
                e.preventDefault();
              }}
              aria-pressed={selected}
              aria-label={`${label} at ${s.outAtSec.toFixed(2)}s. Drag or arrows to move, tap to edit, Delete to remove`}
              className={`absolute top-1 h-7 min-w-[28px] touch-none overflow-hidden truncate rounded px-1.5 text-left font-body text-xs text-black focus-visible:outline-2 focus-visible:outline-white ${selected ? "bg-white ring-2 ring-brand-orange" : "bg-brand-orange/80"}`}
              style={{ left: pct(s.outAtSec, dur), width: pct(len, dur) }}
            >
              {label.split(" ")[0]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
