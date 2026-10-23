import { useEffect, useRef, useState } from "react";
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, SWATCHES, wheelToHex } from "../../lib/closetStudio/color";

interface Props {
  color: string;
  recent: string[];
  onColor: (hex: string) => void;
}

const WHEEL = 160;

/** Color wheel (hue × saturation) + brightness slider, swatches and recent colors. */
export function ColorPanel({ color, recent, onColor }: Props) {
  const wheelRef = useRef<HTMLCanvasElement>(null);
  const [value, setValue] = useState(() => rgbToHsv(hexToRgb(color)).v || 1);

  useEffect(() => {
    const ctx = wheelRef.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(WHEEL, WHEEL);
    const r = WHEEL / 2;
    for (let y = 0; y < WHEEL; y++) {
      for (let x = 0; x < WHEEL; x++) {
        const dx = x - r;
        const dy = y - r;
        if (Math.hypot(dx, dy) > r) continue;
        const { r: cr, g, b } = hexToRgb(wheelToHex(dx, dy, r, value));
        img.data.set([cr, g, b, 255], (y * WHEEL + x) * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [value]);

  const pickWheel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === "pointermove" && e.buttons === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const r = rect.width / 2;
    onColor(wheelToHex(e.clientX - rect.left - r, e.clientY - rect.top - r, r, value));
  };

  const setBrightness = (v: number) => {
    setValue(v);
    const hsv = rgbToHsv(hexToRgb(color));
    onColor(rgbToHex(hsvToRgb({ ...hsv, v })));
  };

  const chip = (hex: string, label: string) => (
    <button
      key={`${label}-${hex}`}
      type="button"
      aria-label={`${label} ${hex}`}
      onClick={() => onColor(hex)}
      className={`h-7 w-7 rounded-full border ${hex.toUpperCase() === color.toUpperCase() ? "border-white ring-2 ring-brand-orange" : "border-border"}`}
      style={{ backgroundColor: hex }}
    />
  );

  return (
    <div className="space-y-3" data-testid="color-panel">
      <div className="flex items-center gap-4">
        <canvas
          ref={wheelRef}
          width={WHEEL}
          height={WHEEL}
          aria-label="Color wheel"
          data-testid="color-wheel"
          className="h-32 w-32 touch-none rounded-full"
          onPointerDown={pickWheel}
          onPointerMove={pickWheel}
        />
        <div className="flex-1 space-y-2">
          <div
            className="h-10 rounded-lg border border-border"
            style={{ backgroundColor: color }}
            data-testid="color-current"
          />
          <label className="block font-body text-xs text-subtle">
            Brightness
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={value}
              onChange={(e) => setBrightness(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <input
            type="color"
            aria-label="Exact color"
            value={color.toLowerCase()}
            onChange={(e) => onColor(e.target.value.toUpperCase())}
            className="h-8 w-full"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">{SWATCHES.map((hex) => chip(hex, "Swatch"))}</div>
      {recent.length > 0 && (
        <div>
          <p className="mb-1 font-body text-label uppercase tracking-wider text-faint">Recent</p>
          <div className="flex flex-wrap gap-2">{recent.map((hex) => chip(hex, "Recent"))}</div>
        </div>
      )}
    </div>
  );
}
