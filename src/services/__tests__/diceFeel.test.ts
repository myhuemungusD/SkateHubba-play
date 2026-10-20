import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({ sound: true, haptics: true }));
vi.mock("../sounds", () => ({ isSoundEnabled: () => deps.sound, playChime: vi.fn() }));
vi.mock("../haptics", () => ({ isHapticsEnabled: () => deps.haptics, playHaptic: vi.fn() }));

import { playChime } from "../sounds";
import { playHaptic } from "../haptics";
import { __resetDiceAudioForTest, isQuickRolls, playDiceCue, setQuickRolls } from "../diceFeel";

function node() {
  const param = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  const n: Record<string, unknown> = {
    connect: vi.fn(() => n),
    start: vi.fn(),
    stop: vi.fn(),
    frequency: param,
    Q: param,
    gain: param,
    buffer: null,
    type: "",
  };
  return n;
}

class FakeAudio {
  static made = 0;
  state = "suspended";
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  resume = vi.fn(() => Promise.reject(new Error("no")));
  constructor() {
    FakeAudio.made += 1;
  }
  createBuffer = vi.fn((_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) }));
  createBufferSource = vi.fn(node);
  createBiquadFilter = vi.fn(node);
  createGain = vi.fn(node);
  createOscillator = vi.fn(node);
}

describe("quick rolls", () => {
  afterEach(() => localStorage.clear());

  it("defaults off and persists the toggle", () => {
    expect(isQuickRolls()).toBe(false);
    setQuickRolls(true);
    expect(isQuickRolls()).toBe(true);
    setQuickRolls(false);
    expect(isQuickRolls()).toBe(false);
  });

  it("survives storage that throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(isQuickRolls()).toBe(false);
    expect(() => setQuickRolls(true)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe("playDiceCue", () => {
  beforeEach(() => {
    deps.sound = true;
    deps.haptics = true;
    FakeAudio.made = 0;
    __resetDiceAudioForTest();
    vi.stubGlobal("AudioContext", FakeAudio);
    vi.mocked(playChime).mockClear();
    vi.mocked(playHaptic).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("synthesizes every clack cue on one shared context", () => {
    for (const cue of ["throw", "land", "settle", "big", "bail"] as const) playDiceCue(cue);
    expect(FakeAudio.made).toBe(1);
    expect(playChime).not.toHaveBeenCalled();
  });

  it("does not resume a context that is already running", () => {
    class Running extends FakeAudio {
      state = "running";
    }
    vi.stubGlobal("AudioContext", Running);
    playDiceCue("land");
    playDiceCue("land");
    expect(FakeAudio.made).toBe(1);
  });

  it("uses the app chimes for results and turns", () => {
    playDiceCue("win");
    playDiceCue("loss");
    playDiceCue("turn");
    expect(playChime).toHaveBeenCalledWith("game_won");
    expect(playChime).toHaveBeenCalledWith("game_lost");
    expect(playChime).toHaveBeenCalledWith("your_turn");
  });

  it("maps haptics and keeps landing silent", () => {
    deps.sound = false;
    const map: Array<[Parameters<typeof playDiceCue>[0], string | null]> = [
      ["throw", "toast"],
      ["settle", "button_primary"],
      ["big", "game_won"],
      ["win", "game_won"],
      ["bail", "game_lost"],
      ["loss", "game_lost"],
      ["turn", "your_turn"],
      ["land", null],
    ];
    for (const [cue, kind] of map) {
      vi.mocked(playHaptic).mockClear();
      playDiceCue(cue);
      if (kind) expect(playHaptic).toHaveBeenCalledWith(kind);
      else expect(playHaptic).not.toHaveBeenCalled();
    }
    expect(FakeAudio.made).toBe(0);
  });

  it("stays quiet with both toggles off, and without Web Audio", () => {
    deps.haptics = false;
    playDiceCue("big");
    expect(playHaptic).not.toHaveBeenCalled();
    vi.stubGlobal("AudioContext", undefined);
    deps.sound = true;
    expect(() => playDiceCue("land")).not.toThrow();
  });

  it("never throws when audio blows up", () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("no audio");
        }
      },
    );
    expect(() => playDiceCue("throw")).not.toThrow();
  });
});
