import { useRef } from "react";
import type { EditProject } from "../../lib/clipEditor/types";
import { MUSIC_TRACKS } from "../../lib/clipEditor/musicLibrary";
import { SKATE_SOUNDS, soundCredits } from "../../lib/clipEditor/sfxLibrary";
import { alignMusicToLanding } from "../../lib/clipEditor/beats";
import { placeSfx } from "../../lib/clipEditor/overlays";
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
      <p className="font-body text-[11px] text-faint">
        All tracks are original SkateHubba music (CC0) — safe to post anywhere.
      </p>
    </div>
  );
}

/** AAC everywhere it plays; Ogg only where the browser can't do AAC. */
function pickSfxSrc(s: { src: string; oggSrc?: string }): string {
  if (!s.oggSrc || typeof document === "undefined") return s.src;
  const probe = document.createElement("audio");
  return typeof probe.canPlayType === "function" && probe.canPlayType("audio/mp4") === "" ? s.oggSrc : s.src;
}

/** Skate SFX library. Drag onto the timeline lane, or tap to drop at the playhead. */
export function SoundsPanel({ project, onChange, outputTime }: PanelProps) {
  const preview = useRef<HTMLAudioElement | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <PanelHeading>SKATE SOUNDS</PanelHeading>
      <p className="font-body text-xs text-faint">
        Drag a sound onto the lane under the timeline, or tap to drop it at {outputTime.toFixed(1)}s. Long-press to hear
        it.
      </p>
      <div className="flex flex-wrap gap-2">
        {SKATE_SOUNDS.map((s) => (
          <button
            key={s.id}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(SFX_DRAG_TYPE, s.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onChange(placeSfx(project, s.id, outputTime))}
            onContextMenu={(e) => {
              e.preventDefault();
              preview.current?.pause();
              preview.current = new Audio(pickSfxSrc(s));
              void preview.current.play().catch(() => undefined);
            }}
            aria-label={`Add ${s.label} at ${outputTime.toFixed(1)} seconds`}
            className="min-h-[44px] rounded-xl border border-border bg-surface-alt/60 px-3 py-2 font-body text-sm text-muted hover:text-white focus-visible:outline-2 focus-visible:outline-brand-orange"
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="font-body text-[11px] text-faint" data-testid="sfx-credits">
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
