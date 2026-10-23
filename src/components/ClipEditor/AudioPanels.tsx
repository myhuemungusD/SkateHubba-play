import { useRef, useState } from "react";
import type { EditProject } from "../../lib/clipEditor/types";
import { MUSIC_TRACKS } from "../../lib/clipEditor/musicLibrary";
import { SKATE_SOUNDS, soundCredits } from "../../lib/clipEditor/sfxLibrary";
import { alignMusicToLanding } from "../../lib/clipEditor/beats";
import { addSfx } from "../../lib/clipEditor/overlays";
import { pickSfxSrc } from "./sfxAudio";
import { sourceToOutput } from "../../lib/clipEditor/speed";
import { Chip, PanelHeading } from "./Chip";
import { SFX_DRAG_TYPE } from "./Timeline";
import type { PanelProps } from "./EditPanels";

/** Beat-synced music: pick a track, it snaps a downbeat onto the landing. */
export function MusicPanel({ project, onChange }: PanelProps) {
  const pick = (trackId: string | null): void => {
    if (trackId === null) return onChange({ ...project, music: null });
    const next: EditProject = {
      ...project,
      music: { trackId, trackOffsetSec: 0, gain: 0.8, originalGain: project.music?.originalGain ?? 0.6 },
    };
    onChange(project.landingSec === null ? next : alignMusicToLanding(next, sourceToOutput(next, project.landingSec)));
  };
  return (
    <div className="flex flex-col gap-3">
      <PanelHeading>MUSIC</PanelHeading>
      <div className="flex flex-wrap gap-2">
        <Chip selected={project.music === null} onClick={() => pick(null)}>
          No music
        </Chip>
        {MUSIC_TRACKS.map((t) => (
          <Chip
            key={t.id}
            selected={project.music?.trackId === t.id}
            onClick={() => pick(t.id)}
            hint={`${t.mood} · ${t.bpm} BPM`}
          >
            {t.title} <span className="text-faint">{t.bpm}</span>
          </Chip>
        ))}
      </div>
      {project.music && (
        <>
          <p className="font-body text-xs text-faint">
            {project.landingSec !== null
              ? "Synced: the drop hits on your landing. "
              : "Mark the landing to sync the drop. "}
            Ticks on the timeline are the beats — cuts snap to them.
          </p>
          <label className="block font-body text-xs text-dim">
            Original sound: {Math.round(project.music.originalGain * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={project.music.originalGain}
              onChange={(e) =>
                project.music &&
                onChange({ ...project, music: { ...project.music, originalGain: Number(e.target.value) } })
              }
              className="mt-1 block w-full accent-brand-orange"
            />
          </label>
        </>
      )}
      <p className="font-body text-label text-faint">
        All tracks are original SkateHubba music (CC0) — safe to post anywhere.
      </p>
    </div>
  );
}

export interface SoundsPanelProps extends PanelProps {
  /** Called with the new placement's id so the editor can open it for trimming. */
  onAdded?: (id: string) => void;
}

/**
 * Skate SFX library. Tap a sound to hear it (and pick it), then one tap on
 * "Add" drops it at the playhead. Desktop can still drag a sound onto the lane.
 */
export function SoundsPanel({ project, onChange, outputTime, onAdded }: SoundsPanelProps) {
  const preview = useRef<HTMLAudioElement | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const pickedSound = picked ? SKATE_SOUNDS.find((x) => x.id === picked) : undefined;
  const audition = (id: string): void => {
    const s = SKATE_SOUNDS.find((x) => x.id === id);
    if (!s) return;
    setPicked(id);
    preview.current?.pause();
    preview.current = new Audio(pickSfxSrc(s));
    void preview.current.play().catch(() => undefined);
  };
  const add = (): void => {
    if (!picked) return;
    preview.current?.pause();
    const { project: next, id } = addSfx(project, picked, outputTime);
    onChange(next);
    if (id) onAdded?.(id);
  };
  return (
    <div className="flex flex-col gap-3">
      <PanelHeading>SKATE SOUNDS</PanelHeading>
      <div className="flex flex-wrap gap-2" role="listbox" aria-label="Skate sounds — tap to hear">
        {SKATE_SOUNDS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="option"
            aria-selected={picked === s.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(SFX_DRAG_TYPE, s.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => audition(s.id)}
            aria-label={`Hear ${s.label}`}
            className={`min-h-[44px] rounded-xl border px-3 py-2 font-body text-sm focus-visible:outline-2 focus-visible:outline-brand-orange ${picked === s.id ? "border-brand-orange bg-brand-orange/15 text-white" : "border-border bg-surface-alt/60 text-muted hover:text-white"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        disabled={!pickedSound}
        className="min-h-[48px] rounded-xl bg-brand-orange font-display text-sm tracking-wide text-black disabled:opacity-40"
      >
        {pickedSound ? `ADD ${pickedSound.label.toUpperCase()} AT ${outputTime.toFixed(1)}S` : "TAP A SOUND TO HEAR IT"}
      </button>
      <p className="font-body text-label text-faint" data-testid="sfx-credits">
        Sound credits:{" "}
        {soundCredits().map((c, i) => (
          <span key={c.url}>
            {i > 0 && "; "}
            <a href={c.url} target="_blank" rel="noopener noreferrer" className="underline">
              “{c.title}” by {c.author}
            </a>{" "}
            ({c.license}, edited)
          </span>
        ))}
        . Other sounds are original SkateHubba synth sounds (CC0).
      </p>
    </div>
  );
}
