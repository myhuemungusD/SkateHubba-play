import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChimeType } from "../sounds";

// Mock AudioContext
const mockStop = vi.fn();
const mockStart = vi.fn();
const mockConnect = vi.fn();
const mockSetValueAtTime = vi.fn();
const mockExponentialRampToValueAtTime = vi.fn();

const mockOscillator = {
  type: "sine" as OscillatorType,
  frequency: { setValueAtTime: mockSetValueAtTime },
  connect: mockConnect,
  start: mockStart,
  stop: mockStop,
};

const mockGainNode = {
  gain: {
    setValueAtTime: mockSetValueAtTime,
    exponentialRampToValueAtTime: mockExponentialRampToValueAtTime,
  },
  connect: mockConnect,
};

let mockCtxState = "running";
const mockResume = vi.fn().mockResolvedValue(undefined);
const mockCreateOscillator = vi.fn(() => mockOscillator);
const mockCreateGain = vi.fn(() => mockGainNode);

// connect returns the gain node so chaining works: osc.connect(g).connect(ac.destination)
mockConnect.mockReturnValue(mockGainNode);

class MockAudioContext {
  state = mockCtxState;
  currentTime = 0;
  destination = {};
  resume = mockResume;
  createOscillator = mockCreateOscillator;
  createGain = mockCreateGain;
}

(globalThis as unknown as Record<string, unknown>).AudioContext = MockAudioContext;

describe("sounds service", () => {
  let sounds: typeof import("../sounds");

  beforeEach(async () => {
    vi.resetModules();
    mockCtxState = "running";
    localStorage.clear();

    // Re-assign AudioContext before each import since resetModules clears module cache
    (globalThis as unknown as Record<string, unknown>).AudioContext = MockAudioContext;

    sounds = await import("../sounds");

    vi.clearAllMocks();
    // Restore connect mock return after clearAllMocks
    mockConnect.mockReturnValue(mockGainNode);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isSoundEnabled", () => {
    it("returns true by default (no localStorage entry)", () => {
      expect(sounds.isSoundEnabled()).toBe(true);
    });

    it('returns true when localStorage is "1"', () => {
      localStorage.setItem("skate_sound_enabled", "1");
      expect(sounds.isSoundEnabled()).toBe(true);
    });

    it('returns false when localStorage is "0"', () => {
      localStorage.setItem("skate_sound_enabled", "0");
      expect(sounds.isSoundEnabled()).toBe(false);
    });

    it("returns true when localStorage throws", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("access denied");
      });
      expect(sounds.isSoundEnabled()).toBe(true);
    });
  });

  describe("setSoundEnabled", () => {
    it("stores '1' when enabled", () => {
      sounds.setSoundEnabled(true);
      expect(localStorage.getItem("skate_sound_enabled")).toBe("1");
    });

    it("stores '0' when disabled", () => {
      sounds.setSoundEnabled(false);
      expect(localStorage.getItem("skate_sound_enabled")).toBe("0");
    });

    it("does not throw when localStorage throws", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota exceeded");
      });
      expect(() => sounds.setSoundEnabled(true)).not.toThrow();
    });
  });

  describe("playChime", () => {
    it("does nothing when sound is disabled", () => {
      sounds.setSoundEnabled(false);
      vi.clearAllMocks();
      mockConnect.mockReturnValue(mockGainNode);

      sounds.playChime("your_turn");
      expect(mockCreateOscillator).not.toHaveBeenCalled();
    });

    it("plays your_turn chime (2 pings)", () => {
      sounds.playChime("your_turn");
      expect(mockCreateOscillator).toHaveBeenCalledTimes(2);
      expect(mockStart).toHaveBeenCalledTimes(2);
      expect(mockStop).toHaveBeenCalledTimes(2);
    });

    it("plays new_challenge chime (2 pings)", () => {
      sounds.playChime("new_challenge");
      expect(mockCreateOscillator).toHaveBeenCalledTimes(2);
    });

    it("plays game_won chime (3 pings)", () => {
      sounds.playChime("game_won");
      expect(mockCreateOscillator).toHaveBeenCalledTimes(3);
    });

    it("plays game_lost chime (2 pings)", () => {
      sounds.playChime("game_lost");
      expect(mockCreateOscillator).toHaveBeenCalledTimes(2);
    });

    it("plays general chime (1 ping)", () => {
      sounds.playChime("general");
      expect(mockCreateOscillator).toHaveBeenCalledTimes(1);
    });

    it("does not throw when AudioContext throws", () => {
      mockCreateOscillator.mockImplementation(() => {
        throw new Error("AudioContext not available");
      });
      expect(() => sounds.playChime("general")).not.toThrow();
    });

    it.each<ChimeType>(["your_turn", "new_challenge", "game_won", "game_lost", "general"])(
      "plays %s chime without error",
      (type) => {
        expect(() => sounds.playChime(type)).not.toThrow();
      },
    );
  });

  describe("AudioContext state", () => {
    it("resumes suspended AudioContext", async () => {
      vi.resetModules();
      mockCtxState = "suspended";

      // Patch the class to use current mockCtxState
      class SuspendedAudioContext extends MockAudioContext {
        override state = "suspended" as string;
      }
      (globalThis as unknown as Record<string, unknown>).AudioContext = SuspendedAudioContext;

      const freshSounds = await import("../sounds");
      vi.clearAllMocks();
      mockConnect.mockReturnValue(mockGainNode);

      freshSounds.playChime("general");
      expect(mockResume).toHaveBeenCalled();
    });

    it("handles resume rejection gracefully", async () => {
      vi.resetModules();

      const rejectResume = vi.fn().mockRejectedValue(new Error("resume failed"));

      class RejectResumeAudioContext extends MockAudioContext {
        override state = "suspended" as string;
        override resume = rejectResume;
      }
      (globalThis as unknown as Record<string, unknown>).AudioContext = RejectResumeAudioContext;

      const freshSounds = await import("../sounds");
      vi.clearAllMocks();
      mockConnect.mockReturnValue(mockGainNode);

      // Should not throw even though resume rejects
      expect(() => freshSounds.playChime("general")).not.toThrow();
      expect(rejectResume).toHaveBeenCalled();
    });

    it("reuses existing AudioContext on subsequent calls", () => {
      sounds.playChime("general");
      const firstCallCount = mockCreateOscillator.mock.calls.length;

      sounds.playChime("general");
      // Should have created more oscillators but not a new context
      expect(mockCreateOscillator.mock.calls.length).toBe(firstCallCount + 1);
    });
  });
});
