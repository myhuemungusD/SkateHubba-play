import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MixSnapshot } from "../audioMix";
import { PITCH_JITTER, SFX_VOLUME } from "../tune";

/** A minimal Web Audio stand-in that records every node it hands out. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  sampleRate = 8000;
  state: "running" | "suspended" = "running";
  destination = { kind: "destination" };
  sources: Array<{
    buffer: unknown;
    loop: boolean;
    playbackRate: { value: number };
    connect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  }> = [];
  gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn> }> = [];
  buffers: Array<{ channels: number; length: number; rate: number; data?: Float32Array }> = [];
  resume = vi.fn(() => Promise.reject(new Error("blocked")));
  decodeAudioData = vi.fn(async (data: ArrayBuffer) => ({ decoded: data.byteLength }));

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createBufferSource() {
    const source = {
      buffer: null as unknown,
      loop: false,
      playbackRate: { value: 1 },
      connect: vi.fn(),
      start: vi.fn(),
    };
    this.sources.push(source);
    return source;
  }

  createGain() {
    const gain = { gain: { value: 1 }, connect: vi.fn() };
    this.gains.push(gain);
    return gain;
  }

  createBuffer(channels: number, length: number, rate: number) {
    const entry: { channels: number; length: number; rate: number; data?: Float32Array } = { channels, length, rate };
    this.buffers.push(entry);
    return {
      ...entry,
      copyToChannel: (data: Float32Array) => {
        entry.data = data;
      },
    };
  }
}

type Sfx = typeof import("../sfx");

const snap = (over: Partial<MixSnapshot> = {}): MixSnapshot => ({
  status: "playing",
  speed: 6,
  balance: 0,
  duck: -1,
  airborne: false,
  onGrind: false,
  grindTime: 0,
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;

async function loadSfx(ctor: unknown = FakeAudioContext): Promise<Sfx> {
  vi.resetModules();
  vi.stubGlobal("AudioContext", ctor);
  return import("../sfx");
}

async function loadedSfx(): Promise<{ sfx: Sfx; audio: FakeAudioContext }> {
  const sfx = await loadSfx();
  sfx.preloadRunnerSfx();
  await vi.waitFor(() => expect(lastAudio().decodeAudioData).toHaveBeenCalledTimes(3));
  await Promise.resolve();
  return { sfx, audio: lastAudio() };
}

const lastAudio = (): FakeAudioContext => {
  const audio = FakeAudioContext.instances.at(-1);
  if (!audio) throw new Error("no AudioContext was created");
  return audio;
};

beforeEach(() => {
  FakeAudioContext.instances = [];
  fetchMock = vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.resetModules();
});

describe("preloadRunnerSfx", () => {
  it("fetches and decodes the three one-shots once on a shared context", async () => {
    const { sfx, audio } = await loadedSfx();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Every decode gets its own copy of the bytes.
    expect(audio.decodeAudioData.mock.calls.every(([data]) => data.byteLength === 8)).toBe(true);

    sfx.preloadRunnerSfx();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses webkitAudioContext when the standard constructor is missing", async () => {
    vi.resetModules();
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", FakeAudioContext);
    const sfx = await import("../sfx");
    sfx.preloadRunnerSfx();
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it("forgets a failed load so the next call retries", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const sfx = await loadSfx();
    sfx.preloadRunnerSfx();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 0));

    sfx.preloadRunnerSfx();
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("stays silent when the browser has no Web Audio at all", async () => {
    vi.resetModules();
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    const sfx = await import("../sfx");
    sfx.preloadRunnerSfx();
    sfx.playRunnerSfx("pop");
    sfx.mixRunnerAudio(snap(), 1 / 60);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it("does nothing without a window (SSR)", async () => {
    vi.resetModules();
    vi.stubGlobal("window", undefined);
    const sfx = await import("../sfx");
    expect(() => {
      sfx.preloadRunnerSfx();
      sfx.mixRunnerAudio(snap(), 1 / 60);
    }).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("playRunnerSfx", () => {
  it("starts a preload instead of playing when the buffer is not ready", async () => {
    const sfx = await loadSfx();
    sfx.playRunnerSfx("pop");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(lastAudio().sources).toHaveLength(0);
  });

  it("plays pop, lock, powerslide and land through their buffers; bail is silent", async () => {
    const { sfx, audio } = await loadedSfx();
    sfx.playRunnerSfx("bail");
    expect(audio.sources).toHaveLength(0);

    sfx.playRunnerSfx("pop");
    sfx.playRunnerSfx("lock");
    sfx.playRunnerSfx("powerslide");
    sfx.playRunnerSfx("land");
    expect(audio.sources).toHaveLength(4);
    expect(audio.sources.every((s) => s.start.mock.calls.length === 1)).toBe(true);
    expect(audio.gains.map((g) => g.gain.value)).toEqual([SFX_VOLUME, SFX_VOLUME, SFX_VOLUME * 0.6, SFX_VOLUME]);
    // Grind keeps its pitch; pop and land wander within ±5%.
    expect(audio.sources[1]?.playbackRate.value).toBe(1);
    expect(audio.sources[2]?.playbackRate.value).toBe(1);
    for (const index of [0, 3]) {
      const rate = audio.sources[index]?.playbackRate.value ?? 0;
      expect(Math.abs(rate - 1)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it("wanders pop pitch across plays on a fixed, repeatable walk", async () => {
    const { sfx, audio } = await loadedSfx();
    for (let i = 0; i < 12; i += 1) sfx.playRunnerSfx("pop");
    // A fresh module walks the same ±5 jitter steps every time (no Math.random).
    const steps = [4, 3, -2, -2, -1, -3, -3, -1, 1, -5, 2, 1];
    const rates = audio.sources.map((s) => s.playbackRate.value);
    expect(rates).toHaveLength(steps.length);
    rates.forEach((rate, i) => expect(rate).toBeCloseTo(1 + steps[i] * (PITCH_JITTER / 5), 10));
  });

  it("tries to resume a suspended context and swallows a refusal", async () => {
    const { sfx, audio } = await loadedSfx();
    audio.state = "suspended";
    sfx.playRunnerSfx("land");
    expect(audio.resume).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(audio.sources).toHaveLength(1);
  });

  it("ignores an unknown event at runtime", async () => {
    const { sfx, audio } = await loadedSfx();
    sfx.playRunnerSfx("kickflip" as never);
    expect(audio.sources).toHaveLength(0);
  });
});

describe("mixRunnerAudio", () => {
  it("builds two looping noise beds once and chases their levels", async () => {
    const sfx = await loadSfx();
    sfx.mixRunnerAudio(snap(), 1 / 60);
    const audio = lastAudio();
    expect(audio.sources).toHaveLength(2);
    expect(audio.sources.every((s) => s.loop && s.start.mock.calls.length === 1)).toBe(true);
    // Two seconds of audio per loop, every sample finite and in range.
    for (const buffer of audio.buffers) {
      expect(buffer.length).toBe(audio.sampleRate * 2);
      expect(buffer.data?.every((v) => Number.isFinite(v) && Math.abs(v) <= 1)).toBe(true);
    }
    const [roll, grind] = audio.gains;
    const firstRoll = roll?.gain.value ?? 0;
    expect(firstRoll).toBeGreaterThan(0);
    expect(grind?.gain.value).toBe(0);

    sfx.mixRunnerAudio(snap(), 1 / 60);
    expect(audio.sources).toHaveLength(2);
    expect(roll?.gain.value).toBeGreaterThan(firstRoll);
  });

  it("treats a negative dt as no movement", async () => {
    const sfx = await loadSfx();
    sfx.mixRunnerAudio(snap(), -1);
    expect(lastAudio().gains.map((g) => g.gain.value)).toEqual([0, 0]);
  });

  it("plays a one-off metal tail only when a live grind ends", async () => {
    const sfx = await loadSfx();
    sfx.mixRunnerAudio(snap({ onGrind: true, grindTime: 0.5 }), 1 / 60);
    const audio = lastAudio();
    expect(audio.gains[1]?.gain.value).toBeGreaterThan(0);
    sfx.mixRunnerAudio(snap({ onGrind: true, grindTime: 0.6 }), 1 / 60);
    expect(audio.sources).toHaveLength(2);

    sfx.mixRunnerAudio(snap(), 1 / 60);
    expect(audio.sources).toHaveLength(3);
    expect(audio.gains[2]?.gain.value).toBeCloseTo(SFX_VOLUME * 0.55);
    const tail = audio.buffers[2];
    expect(tail?.length).toBe(Math.floor(audio.sampleRate * 0.09));
    expect(Math.abs(tail?.data?.[0] ?? 1)).toBe(0);

    // Leaving the grind by pausing is not a landing, so there is no tail.
    sfx.mixRunnerAudio(snap({ onGrind: true }), 1 / 60);
    sfx.mixRunnerAudio(snap({ onGrind: true, status: "paused" }), 1 / 60);
    expect(audio.sources).toHaveLength(3);
  });

  it("resumes a suspended context while mixing", async () => {
    const sfx = await loadSfx();
    sfx.mixRunnerAudio(snap(), 1 / 60);
    const audio = lastAudio();
    audio.state = "suspended";
    sfx.mixRunnerAudio(snap(), 1 / 60);
    expect(audio.resume).toHaveBeenCalledTimes(1);
  });
});
