import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { EditProject } from "../../lib/clipEditor/types";
import { getSound } from "../../lib/clipEditor/sfxLibrary";
import { removeSfx, setSfxGain, sfxSpan, trimSfx, MIN_SFX_SEC } from "../../lib/clipEditor/overlays";
import { PanelHeading } from "./Chip";
import { loadPeaks, pickSfxSrc } from "./sfxAudio";

export interface SfxInspectorProps {
  project: EditProject;
  sfxId: string;
  onChange: (p: EditProject) => void;
  onClose: () => void;
}

const FLAT = Array.from({ length: 64 }, (_, i) => 0.35 + 0.25 * Math.abs(Math.sin(i * 0.7)));
const STEP = 0.01;

/**
 * Edit one placed sound: drag the two handles on its waveform to trim the
 * start and end (a 12 ms fade is always applied so cuts don't click), set its
 * volume, hear the trimmed part, or delete it.
 */
export function SfxInspector({ project, sfxId, onChange, onClose }: SfxInspectorProps) {
  const placement = project.sfx.find((x) => x.id === sfxId);
  const sound = placement ? getSound(placement.soundId) : undefined;
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let live = true;
    if (sound) void loadPeaks(sound.src).then((p) => live && setPeaks(p));
    return () => {
      live = false;
      audio.current?.pause();
    };
  }, [sound]);

  if (!placement || !sound) return null;
  const full = sound.durationSec;
  const span = sfxSpan(placement);
  const pct = (t: number): string => `${full > 0 ? (t / full) * 100 : 0}%`;

  const setEdge = (edge: "start" | "end", t: number): void => {
    onChange(edge === "start" ? trimSfx(project, sfxId, t, span.end) : trimSfx(project, sfxId, span.start, t));
  };
  const timeAt = (clientX: number): number => {
    const r = waveRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(full, Math.max(0, ((clientX - r.left) / r.width) * full));
  };
  const handleDown = (edge: "start" | "end") => (e: PointerEvent) => {
    e.preventDefault();
    dragging.current = edge;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const handleMove = (e: PointerEvent): void => {
    if (dragging.current) setEdge(dragging.current, timeAt(e.clientX));
  };
  const handleKey = (edge: "start" | "end") => (e: KeyboardEvent) => {
    const v = edge === "start" ? span.start : span.end;
    const step = e.shiftKey ? 0.1 : STEP;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") setEdge(edge, v + step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") setEdge(edge, v - step);
    else return;
    e.preventDefault();
  };
  const hear = (): void => {
    audio.current?.pause();
    const a = new Audio(pickSfxSrc(sound));
    audio.current = a;
    a.volume = Math.min(1, placement.gain);
    try {
      a.currentTime = span.start;
    } catch {
      /* not seekable yet */
    }
    const stopAt = span.end;
    a.ontimeupdate = () => {
      if (a.currentTime >= stopAt) a.pause();
    };
    void a.play().catch(() => undefined);
  };

  const handle = (edge: "start" | "end") => {
    const v = edge === "start" ? span.start : span.end;
    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label={edge === "start" ? "Sound start" : "Sound end"}
        aria-valuemin={0}
        aria-valuemax={Number(full.toFixed(2))}
        aria-valuenow={Number(v.toFixed(2))}
        aria-valuetext={`${v.toFixed(2)} seconds`}
        data-testid={`sfx-trim-${edge}`}
        onPointerDown={handleDown(edge)}
        onPointerMove={handleMove}
        onPointerUp={() => (dragging.current = null)}
        onPointerCancel={() => (dragging.current = null)}
        onKeyDown={handleKey(edge)}
        className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 touch-none cursor-ew-resize focus-visible:outline-2 focus-visible:outline-white"
        style={{ left: pct(v) }}
      >
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 rounded bg-brand-orange" />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3" data-testid="sfx-inspector">
      <div className="flex items-center justify-between">
        <PanelHeading>{sound.label.toUpperCase()}</PanelHeading>
        <button type="button" onClick={onClose} className="min-h-[44px] px-3 font-body text-sm text-white">
          Done
        </button>
      </div>

      <div
        ref={waveRef}
        className="relative h-16 rounded-lg bg-black/40"
        aria-label="Waveform — drag the handles to trim"
      >
        <div aria-hidden className="absolute inset-0 flex items-center gap-px px-0.5">
          {(peaks ?? FLAT).map((v, i, arr) => {
            const t = ((i + 0.5) / arr.length) * full;
            const inside = t >= span.start && t <= span.end;
            return (
              <span
                key={i}
                className={`flex-1 rounded-sm ${inside ? "bg-white/80" : "bg-white/20"}`}
                style={{ height: `${Math.max(6, v * 100)}%` }}
              />
            );
          })}
        </div>
        <span
          aria-hidden
          className="absolute inset-y-0 rounded border-y-2 border-brand-orange"
          style={{ left: pct(span.start), width: pct(span.length) }}
        />
        {handle("start")}
        {handle("end")}
      </div>
      <p className="font-body text-xs text-faint">
        Plays {span.length.toFixed(2)}s of {full.toFixed(2)}s · min {MIN_SFX_SEC * 1000} ms · fades added automatically
      </p>

      <label className="font-body text-xs text-muted">
        Volume {Math.round(placement.gain * 100)}%
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={placement.gain}
          onChange={(e) => onChange(setSfxGain(project, sfxId, Number(e.target.value)))}
          className="mt-1 block w-full accent-brand-orange"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={hear}
          className="min-h-[44px] flex-1 rounded-xl border border-border font-body text-sm text-white"
        >
          ▶ Hear
        </button>
        <button
          type="button"
          onClick={() => {
            onChange(removeSfx(project, sfxId));
            onClose();
          }}
          className="min-h-[44px] flex-1 rounded-xl border border-red-500/60 font-body text-sm text-red-300"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
