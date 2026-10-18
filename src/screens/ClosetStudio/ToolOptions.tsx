import { STICKERS, TEXT_FONTS } from "../../lib/closetStudio/stickers";
import type { BrushSettings } from "../../lib/closetStudio/engine";
import type { Tool } from "./StudioCanvas";

export interface StampSettings {
  sticker: string;
  text: string;
  font: string;
  size: number;
}

interface Props {
  tool: Tool;
  brush: BrushSettings;
  onBrush: (b: BrushSettings) => void;
  stamp: StampSettings;
  onStamp: (s: StampSettings) => void;
}

function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block font-body text-xs text-subtle">
      {props.label} <span className="text-white">{props.value}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-full"
      />
    </label>
  );
}

/** Settings for the current tool. */
export function ToolOptions({ tool, brush, onBrush, stamp, onStamp }: Props) {
  if (tool === "brush" || tool === "eraser") {
    return (
      <div className="grid grid-cols-3 gap-3" data-testid="brush-options">
        <Slider
          label="Size"
          min={1}
          max={120}
          step={1}
          value={brush.size}
          onChange={(size) => onBrush({ ...brush, size })}
        />
        <Slider
          label="Opacity"
          min={0.05}
          max={1}
          step={0.05}
          value={brush.opacity}
          onChange={(opacity) => onBrush({ ...brush, opacity })}
        />
        <Slider
          label="Hardness"
          min={0}
          max={1}
          step={0.05}
          value={brush.hardness}
          onChange={(hardness) => onBrush({ ...brush, hardness })}
        />
      </div>
    );
  }
  if (tool === "sticker") {
    return (
      <div className="space-y-2" data-testid="sticker-options">
        <div className="flex flex-wrap gap-2">
          {STICKERS.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={`Sticker ${s}`}
              aria-pressed={stamp.sticker === s}
              onClick={() => onStamp({ ...stamp, sticker: s })}
              className={`h-10 w-10 rounded-lg border text-xl ${stamp.sticker === s ? "border-brand-orange" : "border-border"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <Slider
          label="Size"
          min={16}
          max={200}
          step={2}
          value={stamp.size}
          onChange={(size) => onStamp({ ...stamp, size })}
        />
        <p className="font-body text-[11px] text-faint">Tap the canvas to place it.</p>
      </div>
    );
  }
  if (tool === "text") {
    return (
      <div className="space-y-2" data-testid="text-options">
        <input
          type="text"
          maxLength={24}
          value={stamp.text}
          aria-label="Text to place"
          onChange={(e) => onStamp({ ...stamp, text: e.target.value })}
          className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2 font-body text-sm text-white"
        />
        <select
          aria-label="Font"
          value={stamp.font}
          onChange={(e) => onStamp({ ...stamp, font: e.target.value })}
          className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2 font-body text-sm text-white"
        >
          {TEXT_FONTS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <Slider
          label="Size"
          min={12}
          max={160}
          step={2}
          value={stamp.size}
          onChange={(size) => onStamp({ ...stamp, size })}
        />
      </div>
    );
  }
  return (
    <p className="font-body text-xs text-subtle" data-testid="tap-hint">
      {tool === "fill"
        ? "Tap a panel to fill it. Lines on the template stop the paint."
        : "Tap the design to grab a color."}
    </p>
  );
}
