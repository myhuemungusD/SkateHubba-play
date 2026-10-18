/** Color math for the Closet Studio color wheel, swatches and eyedropper. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isHex(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v);
}

export function hexToRgb(hex: string): Rgb {
  const n = isHex(hex) ? parseInt(hex.slice(1), 16) : 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** h in [0, 360), s and v in [0, 1]. */
export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  const table: Array<[number, number, number]> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = table[Math.min(5, Math.floor(hh))];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}

/** Point on the wheel (dx, dy from center, radius r) → hue/saturation at the given value. */
export function wheelToHex(dx: number, dy: number, radius: number, value: number): string {
  const s = Math.min(1, Math.hypot(dx, dy) / radius);
  const h = (Math.atan2(dy, dx) * 180) / Math.PI;
  return rgbToHex(hsvToRgb({ h, s, v: value }));
}

/** Most-recent-first list of colors, deduped, capped. */
export function pushRecent(recent: readonly string[], hex: string, max = 12): string[] {
  const up = hex.toUpperCase();
  return [up, ...recent.filter((c) => c.toUpperCase() !== up)].slice(0, max);
}

/** Skate-shop palette: Mike's colorways plus the app's brand colors. */
export const SWATCHES: readonly string[] = [
  "#000000",
  "#FFFFFF",
  "#FF6B00",
  "#E53935",
  "#7B1E1E",
  "#FFC107",
  "#C9A227",
  "#4CAF50",
  "#556B2F",
  "#00897B",
  "#1E88E5",
  "#1A237E",
  "#8E24AA",
  "#F48FB1",
  "#D2B48C",
  "#8D6E63",
  "#9E9E9E",
  "#37474F",
];
