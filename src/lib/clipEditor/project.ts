import type { EditProject, EditorAngle } from "./types";

/** Smallest trim window we allow, so a stray drag can't produce an empty clip. */
export const MIN_TRIM_SEC = 0.5;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Fresh project for a single clip: untouched, real-time, natural color, 1080p30. */
export function createProject(primary: EditorAngle): EditProject {
  return {
    angles: [{ ...primary, offsetSec: 0 }],
    cuts: [],
    trimInSec: 0,
    trimOutSec: primary.durationSec,
    landingSec: null,
    speed: [{ atSec: 0, speed: 1 }],
    look: "none",
    lookStrength: 1,
    color: "natural",
    overlays: [],
    music: null,
    sfx: [],
    stabilize: false,
    export: { resolution: "1080p", fps: primary.fps >= 50 ? 60 : 30 },
  };
}

/** Set the trim window, keeping it inside the clip and at least MIN_TRIM_SEC long. */
export function setTrim(p: EditProject, inSec: number, outSec: number): EditProject {
  const dur = p.angles[0].durationSec;
  const minLen = Math.min(MIN_TRIM_SEC, dur);
  let a = clamp(inSec, 0, dur);
  let b = clamp(outSec, 0, dur);
  if (b < a) [a, b] = [b, a];
  if (b - a < minLen) {
    b = Math.min(dur, a + minLen);
    a = b - minLen;
  }
  const landing = p.landingSec === null ? null : clamp(p.landingSec, a, b);
  return { ...p, trimInSec: a, trimOutSec: b, landingSec: landing };
}

export function setLanding(p: EditProject, sec: number | null): EditProject {
  return { ...p, landingSec: sec === null ? null : clamp(sec, p.trimInSec, p.trimOutSec) };
}

/**
 * "Trim to the trick": keep `lead` seconds of roll-in before the landing and
 * `tail` seconds of ride-away after it — the framing skate editors cut to.
 */
export function trimToTrick(p: EditProject, lead = 2.5, tail = 1.5): EditProject {
  if (p.landingSec === null) return p;
  const landing = p.landingSec;
  const next = setTrim(p, landing - lead, landing + tail);
  return { ...next, landingSec: clamp(landing, next.trimInSec, next.trimOutSec) };
}

/** Add a second (or third…) angle for a line. Max 4 angles. */
export function addAngle(p: EditProject, angle: EditorAngle): EditProject {
  if (p.angles.length >= 4 || p.angles.some((a) => a.id === angle.id)) return p;
  return { ...p, angles: [...p.angles, angle] };
}

export function removeAngle(p: EditProject, angleId: string): EditProject {
  if (p.angles[0].id === angleId) return p;
  return {
    ...p,
    angles: p.angles.filter((a) => a.id !== angleId),
    cuts: p.cuts.filter((c) => c.angleId !== angleId),
  };
}

/** Cut to `angleId` at `atSec`. Replaces any cut at the same instant. Sorted. */
export function addCut(p: EditProject, atSec: number, angleId: string): EditProject {
  if (!p.angles.some((a) => a.id === angleId)) return p;
  const at = clamp(atSec, p.trimInSec, p.trimOutSec);
  const cuts = p.cuts.filter((c) => Math.abs(c.atSec - at) > 0.01).concat({ atSec: at, angleId });
  cuts.sort((x, y) => x.atSec - y.atSec);
  return { ...p, cuts };
}

/** Which angle is on screen at source time `sec`. */
export function angleAt(p: EditProject, sec: number): EditorAngle {
  let id = p.angles[0].id;
  for (const c of p.cuts) {
    if (c.atSec <= sec) id = c.angleId;
    else break;
  }
  return p.angles.find((a) => a.id === id) ?? p.angles[0];
}
