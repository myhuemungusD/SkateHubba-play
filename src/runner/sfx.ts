import grindUrl from "./assets/sfx/grind.wav?url";
import landUrl from "./assets/sfx/land.wav?url";
import popUrl from "./assets/sfx/pop.wav?url";
import { mixLevels, type MixSnapshot } from "./audioMix";
import { MIX_RESPONSE, PITCH_JITTER, SFX_VOLUME } from "./tune";
import type { RunnerEvent } from "./types";

const FILES = {
  pop: popUrl,
  grind: grindUrl,
  land: landUrl,
} as const;

type SoundName = keyof typeof FILES;
type LoopName = "roll" | "grind";

const buffers = new Map<SoundName, AudioBuffer>();
let ctx: AudioContext | null = null;
let loading: Promise<void> | null = null;
let pitchSalt = 1;
let loops: Record<LoopName, { source: AudioBufferSourceNode; gain: GainNode }> | null = null;
let shown = { rollGain: 0, grindGain: 0, rollRate: 1, grindRate: 1 };

/** Pop and land wander by ±5%. Grind stays put so the rail reads as one sound. */
function playbackRate(name: SoundName): number {
  if (name === "grind") return 1;
  pitchSalt = (pitchSalt * 17 + 3) % 97;
  const steps = (pitchSalt % 11) - 5;
  return 1 + steps * (PITCH_JITTER / 5);
}

function soundFor(event: RunnerEvent): SoundName | null {
  switch (event) {
    case "pop":
      return "pop";
    case "lock":
    case "powerslide":
      return "grind";
    case "land":
      return "land";
    case "bail":
      return null;
    default: {
      const neverEvent: never = event;
      return neverEvent;
    }
  }
}

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const host = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? host.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

function FILES_COUNT(): number {
  return 3;
}

/**
 * A seamless loop of filtered noise. The head overlaps the tail so the
 * loop point is a continuation of the same rumble, not a click.
 */
function synthLoop(audio: AudioContext, kind: LoopName): AudioBuffer {
  const rate = audio.sampleRate;
  const seconds = 2;
  const count = Math.floor(rate * seconds);
  const fade = Math.floor(rate * 0.05);
  const raw = new Float32Array(count + fade);
  let noise = kind === "roll" ? 17 : 91;
  let low = 0;
  const cutoff = kind === "roll" ? 0.04 : 0.2;
  const tone = kind === "roll" ? 78 : 640;
  for (let i = 0; i < raw.length; i += 1) {
    noise = (noise * 16807 + 11) % 2147483647;
    const white = (noise / 2147483647) * 2 - 1;
    low += cutoff * (white - low);
    const ring = Math.sin((2 * Math.PI * tone * i) / rate);
    raw[i] = low * (kind === "roll" ? 0.7 : 0.45) + ring * (kind === "roll" ? 0.03 : 0.12);
  }
  const data = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    if (i < fade) {
      const weight = i / fade;
      data[i] = (raw[i] ?? 0) * weight + (raw[count + i] ?? 0) * (1 - weight);
    } else {
      data[i] = raw[i] ?? 0;
    }
  }
  const buffer = audio.createBuffer(1, count, rate);
  buffer.copyToChannel(data, 0);
  return buffer;
}

function ensureLoops(audio: AudioContext): void {
  if (loops) return;
  const make = (kind: LoopName): { source: AudioBufferSourceNode; gain: GainNode } => {
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    source.buffer = synthLoop(audio, kind);
    source.loop = true;
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(audio.destination);
    source.start();
    return { source, gain };
  };
  loops = { roll: make("roll"), grind: make("grind") };
}

/** Decode the one-shots. Safe to call more than once. Missing Web Audio is a no-op. */
export function preloadRunnerSfx(): void {
  if (loading || buffers.size === FILES_COUNT()) return;
  const audio = context();
  if (!audio) return;
  loading = (async () => {
    const names = Object.keys(FILES) as SoundName[];
    await Promise.all(
      names.map(async (name) => {
        const response = await fetch(FILES[name]);
        const data = await response.arrayBuffer();
        const copy = data.slice(0);
        buffers.set(name, await audio.decodeAudioData(copy));
      }),
    );
  })().catch(() => {
    loading = null;
  });
}

export function playRunnerSfx(event: RunnerEvent): void {
  const name = soundFor(event);
  if (!name) return;
  const audio = context();
  const buffer = buffers.get(name);
  if (!audio || !buffer) {
    preloadRunnerSfx();
    return;
  }
  if (audio.state === "suspended") void audio.resume().catch(() => undefined);
  const source = audio.createBufferSource();
  const gain = audio.createGain();
  source.buffer = buffer;
  source.playbackRate.value = playbackRate(name);
  gain.gain.value = event === "powerslide" ? SFX_VOLUME * 0.6 : SFX_VOLUME;
  source.connect(gain);
  gain.connect(audio.destination);
  source.start();
}

/**
 * Chase the roll and grind loops toward this frame. Pop and land stay
 * one-shots from `playRunnerSfx`. No AudioContext means silence.
 */
export function mixRunnerAudio(snapshot: MixSnapshot, dt: number): void {
  const audio = context();
  if (!audio) return;
  ensureLoops(audio);
  if (!loops) return;
  if (audio.state === "suspended") void audio.resume().catch(() => undefined);
  const target = mixLevels(snapshot);
  const step = 1 - Math.exp(-Math.max(0, dt) * MIX_RESPONSE);
  shown = {
    rollGain: shown.rollGain + (target.rollGain - shown.rollGain) * step,
    grindGain: shown.grindGain + (target.grindGain - shown.grindGain) * step,
    rollRate: shown.rollRate + (target.rollRate - shown.rollRate) * step,
    grindRate: shown.grindRate + (target.grindRate - shown.grindRate) * step,
  };
  loops.roll.gain.gain.value = shown.rollGain;
  loops.grind.gain.gain.value = shown.grindGain;
  loops.roll.source.playbackRate.value = shown.rollRate;
  loops.grind.source.playbackRate.value = shown.grindRate;
}
