import type { EditProject, SpeedKey } from "./types";
import { clamp } from "./project";

const MIN_SPEED = 0.125;
const MAX_SPEED = 4;

export type SpeedRampPreset = "realtime" | "landing-slowmo" | "pop-slowmo" | "hammer" | "fast-roll-in";

export const SPEED_RAMP_PRESETS: { id: SpeedRampPreset; label: string; hint: string }[] = [
  { id: "realtime", label: "Real time", hint: "No speed change" },
  {
    id: "landing-slowmo",
    label: "Slow the trick",
    hint: "Real time in, slow through the trick, back to speed on the ride-away",
  },
  { id: "pop-slowmo", label: "Slow the pop", hint: "Slow from the pop through the catch" },
  { id: "hammer", label: "Hammer", hint: "Fast roll-in, super slow trick, real-time landing" },
  { id: "fast-roll-in", label: "Fast roll-in", hint: "Speed up the push, real time for the trick" },
];

function normalize(keys: SpeedKey[]): SpeedKey[] {
  const out = keys
    .map((k) => ({ atSec: k.atSec, speed: clamp(k.speed, MIN_SPEED, MAX_SPEED) }))
    .sort((a, b) => a.atSec - b.atSec);
  if (out.length === 0 || out[0].atSec > 0) out.unshift({ atSec: 0, speed: 1 });
  return out;
}

/**
 * Build speed keys for a preset around the landing. Ramps are stepped in
 * short increments so the change eases in like CapCut's "curve" ramps rather
 * than snapping.
 */
export function buildSpeedRamp(preset: SpeedRampPreset, landingSec: number | null, slow = 0.25): SpeedKey[] {
  if (preset === "realtime" || landingSec === null) return [{ atSec: 0, speed: 1 }];
  const L = landingSec;
  const ease = (from: number, to: number, start: number, len: number, steps = 4): SpeedKey[] =>
    Array.from({ length: steps }, (_, i) => ({
      atSec: start + (len * i) / steps,
      speed: from + ((to - from) * (i + 1)) / steps,
    }));
  switch (preset) {
    case "landing-slowmo":
      return normalize([...ease(1, slow, L - 1.2, 0.3), ...ease(slow, 1, L + 0.2, 0.3)]);
    case "pop-slowmo":
      return normalize([...ease(1, slow, L - 1.0, 0.2), ...ease(slow, 1, L - 0.2, 0.2)]);
    case "hammer":
      return normalize([{ atSec: 0, speed: 2 }, ...ease(2, slow / 2, L - 1.2, 0.3), { atSec: L, speed: 1 }]);
    case "fast-roll-in":
      return normalize([{ atSec: 0, speed: 2 }, ...ease(2, 1, L - 1.5, 0.3)]);
  }
}

export function setSpeedKeys(p: EditProject, keys: SpeedKey[]): EditProject {
  return { ...p, speed: normalize(keys) };
}

/** Speed in effect at source time `sec`. */
export function speedAt(keys: SpeedKey[], sec: number): number {
  let s = 1;
  for (const k of keys) {
    if (k.atSec <= sec) s = k.speed;
    else break;
  }
  return s;
}

/** Segments of constant speed clipped to [inSec, outSec]. */
export function speedSegments(
  keys: SpeedKey[],
  inSec: number,
  outSec: number,
): { from: number; to: number; speed: number }[] {
  const ks = normalize(keys);
  const segs: { from: number; to: number; speed: number }[] = [];
  for (let i = 0; i < ks.length; i++) {
    const from = Math.max(ks[i].atSec, inSec);
    const to = Math.min(i + 1 < ks.length ? ks[i + 1].atSec : Infinity, outSec);
    if (to > from) segs.push({ from, to, speed: ks[i].speed });
  }
  return segs;
}

/** Output seconds that source time `sec` lands at (after trim + speed). */
export function sourceToOutput(p: EditProject, sec: number): number {
  const s = clamp(sec, p.trimInSec, p.trimOutSec);
  let out = 0;
  for (const seg of speedSegments(p.speed, p.trimInSec, s)) out += (seg.to - seg.from) / seg.speed;
  return out;
}

/** Inverse of sourceToOutput. */
export function outputToSource(p: EditProject, outSec: number): number {
  let remaining = Math.max(0, outSec);
  for (const seg of speedSegments(p.speed, p.trimInSec, p.trimOutSec)) {
    const len = (seg.to - seg.from) / seg.speed;
    if (remaining <= len) return seg.from + remaining * seg.speed;
    remaining -= len;
  }
  return p.trimOutSec;
}

export function outputDuration(p: EditProject): number {
  return sourceToOutput(p, p.trimOutSec);
}
