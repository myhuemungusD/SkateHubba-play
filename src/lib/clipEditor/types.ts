/**
 * Clip editor project model. Pure data, no DOM. Everything the preview and
 * both export paths (web canvas + native AVFoundation) need to render the
 * same edit lives here, so the two renderers cannot drift.
 *
 * Times are in SOURCE seconds unless named `out*` (output timeline seconds,
 * after speed changes).
 */

export type LookId = "none" | "vx1000" | "fisheye" | "vhs" | "hi8";
export type ColorPresetId = "natural" | "street" | "golden" | "mono" | "faded" | "cold" | "punch";
export type ExportResolution = "720p" | "1080p" | "4k";
export type ExportFps = 30 | 60;

/** One camera angle. `offsetSec` aligns it to angle 0 (positive = starts later). */
export interface EditorAngle {
  id: string;
  label: string;
  durationSec: number;
  offsetSec: number;
  width: number;
  height: number;
  fps: number;
}

/** From `atSec` onward (source time on angle 0's clock) show `angleId`. */
interface AngleCut {
  atSec: number;
  angleId: string;
}

/** A speed keyframe. Speed holds until the next keyframe. 1 = real time. */
export interface SpeedKey {
  atSec: number;
  speed: number;
}

export interface TextOverlay {
  id: string;
  text: string;
  /** Output-timeline seconds. */
  outStartSec: number;
  outEndSec: number;
  style: "stamp" | "tape" | "minimal";
}

export interface SfxPlacement {
  id: string;
  soundId: string;
  /** Output-timeline seconds. */
  outAtSec: number;
  gain: number;
  /** Seconds into the sound file where playback starts (default 0). */
  trimStartSec?: number;
  /** Seconds into the sound file where playback stops (default: end of file). */
  trimEndSec?: number;
}

interface MusicChoice {
  trackId: string;
  /** Seconds into the track that line up with output 0. */
  trackOffsetSec: number;
  gain: number;
  /** Duck original audio under music (0..1). */
  originalGain: number;
}

export interface EditProject {
  angles: EditorAngle[];
  cuts: AngleCut[];
  trimInSec: number;
  trimOutSec: number;
  /** The landing moment. Speed ramp presets and auto-trim key off this. */
  landingSec: number | null;
  speed: SpeedKey[];
  look: LookId;
  /** 0..1 strength of the look. */
  lookStrength: number;
  color: ColorPresetId;
  overlays: TextOverlay[];
  music: MusicChoice | null;
  sfx: SfxPlacement[];
  stabilize: boolean;
  export: { resolution: ExportResolution; fps: ExportFps };
}
