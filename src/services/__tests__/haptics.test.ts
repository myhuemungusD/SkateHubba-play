import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── Mocks ──────────────────────────────────── */

const { mockImpact, mockNotification } = vi.hoisted(() => ({
  mockImpact: vi.fn().mockResolvedValue(undefined),
  mockNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@capacitor/haptics", () => ({
  Haptics: {
    impact: mockImpact,
    notification: mockNotification,
  },
  ImpactStyle: {
    Heavy: "HEAVY",
    Medium: "MEDIUM",
    Light: "LIGHT",
  },
  NotificationType: {
    Success: "SUCCESS",
    Warning: "WARNING",
    Error: "ERROR",
  },
}));

async function freshHaptics() {
  return import("../haptics");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  localStorage.clear();
  mockImpact.mockResolvedValue(undefined);
  mockNotification.mockResolvedValue(undefined);
});

afterEach(() => {
  localStorage.clear();
});

/* ── Tests ──────────────────────────────────── */

describe("haptics service", () => {
  describe("isHapticsEnabled", () => {
    it("returns true by default (no stored value)", async () => {
      const { isHapticsEnabled } = await freshHaptics();
      expect(isHapticsEnabled()).toBe(true);
    });

    it("returns true when stored value is '1'", async () => {
      localStorage.setItem("skate_haptics_enabled", "1");
      const { isHapticsEnabled } = await freshHaptics();
      expect(isHapticsEnabled()).toBe(true);
    });

    it("returns false when stored value is '0'", async () => {
      localStorage.setItem("skate_haptics_enabled", "0");
      const { isHapticsEnabled } = await freshHaptics();
      expect(isHapticsEnabled()).toBe(false);
    });

    it("returns true when localStorage throws", async () => {
      const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });
      const { isHapticsEnabled } = await freshHaptics();
      expect(isHapticsEnabled()).toBe(true);
      spy.mockRestore();
    });
  });

  describe("setHapticsEnabled", () => {
    it("stores '1' when enabled", async () => {
      const { setHapticsEnabled } = await freshHaptics();
      setHapticsEnabled(true);
      expect(localStorage.getItem("skate_haptics_enabled")).toBe("1");
    });

    it("stores '0' when disabled", async () => {
      const { setHapticsEnabled } = await freshHaptics();
      setHapticsEnabled(false);
      expect(localStorage.getItem("skate_haptics_enabled")).toBe("0");
    });

    it("silently handles localStorage errors", async () => {
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceeded");
      });
      const { setHapticsEnabled } = await freshHaptics();
      expect(() => setHapticsEnabled(true)).not.toThrow();
      spy.mockRestore();
    });
  });

  describe("playHaptic", () => {
    it("fires success notification for trick_landed", async () => {
      const { playHaptic } = await freshHaptics();
      playHaptic("trick_landed");
      expect(mockNotification).toHaveBeenCalledWith({ type: "SUCCESS" });
    });

    it("fires success notification for game_won", async () => {
      const { playHaptic } = await freshHaptics();
      playHaptic("game_won");
      expect(mockNotification).toHaveBeenCalledWith({ type: "SUCCESS" });
    });

    it("fires error notification for trick_missed", async () => {
      const { playHaptic } = await freshHaptics();
      playHaptic("trick_missed");
      expect(mockNotification).toHaveBeenCalledWith({ type: "ERROR" });
    });

    it("fires error notification for game_lost", async () => {
      const { playHaptic } = await freshHaptics();
      playHaptic("game_lost");
      expect(mockNotification).toHaveBeenCalledWith({ type: "ERROR" });
    });

    it("fires warning notification for nudge", async () => {
      const { playHaptic } = await freshHaptics();
      playHaptic("nudge");
      expect(mockNotification).toHaveBeenCalledWith({ type: "WARNING" });
    });

    it("fires heavy impact for new_challenge", async () => {
      const { playHaptic } = await freshHaptics();
      playHaptic("new_challenge");
      expect(mockImpact).toHaveBeenCalledWith({ style: "HEAVY" });
    });

    it("fires medium impact for your_turn", async () => {
      const { playHaptic } = await freshHaptics();
      playHaptic("your_turn");
      expect(mockImpact).toHaveBeenCalledWith({ style: "MEDIUM" });
    });

    it("fires medium impact for button_primary", async () => {
      const { playHaptic } = await freshHaptics();
      playHaptic("button_primary");
      expect(mockImpact).toHaveBeenCalledWith({ style: "MEDIUM" });
    });

    it("fires light impact for toast", async () => {
      const { playHaptic } = await freshHaptics();
      playHaptic("toast");
      expect(mockImpact).toHaveBeenCalledWith({ style: "LIGHT" });
    });

    it("does not fire when haptics are disabled", async () => {
      localStorage.setItem("skate_haptics_enabled", "0");
      const { playHaptic } = await freshHaptics();
      playHaptic("button_primary");
      expect(mockImpact).not.toHaveBeenCalled();
      expect(mockNotification).not.toHaveBeenCalled();
    });

    it("swallows async rejections (platform unavailable)", async () => {
      mockImpact.mockRejectedValueOnce(new Error("Browser does not support the vibrate API"));
      const { playHaptic } = await freshHaptics();
      expect(() => playHaptic("button_primary")).not.toThrow();
    });

    it("swallows synchronous throws from the Haptics plugin", async () => {
      mockImpact.mockImplementationOnce(() => {
        throw new Error("Plugin not loaded");
      });
      const { playHaptic } = await freshHaptics();
      expect(() => playHaptic("button_primary")).not.toThrow();
    });
  });

  describe("hapticForVariant", () => {
    it("maps primary to button_primary", async () => {
      const { hapticForVariant } = await freshHaptics();
      expect(hapticForVariant("primary")).toBe("button_primary");
    });

    it("maps success to button_primary", async () => {
      const { hapticForVariant } = await freshHaptics();
      expect(hapticForVariant("success")).toBe("button_primary");
    });

    it("maps danger to button_primary", async () => {
      const { hapticForVariant } = await freshHaptics();
      expect(hapticForVariant("danger")).toBe("button_primary");
    });

    it("maps secondary to toast", async () => {
      const { hapticForVariant } = await freshHaptics();
      expect(hapticForVariant("secondary")).toBe("toast");
    });

    it("maps ghost to toast", async () => {
      const { hapticForVariant } = await freshHaptics();
      expect(hapticForVariant("ghost")).toBe("toast");
    });

    it("falls back to primary mapping for null variant", async () => {
      const { hapticForVariant } = await freshHaptics();
      expect(hapticForVariant(null)).toBe("button_primary");
    });

    it("falls back to primary mapping for undefined variant", async () => {
      const { hapticForVariant } = await freshHaptics();
      expect(hapticForVariant(undefined)).toBe("button_primary");
    });

    it("falls back to toast for an unknown variant string", async () => {
      const { hapticForVariant } = await freshHaptics();
      // Simulate a legacy/stray variant that escaped the type system —
      // the runtime guard keeps the tap from silencing entirely.
      expect(hapticForVariant("bogus" as unknown as "primary")).toBe("toast");
    });
  });
});
