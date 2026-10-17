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
