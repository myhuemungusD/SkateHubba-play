import type { EditProject, SfxPlacement, TextOverlay } from "./types";
import { getSound } from "./sfxLibrary";
import { outputDuration } from "./speed";
import { clamp } from "./project";

export const OVERLAY_MAX_CHARS = 40;
export const MAX_SFX = 32;

let seq = 0;
const uid = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Add a trick-name caption. Defaults to 1.5s centred on `outAtSec`. */
export function addOverlay(
  p: EditProject,
  text: string,
  outAtSec: number,
  style: TextOverlay["style"] = "stamp",
): EditProject {
  const clean = text.trim().slice(0, OVERLAY_MAX_CHARS);
  if (!clean) return p;
  const dur = outputDuration(p);
  const start = clamp(outAtSec - 0.75, 0, Math.max(0, dur - 0.5));
  const end = clamp(start + 1.5, start + 0.5, Math.max(start + 0.5, dur));
  return {
    ...p,
    overlays: [...p.overlays, { id: uid("txt"), text: clean, outStartSec: start, outEndSec: end, style }],
  };
}

export function removeOverlay(p: EditProject, id: string): EditProject {
  return { ...p, overlays: p.overlays.filter((o) => o.id !== id) };
}

export function overlaysAt(p: EditProject, outSec: number): TextOverlay[] {
  return p.overlays.filter((o) => outSec >= o.outStartSec && outSec < o.outEndSec);
}

/** Drop a skate sound on the timeline (output seconds). Unknown ids are ignored. */
export function placeSfx(p: EditProject, soundId: string, outAtSec: number, gain = 1): EditProject {
  if (!getSound(soundId) || p.sfx.length >= MAX_SFX) return p;
  const at = clamp(outAtSec, 0, outputDuration(p));
  const placement: SfxPlacement = { id: uid("sfx"), soundId, outAtSec: at, gain: clamp(gain, 0, 2) };
  return { ...p, sfx: [...p.sfx, placement].sort((a, b) => a.outAtSec - b.outAtSec) };
}

/** Like placeSfx, but also returns the new placement's id (to select it). */
export function addSfx(p: EditProject, soundId: string, outAtSec: number): { project: EditProject; id: string | null } {
  const next = placeSfx(p, soundId, outAtSec);
  const added = next.sfx.find((x) => !p.sfx.some((y) => y.id === x.id));
  return { project: next, id: added?.id ?? null };
}

export function moveSfx(p: EditProject, id: string, outAtSec: number): EditProject {
  const at = clamp(outAtSec, 0, outputDuration(p));
  return {
    ...p,
    sfx: p.sfx.map((x) => (x.id === id ? { ...x, outAtSec: at } : x)).sort((a, b) => a.outAtSec - b.outAtSec),
  };
}

export function removeSfx(p: EditProject, id: string): EditProject {
  return { ...p, sfx: p.sfx.filter((x) => x.id !== id) };
}

/** Fade applied at both ends of every sound so trimmed cuts never click. */
export const SFX_FADE_SEC = 0.012;
/** Shortest a sound can be trimmed to. */
export const MIN_SFX_SEC = 0.05;

/** The part of the sound file that plays, in file seconds. */
export function sfxSpan(s: SfxPlacement, fileDurSec?: number): { start: number; end: number; length: number } {
  const full = fileDurSec ?? getSound(s.soundId)?.durationSec ?? 0;
  const start = clamp(s.trimStartSec ?? 0, 0, Math.max(0, full - MIN_SFX_SEC));
  const end = clamp(s.trimEndSec ?? full, Math.min(full, start + MIN_SFX_SEC), full);
  return { start, end, length: Math.max(0, end - start) };
}

/** Set a placed sound's in/out points (file seconds); keeps at least MIN_SFX_SEC. */
export function trimSfx(p: EditProject, id: string, startSec: number, endSec: number): EditProject {
  return {
    ...p,
    sfx: p.sfx.map((x) => {
      if (x.id !== id) return x;
      const full = getSound(x.soundId)?.durationSec ?? 0;
      const start = clamp(Math.min(startSec, endSec - MIN_SFX_SEC), 0, Math.max(0, full - MIN_SFX_SEC));
      const end = clamp(Math.max(endSec, start + MIN_SFX_SEC), start + MIN_SFX_SEC, full);
      return { ...x, trimStartSec: round3(start), trimEndSec: round3(end) };
    }),
  };
}

export function setSfxGain(p: EditProject, id: string, gain: number): EditProject {
  return { ...p, sfx: p.sfx.map((x) => (x.id === id ? { ...x, gain: clamp(gain, 0, 2) } : x)) };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export interface SfxSchedule {
  /** Seconds from "now" (playback position fromOut) until the sound starts. */
  delay: number;
  /** Offset into the sound file to start reading. */
  offset: number;
  /** Seconds of audio to play. */
  length: number;
  /** Fade length at each end (0 at the start when playback begins mid-sound). */
  fadeIn: number;
  fadeOut: number;
}

/** When and how much of a placed sound to play from output time `fromOut`; null if it's already over. */
export function sfxSchedule(s: SfxPlacement, fileDurSec: number, fromOut: number): SfxSchedule | null {
  const span = sfxSpan(s, fileDurSec);
  if (span.length <= 0 || s.outAtSec + span.length <= fromOut) return null;
  const skip = Math.max(0, fromOut - s.outAtSec);
  const length = span.length - skip;
  const fade = Math.min(SFX_FADE_SEC, length / 2);
  return {
    delay: Math.max(0, s.outAtSec - fromOut),
    offset: span.start + skip,
    length,
    fadeIn: skip > 0 ? 0 : fade,
    fadeOut: fade,
  };
}
