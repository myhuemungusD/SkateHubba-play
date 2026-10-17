import { useState } from "react";
import type { ColorPresetId, EditProject, LookId, TextOverlay } from "../../lib/clipEditor/types";
import { LOOKS, COLOR_PRESETS } from "../../lib/clipEditor/looks";
import { SPEED_RAMP_PRESETS, buildSpeedRamp, setSpeedKeys, type SpeedRampPreset } from "../../lib/clipEditor/speed";
import { setLanding, setTrim, trimToTrick } from "../../lib/clipEditor/project";
import { addOverlay, removeOverlay, OVERLAY_MAX_CHARS } from "../../lib/clipEditor/overlays";
import { Chip, PanelHeading } from "./Chip";

export interface PanelProps {
  project: EditProject;
  onChange: (p: EditProject) => void;
  /** Current position in source seconds (trim/landing) and output seconds (captions). */
  sourceTime: number;
  outputTime: number;
}

/** Trim + landing marker + speed ramps — the "cut it to the trick" panel. */
export function TrimSpeedPanel({ project, onChange, sourceTime }: PanelProps) {
  const [preset, setPreset] = useState<SpeedRampPreset>("realtime");
  const [slow, setSlow] = useState(0.25);
  const applyRamp = (id: SpeedRampPreset, s = slow): void => {
    setPreset(id);
    onChange(setSpeedKeys(project, buildSpeedRamp(id, project.landingSec, s)));
  };
  return (
    <div className="flex flex-col gap-4">
      <div>
        <PanelHeading>TRIM</PanelHeading>
        <div className="flex flex-wrap gap-2">
          <Chip selected={false} onClick={() => onChange(setTrim(project, sourceTime, project.trimOutSec))}>
            Start here
          </Chip>
          <Chip selected={false} onClick={() => onChange(setTrim(project, project.trimInSec, sourceTime))}>
            End here
          </Chip>
          <Chip selected={project.landingSec !== null} onClick={() => onChange(setLanding(project, sourceTime))}>
            Mark landing
          </Chip>
          <Chip
            selected={false}
            disabled={project.landingSec === null}
            onClick={() => onChange(trimToTrick(project))}
            hint="Keep 2.5s before the landing and 1.5s after"
          >
            Trim to trick
          </Chip>
        </div>
        <p className="mt-1 font-body text-xs text-faint">
          {project.trimInSec.toFixed(2)}s → {project.trimOutSec.toFixed(2)}s
          {project.landingSec !== null
            ? ` · landing ${project.landingSec.toFixed(2)}s`
            : " · scrub to the landing and tap Mark landing"}
        </p>
      </div>
      <div>
        <PanelHeading>SPEED RAMP</PanelHeading>
        <div className="flex flex-wrap gap-2">
          {SPEED_RAMP_PRESETS.map((r) => (
            <Chip
              key={r.id}
              selected={preset === r.id}
              hint={r.hint}
              disabled={r.id !== "realtime" && project.landingSec === null}
              onClick={() => applyRamp(r.id)}
            >
              {r.label}
            </Chip>
          ))}
        </div>
        <label className="mt-3 block font-body text-xs text-dim">
          Slow-mo amount: {Math.round(slow * 100)}%
          <input
            type="range"
            min={0.125}
            max={0.75}
            step={0.125}
            value={slow}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSlow(v);
              if (preset !== "realtime") applyRamp(preset, v);
            }}
            className="mt-1 block w-full accent-brand-orange"
          />
        </label>
      </div>
    </div>
  );
}

/** Lens/tape looks + color presets. */
export function LookPanel({ project, onChange }: PanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <PanelHeading>LOOK</PanelHeading>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LOOKS) as LookId[]).map((id) => (
            <Chip
              key={id}
              selected={project.look === id}
              hint={LOOKS[id].hint}
              onClick={() => onChange({ ...project, look: id })}
            >
              {LOOKS[id].label}
            </Chip>
          ))}
        </div>
        <label className="mt-3 block font-body text-xs text-dim">
          Strength: {Math.round(project.lookStrength * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={project.lookStrength}
            disabled={project.look === "none"}
            onChange={(e) => onChange({ ...project, lookStrength: Number(e.target.value) })}
            className="mt-1 block w-full accent-brand-orange"
          />
        </label>
      </div>
      <div>
        <PanelHeading>COLOR</PanelHeading>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(COLOR_PRESETS) as ColorPresetId[]).map((id) => (
            <Chip key={id} selected={project.color === id} onClick={() => onChange({ ...project, color: id })}>
              {COLOR_PRESETS[id].label}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}

const STYLES: { id: TextOverlay["style"]; label: string }[] = [
  { id: "stamp", label: "Stamp" },
  { id: "tape", label: "Label tape" },
  { id: "minimal", label: "Clean" },
];

/** Trick-name captions, placed at the playhead. */
export function TextPanel({ project, onChange, outputTime }: PanelProps) {
  const [text, setText] = useState("");
  const [style, setStyle] = useState<TextOverlay["style"]>("stamp");
  return (
    <div className="flex flex-col gap-3">
      <PanelHeading>TRICK NAME</PanelHeading>
      <input
        value={text}
        maxLength={OVERLAY_MAX_CHARS}
        onChange={(e) => setText(e.target.value)}
        placeholder="Kickflip backside lipslide"
        aria-label="Trick name caption"
        className="w-full rounded-xl border border-border bg-surface-alt/80 px-3 py-3 font-body text-base text-white outline-none focus:border-brand-orange"
      />
      <div className="flex flex-wrap gap-2">
        {STYLES.map((s) => (
          <Chip key={s.id} selected={style === s.id} onClick={() => setStyle(s.id)}>
            {s.label}
          </Chip>
        ))}
      </div>
      <Chip
        selected={false}
        disabled={!text.trim()}
        onClick={() => {
          onChange(addOverlay(project, text, outputTime, style));
          setText("");
        }}
      >
        Add at {outputTime.toFixed(1)}s
      </Chip>
      <ul className="flex flex-col gap-1">
        {project.overlays.map((o) => (
          <li key={o.id} className="flex items-center justify-between font-body text-sm text-muted">
            <span>
              {o.text} · {o.outStartSec.toFixed(1)}s
            </span>
            <button
              type="button"
              className="min-h-[44px] px-2 text-faint hover:text-white"
              aria-label={`Remove caption ${o.text}`}
              onClick={() => onChange(removeOverlay(project, o.id))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
