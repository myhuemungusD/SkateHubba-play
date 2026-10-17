import type { EditProject } from "./types";
import { getTrack } from "./musicLibrary";

/** Beat times (output seconds) for the chosen track across the edit. */
export function beatGrid(bpm: number, trackOffsetSec: number, durationSec: number, firstBeatSec = 0): number[] {
  if (bpm <= 0 || durationSec <= 0) return [];
  const period = 60 / bpm;
  // First beat at or after output 0: track time = out + offset.
  const k0 = Math.ceil((trackOffsetSec - firstBeatSec) / period - 1e-9);
  const beats: number[] = [];
  for (let k = k0; ; k++) {
    const out = firstBeatSec + k * period - trackOffsetSec;
    if (out > durationSec + 1e-9) break;
    if (out >= -1e-9) beats.push(Math.max(0, Number(out.toFixed(4))));
  }
  return beats;
}

/** Nearest beat to `t`, or `t` itself when there are no beats. */
export function snapToBeat(t: number, beats: number[]): number {
  let best = t;
  let dist = Infinity;
  for (const b of beats) {
    const d = Math.abs(b - t);
    if (d < dist) {
      dist = d;
      best = b;
    }
  }
  return best;
}

/**
 * Shift the music so a downbeat hits exactly on the landing (output time) —
 * the classic "land on the drop" sync.
 */
export function alignMusicToLanding(p: EditProject, landingOutSec: number): EditProject {
  if (!p.music) return p;
  const track = getTrack(p.music.trackId);
  if (!track) return p;
  const bar = (60 / track.bpm) * 4;
  // Want trackTime(landing) = firstBeat + n*bar, with offset >= 0.
  const n = Math.max(0, Math.ceil((landingOutSec - track.firstBeatSec) / bar));
  const offset = track.firstBeatSec + n * bar - landingOutSec;
  return { ...p, music: { ...p.music, trackOffsetSec: Number(offset.toFixed(4)) } };
}
