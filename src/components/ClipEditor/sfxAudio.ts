/** AAC everywhere it plays; Ogg only where the browser can't do AAC. */
export function pickSfxSrc(s: { src: string; oggSrc?: string }): string {
  if (!s.oggSrc || typeof document === "undefined") return s.src;
  const probe = document.createElement("audio");
  return typeof probe.canPlayType === "function" && probe.canPlayType("audio/mp4") === "" ? s.oggSrc : s.src;
}

const peakCache = new Map<string, number[]>();

/** Peak amplitudes (0..1) in `bins` buckets for a sound file; null when it can't be decoded. */
export async function loadPeaks(src: string, bins = 64): Promise<number[] | null> {
  const key = `${src}#${bins}`;
  const hit = peakCache.get(key);
  if (hit) return hit;
  const Ctx =
    typeof window === "undefined" ? undefined : (window.OfflineAudioContext as typeof OfflineAudioContext | undefined);
  if (!Ctx || typeof fetch !== "function") return null;
  try {
    const bytes = await (await fetch(src)).arrayBuffer();
    const buf = await new Ctx(1, 1, 44100).decodeAudioData(bytes);
    const peaks = peaksOf(buf.getChannelData(0), bins);
    peakCache.set(key, peaks);
    return peaks;
  } catch {
    return null;
  }
}

/** Max |sample| per bucket, normalized so the loudest bucket is 1. */
export function peaksOf(data: Float32Array, bins: number): number[] {
  const out = new Array<number>(bins).fill(0);
  const per = Math.max(1, Math.floor(data.length / bins));
  for (let i = 0; i < bins; i++) {
    let m = 0;
    for (let j = i * per; j < Math.min(data.length, (i + 1) * per); j++) m = Math.max(m, Math.abs(data[j]));
    out[i] = m;
  }
  const top = Math.max(...out, 1e-9);
  return out.map((v) => v / top);
}
