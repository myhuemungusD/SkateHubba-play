import type { ColorPresetId, LookId } from "./types";

/**
 * Look parameters shared by the WebGL preview shader and the native
 * Core Image pipeline (ios/App/SkatehubbaClipEditor). Keep both in sync.
 */
export interface LookParams {
  /** Barrel distortion strength (0 = none). Matches FisheyeRenderer's atan curve. */
  barrel: number;
  /** Vignette amount 0..1. */
  vignette: number;
  /** Film/tape grain 0..1. */
  grain: number;
  /** Horizontal chroma bleed in pixels at 1080p (VHS). */
  chromaShift: number;
  /** Tape scanline strength 0..1. */
  scanlines: number;
  /** Softness 0..1 (Hi8/VHS low-res feel). */
  blur: number;
  /** Letterbox to 4:3 like a VX1000. */
  fourByThree: boolean;
  /** Burn-in REC timestamp overlay (Hi8/VHS). */
  timestamp: boolean;
}

const NONE: LookParams = {
  barrel: 0,
  vignette: 0,
  grain: 0,
  chromaShift: 0,
  scanlines: 0,
  blur: 0,
  fourByThree: false,
  timestamp: false,
};

export const LOOKS: Record<LookId, { label: string; hint: string; params: LookParams }> = {
  none: { label: "Clean", hint: "No look", params: NONE },
  vx1000: {
    label: "VX1000",
    hint: "Death-lens fisheye, 4:3 frame, light grain — the '90s full-part look",
    params: { ...NONE, barrel: 2.2, vignette: 0.55, grain: 0.15, fourByThree: true },
  },
  fisheye: {
    label: "Fisheye",
    hint: "Barrel lens, full frame",
    params: { ...NONE, barrel: 1.6, vignette: 0.4 },
  },
  vhs: {
    label: "VHS",
    hint: "Tape bleed, scanlines, soft focus, REC date",
    params: { ...NONE, vignette: 0.25, grain: 0.35, chromaShift: 3, scanlines: 0.35, blur: 0.4, timestamp: true },
  },
  hi8: {
    label: "Hi8",
    hint: "Cleaner tape: light grain and bleed, REC date",
    params: { ...NONE, vignette: 0.2, grain: 0.2, chromaShift: 1.5, scanlines: 0.12, blur: 0.2, timestamp: true },
  },
};

/** Scale every effect toward zero by `strength` (0..1). */
export function lookParams(id: LookId, strength: number): LookParams {
  const s = Math.min(1, Math.max(0, strength));
  const p = LOOKS[id].params;
  return {
    barrel: p.barrel * s,
    vignette: p.vignette * s,
    grain: p.grain * s,
    chromaShift: p.chromaShift * s,
    scanlines: p.scanlines * s,
    blur: p.blur * s,
    fourByThree: p.fourByThree,
    timestamp: p.timestamp,
  };
}

/**
 * Color presets as a 4x5 row-major color matrix (RGBA rows, last column is a
 * 0..1 bias) — the same shape as CIColorMatrix and SVG feColorMatrix.
 */
export type ColorMatrix = readonly number[];

const ID: ColorMatrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

function saturation(s: number): number[] {
  const r = 0.2126 * (1 - s);
  const g = 0.7152 * (1 - s);
  const b = 0.0722 * (1 - s);
  return [r + s, g, b, 0, 0, r, g + s, b, 0, 0, r, g, b + s, 0, 0, 0, 0, 0, 1, 0];
}

function compose(
  base: number[],
  gain: [number, number, number],
  bias: [number, number, number],
  contrast = 1,
): number[] {
  const m = [...base];
  const c0 = 0.5 * (1 - contrast);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) m[row * 5 + col] *= gain[row] * contrast;
    m[row * 5 + 4] = bias[row] + c0;
  }
  return m;
}

export const COLOR_PRESETS: Record<ColorPresetId, { label: string; matrix: ColorMatrix }> = {
  natural: { label: "Natural", matrix: ID },
  street: { label: "Street", matrix: compose(saturation(0.85), [1, 1, 1.04], [0, 0, 0.01], 1.15) },
  golden: { label: "Golden hour", matrix: compose(saturation(1.1), [1.08, 1.0, 0.86], [0.03, 0.01, 0], 1.05) },
  mono: { label: "B&W", matrix: compose(saturation(0), [1, 1, 1], [0, 0, 0], 1.2) },
  faded: { label: "Faded", matrix: compose(saturation(0.75), [0.9, 0.9, 0.92], [0.07, 0.07, 0.08], 0.9) },
  cold: { label: "Cold", matrix: compose(saturation(0.9), [0.94, 1, 1.1], [0, 0.01, 0.03], 1.05) },
  punch: { label: "Punch", matrix: compose(saturation(1.3), [1, 1, 1], [0, 0, 0], 1.12) },
};
