import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── Helpers ──────────────────────────────── */

function makeMockOscillator() {
  return {
    type: "sine",
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn().mockReturnValue({ connect: vi.fn() }),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

function makeMockGainNode() {
  return {
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
}

function installAudioContext(state = "running", resume = vi.fn().mockResolvedValue(undefined)) {
  const ctor = vi.fn(function AudioContext() {
    return {
      state,
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn().mockImplementation(makeMockOscillator),
      createGain: vi.fn().mockImplementation(makeMockGainNode),
      resume,
    };
  });
  (globalThis as Record<string, unknown>).AudioContext = ctor;
  return { ctor, resume };
}

async function freshSounds() {
  return import("../sounds");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  localStorage.clear();
  installAudioContext();
});

afterEach(() => {
  localStorage.clear();
});

describe("sounds service", () => {
  describe("isSoundEnabled", () => {
    it("returns true by default (no stored value)", async () => {
      const { isSoundEnabled } = await freshSounds();
      expect(isSoundEnabled()).toBe(true);
    });

    it("returns true when stored value is '1'", async () => {
      localStorage.setItem("skate_sound_enabled", "1");
      const { isSoundEnabled } = await freshSounds();
      expect(isSoundEnabled()).toBe(true);
    });

    it("returns false when stored value is '0'", async () => {
      localStorage.setItem("skate_sound_enabled", "0");
      const { isSoundEnabled } = await freshSounds();
      expect(isSoundEnabled()).toBe(false);
    });

    it("returns true when localStorage throws", async () => {
      const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });
      const { isSoundEnabled } = await freshSounds();
      expect(isSoundEnabled()).toBe(true);
      spy.mockRestore();
    });
  });

  describe("setSoundEnabled", () => {
    it("stores '1' when enabled", async () => {
      const { setSoundEnabled } = await freshSounds();
      setSoundEnabled(true);
      expect(localStorage.getItem("skate_sound_enabled")).toBe("1");
    });

    it("stores '0' when disabled", async () => {
      const { setSoundEnabled } = await freshSounds();
      setSoundEnabled(false);
      expect(localStorage.getItem("skate_sound_enabled")).toBe("0");
    });

    it("silently handles localStorage errors", async () => {
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceeded");
      });
      const { setSoundEnabled } = await freshSounds();
      expect(() => setSoundEnabled(true)).not.toThrow();
      spy.mockRestore();
    });
  });

  describe("playChime", () => {
    it("plays your_turn chime", async () => {
      const { playChime } = await freshSounds();
      expect(() => playChime("your_turn")).not.toThrow();
    });

    it("plays new_challenge chime", async () => {
      const { playChime } = await freshSounds();
      expect(() => playChime("new_challenge")).not.toThrow();
    });

    it("plays game_won chime", async () => {
      const { playChime } = await freshSounds();
      expect(() => playChime("game_won")).not.toThrow();
    });

    it("plays game_lost chime", async () => {
      const { playChime } = await freshSounds();
      expect(() => playChime("game_lost")).not.toThrow();
    });

    it("plays nudge chime", async () => {
      const { playChime } = await freshSounds();
      expect(() => playChime("nudge")).not.toThrow();
    });

    it("plays general chime", async () => {
      const { playChime } = await freshSounds();
      expect(() => playChime("general")).not.toThrow();
    });

    it("does not play when sound is disabled", async () => {
      localStorage.setItem("skate_sound_enabled", "0");
      const { ctor } = installAudioContext();
      const { playChime } = await freshSounds();
      playChime("your_turn");
      expect(ctor).not.toHaveBeenCalled();
    });

    it("resumes suspended AudioContext", async () => {
      const resume = vi.fn().mockResolvedValue(undefined);
      installAudioContext("suspended", resume);
      const { playChime } = await freshSounds();
      playChime("general");
      expect(resume).toHaveBeenCalled();
    });

    it("handles resume rejection silently", async () => {
      const resume = vi.fn().mockRejectedValue(new Error("Not allowed"));
      installAudioContext("suspended", resume);
      const { playChime } = await freshSounds();
      expect(() => playChime("general")).not.toThrow();
    });

    it("catches AudioContext creation errors silently", async () => {
      (globalThis as Record<string, unknown>).AudioContext = vi.fn(function AudioContext() {
        throw new Error("AudioContext not supported");
      });
      const { playChime } = await freshSounds();
      expect(() => playChime("general")).not.toThrow();
    });

    it("reuses existing AudioContext on subsequent calls", async () => {
      const { ctor } = installAudioContext();
      const { playChime } = await freshSounds();
      playChime("general");
      playChime("your_turn");
      expect(ctor).toHaveBeenCalledTimes(1);
    });
  });
});
