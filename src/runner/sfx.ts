import grindUrl from "./assets/sfx/grind.wav?url";
import landUrl from "./assets/sfx/land.wav?url";
import popUrl from "./assets/sfx/pop.wav?url";
import { SFX_VOLUME } from "./tune";
import type { RunnerEvent } from "./types";

const FILES = {
  pop: popUrl,
  grind: grindUrl,
  land: landUrl,
} as const;

type SoundName = keyof typeof FILES;

const buffers = new Map<SoundName, AudioBuffer>();
let ctx: AudioContext | null = null;
let loading: Promise<void> | null = null;

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

function FILES_COUNT(): number {
  return 3;
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
  gain.gain.value = event === "powerslide" ? SFX_VOLUME * 0.6 : SFX_VOLUME;
  source.connect(gain);
  gain.connect(audio.destination);
  source.start();
}
