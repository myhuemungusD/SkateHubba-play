import {
  Droplet,
  Eraser,
  FlipHorizontal2,
  PaintBucket,
  Paintbrush,
  Pipette,
  Redo2,
  Sticker,
  Type,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Tool } from "./StudioCanvas";

const TOOLS: ReadonlyArray<[Tool, string, LucideIcon]> = [
  ["fill", "Fill", PaintBucket],
  ["brush", "Brush", Paintbrush],
  ["eraser", "Eraser", Eraser],
  ["eyedropper", "Eyedropper", Pipette],
  ["sticker", "Sticker", Sticker],
  ["text", "Text", Type],
];

interface Props {
  tool: Tool;
  onTool: (t: Tool) => void;
  symmetry: boolean;
  onSymmetry: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  color: string;
}

export function StudioToolbar(p: Props) {
  const btn = "flex h-11 w-11 items-center justify-center rounded-xl border";
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="toolbar"
      aria-label="Studio tools"
      data-tutorial="studio-tools"
    >
      {TOOLS.map(([id, label, Icon]) => (
        <button
          key={id}
          type="button"
          aria-label={label}
          aria-pressed={p.tool === id}
          onClick={() => p.onTool(id)}
          className={`${btn} ${p.tool === id ? "border-brand-orange bg-brand-orange/15 text-brand-orange" : "border-border text-white"}`}
        >
          <Icon size={20} aria-hidden="true" />
        </button>
      ))}
      <button
        type="button"
        aria-label="Symmetry"
        aria-pressed={p.symmetry}
        onClick={p.onSymmetry}
        className={`${btn} ${p.symmetry ? "border-brand-orange text-brand-orange" : "border-border text-white"}`}
      >
        <FlipHorizontal2 size={20} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Undo"
        disabled={!p.canUndo}
        onClick={p.onUndo}
        className={`${btn} border-border text-white disabled:opacity-30`}
      >
        <Undo2 size={20} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Redo"
        disabled={!p.canRedo}
        onClick={p.onRedo}
        className={`${btn} border-border text-white disabled:opacity-30`}
      >
        <Redo2 size={20} aria-hidden="true" />
      </button>
      <span className="ml-auto flex items-center gap-1 font-body text-xs text-subtle">
        <Droplet size={14} aria-hidden="true" style={{ color: p.color }} />
        {p.color}
      </span>
    </div>
  );
}
