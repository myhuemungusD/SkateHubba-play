import { MAX_FRAME_DT } from "./constants";

/** True when this browser can paint the street. The sim still runs when it cannot. */
export function canUseWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    return gl != null;
  } catch {
    return false;
  }
}

export interface FpsBucket {
  frames: number;
  stamp: number;
}

/** Write a frames-per-second readout at most twice a second. `now` is milliseconds. */
export function noteFps(el: HTMLElement | null, bucket: FpsBucket, now: number): void {
  if (bucket.stamp === 0) bucket.stamp = now;
  bucket.frames += 1;
  const elapsed = now - bucket.stamp;
  if (elapsed < 500) return;
  if (el) el.textContent = String(Math.round((bucket.frames * 1000) / elapsed));
  bucket.frames = 0;
  bucket.stamp = now;
}

export function frameDelta(now: number, last: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(last)) return 0;
  const dt = (now - last) / 1000;
  if (dt <= 0) return 0;
  return Math.min(MAX_FRAME_DT, dt);
}
