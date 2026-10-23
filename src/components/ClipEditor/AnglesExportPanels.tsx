import type { ExportFps, ExportResolution } from "../../lib/clipEditor/types";
import { addCut, removeAngle } from "../../lib/clipEditor/project";
import { RESOLUTIONS, allowedResolutions, planExport, type ExportCapabilities } from "../../lib/clipEditor/exportPlan";
import { snapToBeat } from "../../lib/clipEditor/beats";
import { outputToSource, sourceToOutput } from "../../lib/clipEditor/speed";
import { Chip, PanelHeading } from "./Chip";
import type { PanelProps } from "./EditPanels";

export interface AnglesPanelProps extends PanelProps {
  beats: number[];
  onAddAngle: () => void;
}

/** Multi-angle line cuts: add up to 4 angles, then cut between them at the playhead. */
export function AnglesPanel({ project, onChange, sourceTime, beats, onAddAngle }: AnglesPanelProps) {
  const cutTo = (angleId: string): void => {
    // Snap to the nearest beat when music is on, like CapCut's beat-cut.
    const at = beats.length
      ? outputToSource(project, snapToBeat(sourceToOutput(project, sourceTime), beats))
      : sourceTime;
    onChange(addCut(project, at, angleId));
  };
  return (
    <div className="flex flex-col gap-3">
      <PanelHeading>ANGLES</PanelHeading>
      <ul className="flex flex-col gap-2">
        {project.angles.map((a, i) => (
          <li key={a.id} className="flex items-center gap-2">
            <Chip selected={false} onClick={() => cutTo(a.id)} hint="Cut to this angle at the playhead">
              Cut to {a.label}
            </Chip>
            {i > 0 && (
              <button
                type="button"
                aria-label={`Remove ${a.label}`}
                className="min-h-[44px] px-2 font-body text-sm text-faint hover:text-white"
                onClick={() => onChange(removeAngle(project, a.id))}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <Chip selected={false} disabled={project.angles.length >= 4} onClick={onAddAngle}>
        + Add angle
      </Chip>
      <p className="font-body text-xs text-faint">
        Film the same line from another spot (long lens + follow cam), add it here, then cut between them.
        {project.cuts.length > 0 ? ` ${project.cuts.length} cut${project.cuts.length > 1 ? "s" : ""}.` : ""}
      </p>
    </div>
  );
}

export interface ExportPanelProps extends PanelProps {
  caps: ExportCapabilities;
  exporting: boolean;
  progress: number;
  onExport: () => void;
}

const FPS: ExportFps[] = [30, 60];

export function ExportPanel({ project, onChange, caps, exporting, progress, onExport }: ExportPanelProps) {
  const plan = planExport(project, caps);
  const setRes = (resolution: ExportResolution): void =>
    onChange({ ...project, export: { ...project.export, resolution } });
  return (
    <div className="flex flex-col gap-3">
      <PanelHeading>QUALITY</PanelHeading>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(RESOLUTIONS) as ExportResolution[]).map((r) => (
          <Chip
            key={r}
            selected={plan.width === RESOLUTIONS[r].width}
            disabled={!allowedResolutions(caps).includes(r)}
            onClick={() => setRes(r)}
          >
            {RESOLUTIONS[r].label}
          </Chip>
        ))}
        {FPS.map((f) => (
          <Chip
            key={f}
            selected={plan.fps === f}
            disabled={f === 60 && !caps.max60fps}
            onClick={() => onChange({ ...project, export: { ...project.export, fps: f } })}
          >
            {f} fps
          </Chip>
        ))}
      </div>
      <Chip
        selected={project.stabilize}
        disabled={!caps.stabilization}
        onClick={() => onChange({ ...project, stabilize: !project.stabilize })}
        hint="Smooths shaky follow-cam footage (iPhone app)"
      >
        Stabilize {caps.stabilization ? "" : "(iPhone app)"}
      </Chip>
      <p className="font-body text-xs text-faint">
        {plan.width}×{plan.height} · {plan.fps}fps · ~{(plan.estimatedBytes / 1_000_000).toFixed(0)} MB
        {plan.exceedsUploadCap
          ? " · the feed copy is compressed to fit; the full-quality file saves to your camera roll"
          : ""}
        {caps.native ? "" : " · 4K export needs the iPhone app"}
      </p>
      <button
        type="button"
        onClick={onExport}
        disabled={exporting}
        className="min-h-[52px] rounded-2xl bg-brand-orange font-display text-lg tracking-wider text-on-brand disabled:opacity-60"
      >
        {exporting ? `Exporting ${Math.round(progress * 100)}%` : "Export"}
      </button>
      {exporting && (
        <div
          role="progressbar"
          aria-label="Export progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="h-1.5 overflow-hidden rounded bg-surface-alt"
        >
          <div className="h-full bg-brand-orange transition-[width]" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </div>
  );
}
