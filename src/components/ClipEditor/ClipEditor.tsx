import { useEffect, useMemo, useRef, useState } from "react";
import type { EditProject, EditorAngle } from "../../lib/clipEditor/types";
import { createProject, addAngle } from "../../lib/clipEditor/project";
import { outputDuration, outputToSource } from "../../lib/clipEditor/speed";
import { beatGrid } from "../../lib/clipEditor/beats";
import { getTrack } from "../../lib/clipEditor/musicLibrary";
import { placeSfx, moveSfx, removeSfx } from "../../lib/clipEditor/overlays";
import { NATIVE_CAPABILITIES, WEB_CAPABILITIES, type ExportCapabilities } from "../../lib/clipEditor/exportPlan";
import { EditorEngine } from "../../lib/clipEditor/engine";
import { getNativeEditorSupport } from "../../services/clipEditorNative";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { Timeline } from "./Timeline";
import { TrimSpeedPanel, LookPanel, TextPanel } from "./EditPanels";
import { MusicPanel, SoundsPanel } from "./AudioPanels";
import { AnglesPanel, ExportPanel } from "./AnglesExportPanels";
import { exportClip, audioUrls } from "./exportClip";
import { readAngle } from "./readAngle";

export interface ClipEditorProps {
  blob: Blob;
  onDone: (edited: Blob) => void;
  onCancel: () => void;
}

const TABS = ["Trim", "Look", "Text", "Music", "Sounds", "Angles", "Export"] as const;
type Tab = (typeof TABS)[number];

/** Full-screen skate clip editor. Lazy-loaded behind VITE_FEATURE_CLIP_EDITOR. */
export function ClipEditor({ blob, onDone, onCancel }: ClipEditorProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<EditorEngine | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<Record<string, Blob>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [project, setProject] = useState<EditProject | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<Tab>("Trim");
  const [error, setError] = useState<string | null>(null);
  const [caps, setCaps] = useState<ExportCapabilities>(WEB_CAPABILITIES);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  useFocusTrap(panelRef);

  useEffect(() => {
    let live = true;
    void readAngle(blob, "main", "Angle 1")
      .then((a) => {
        if (!live) return;
        const p = createProject(a.angle);
        setSources({ main: blob });
        setUrls({ main: a.url });
        setProject(p);
        // The canvas is always mounted, so the engine can start as soon as the clip is probed.
        if (canvasRef.current && !engineRef.current) {
          try {
            engineRef.current = new EditorEngine(canvasRef.current, p, setPlayhead);
            engineRef.current.setSources({ main: a.url });
            void engineRef.current.seek(0);
          } catch {
            setError("Your device can't preview edits here. Update your browser or use the iPhone app.");
          }
        }
      })
      .catch(() => live && setError("Couldn't open this clip."));
    void getNativeEditorSupport().then(
      (s) =>
        live &&
        s.available &&
        setCaps({ ...NATIVE_CAPABILITIES, maxResolution: s.supports4k ? "4k" : "1080p", max60fps: s.supports60 }),
    );
    return () => {
      live = false;
    };
  }, [blob]);

  useEffect(() => () => engineRef.current?.destroy(), []);
  // Revoke object URLs when they're replaced or the editor closes.
  useEffect(() => () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)), [urls]);

  useEffect(() => {
    if (!project) return;
    engineRef.current?.setProject(project);
    const urls = Object.values(audioUrls(project));
    if (urls.length) void engineRef.current?.loadAudio(urls).catch(() => undefined);
  }, [project]);

  const beats = useMemo(() => {
    const t = project?.music && getTrack(project.music.trackId);
    return project && t
      ? beatGrid(t.bpm, project.music?.trackOffsetSec ?? 0, outputDuration(project), t.firstBeatSec)
      : [];
  }, [project]);

  if (error) {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Clip editor"
        className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-black p-6 text-center"
      >
        <p className="font-body text-white">{error}</p>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded-xl border border-border px-4 font-body text-white"
        >
          Back
        </button>
      </div>
    );
  }

  const togglePlay = async (): Promise<void> => {
    const e = engineRef.current;
    if (!e || !project) return;
    if (e.isPlaying) {
      e.pause();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    await e.play(playhead >= outputDuration(project) - 0.05 ? 0 : playhead);
    setPlaying(false);
  };

  const onAddAngleFile = async (file: File | undefined): Promise<void> => {
    if (!file || !project) return;
    const id = `angle-${project.angles.length + 1}`;
    try {
      const a = await readAngle(file, id, `Angle ${project.angles.length + 1}`);
      setSources((s) => ({ ...s, [id]: file }));
      setUrls((u) => ({ ...u, [id]: a.url }));
      engineRef.current?.setSources({ [id]: a.url });
      setProject((p) => (p ? addAngle(p, a.angle) : p));
    } catch {
      setError("Couldn't open that angle.");
    }
  };

  const doExport = async (): Promise<void> => {
    if (!project || !engineRef.current) return;
    setExporting(true);
    setProgress(0);
    try {
      const r = await exportClip(project, sources, engineRef.current, setProgress);
      onDone(r.blob);
    } catch {
      setError("Export failed. Try a lower quality.");
    } finally {
      setExporting(false);
    }
  };

  const sourceTime = project ? outputToSource(project, playhead) : 0;
  const panelProps = project ? { project, onChange: setProject, sourceTime, outputTime: playhead } : null;
  const primary: EditorAngle | undefined = project?.angles[0];

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="clip-editor-title"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Don't let keys reach the host modal (its Escape closes the whole upload flow).
        e.stopPropagation();
        if (e.key === "Escape" && !exporting) onCancel();
      }}
      className="fixed inset-0 z-[60] flex flex-col bg-black pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      <header className="flex items-center justify-between px-4 py-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={exporting}
          className="min-h-[44px] font-body text-muted hover:text-white"
        >
          Cancel
        </button>
        <h2 id="clip-editor-title" className="font-display text-lg text-white">
          Edit clip
        </h2>
        <button type="button" onClick={() => setTab("Export")} className="min-h-[44px] font-display text-brand-orange">
          Done
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        <canvas
          ref={canvasRef}
          width={primary ? Math.min(1280, primary.width) : 1280}
          height={primary ? Math.round((Math.min(1280, primary.width) * primary.height) / primary.width) : 720}
          aria-label="Edit preview"
          className="max-h-full max-w-full object-contain"
        />
        {!project && <p className="absolute font-body text-sm text-faint">Loading clip…</p>}
      </div>

      {project && panelProps && (
        <div className="flex max-h-[52vh] flex-col gap-3 overflow-y-auto px-4 pb-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void togglePlay()}
              aria-label={playing ? "Pause" : "Play"}
              className="min-h-[44px] min-w-[44px] rounded-full bg-white/10 font-display text-white"
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <div className="flex-1">
              <Timeline
                project={project}
                playhead={playhead}
                beats={beats}
                onSeek={(t) => void engineRef.current?.seek(t)}
                onDropSfx={(id, t) => setProject(placeSfx(project, id, t))}
                onMoveSfx={(id, t) => setProject(moveSfx(project, id, t))}
                onRemoveSfx={(id) => setProject(removeSfx(project, id))}
              />
            </div>
          </div>

          <div role="tablist" aria-label="Editor tools" className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                type="button"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`min-h-[44px] shrink-0 rounded-lg px-3 font-body text-sm ${tab === t ? "bg-white/10 text-white" : "text-faint"}`}
              >
                {t}
              </button>
            ))}
          </div>

          <div role="tabpanel" aria-label={tab}>
            {tab === "Trim" && <TrimSpeedPanel {...panelProps} />}
            {tab === "Look" && <LookPanel {...panelProps} />}
            {tab === "Text" && <TextPanel {...panelProps} />}
            {tab === "Music" && <MusicPanel {...panelProps} />}
            {tab === "Sounds" && <SoundsPanel {...panelProps} />}
            {tab === "Angles" && (
              <AnglesPanel {...panelProps} beats={beats} onAddAngle={() => fileRef.current?.click()} />
            )}
            {tab === "Export" && (
              <ExportPanel
                {...panelProps}
                caps={caps}
                exporting={exporting}
                progress={progress}
                onExport={() => void doExport()}
              />
            )}
          </div>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        hidden
        aria-label="Add another angle"
        data-testid="clip-editor-angle-input"
        onChange={(e) => void onAddAngleFile(e.target.files?.[0])}
      />
    </div>
  );
}
