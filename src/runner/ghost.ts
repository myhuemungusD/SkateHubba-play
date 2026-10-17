import { GHOST_SPACING } from "./tune";

/** One sample of a finished run. The board replays it by distance. */
export interface GhostSample {
  d: number;
  x: number;
  y: number;
}

export interface PersonalBest {
  score: number;
  distance: number;
  samples: GhostSample[];
}

const KEY = "skatehubba.runner.best.v1";
const MAX_SAMPLES = 600;

export function emptyBest(): PersonalBest {
  return { score: 0, distance: 0, samples: [] };
}

function isSample(value: unknown): value is GhostSample {
  if (!value || typeof value !== "object") return false;
  const sample = value as GhostSample;
  return Number.isFinite(sample.d) && Number.isFinite(sample.x) && Number.isFinite(sample.y);
}

export function loadBest(): PersonalBest {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyBest();
    const parsed = JSON.parse(raw) as Partial<PersonalBest>;
    if (!parsed || !Array.isArray(parsed.samples)) return emptyBest();
    const samples = parsed.samples.filter(isSample).slice(0, MAX_SAMPLES);
    const score = typeof parsed.score === "number" && parsed.score > 0 ? parsed.score : 0;
    const distance = typeof parsed.distance === "number" && parsed.distance > 0 ? parsed.distance : 0;
    if (score <= 0 || samples.length === 0) return emptyBest();
    return { score, distance, samples };
  } catch {
    return emptyBest();
  }
}

export function saveBest(best: PersonalBest): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(best));
  } catch {
    // A full or blocked store just means no ghost next run.
  }
}

export function noteSample(samples: GhostSample[], distance: number, x: number, y: number): GhostSample[] {
  const last = samples[samples.length - 1];
  if (last && distance < last.d + GHOST_SPACING) return samples;
  if (samples.length >= MAX_SAMPLES) return samples;
  samples.push({ d: distance, x, y });
  return samples;
}

/** Where the best run was when it had traveled `distance`. Null once you pass that run. */
export function sampleAt(samples: readonly GhostSample[], distance: number): { x: number; y: number } | null {
  const first = samples[0];
  if (!first) return null;
  if (distance <= first.d) return { x: first.x, y: first.y };
  const last = samples[samples.length - 1];
  if (!last || distance > last.d) return null;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    const sample = samples[mid];
    if (!sample || sample.d < distance) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  if (!a || !b) return null;
  const span = b.d - a.d;
  const t = span <= 1e-6 ? 0 : (distance - a.d) / span;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
