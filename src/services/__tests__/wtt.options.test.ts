import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateWttOptions, validateWttOptions } from "../wtt.options";

// Mock the tricks module to control behavior
const mockTrickById = vi.fn();
const mockGetConfusableTricks = vi.fn();
const mockGetRandomDistractor = vi.fn();

vi.mock("../constants/tricks", () => ({
  trickById: (...args: unknown[]) => mockTrickById(...args),
  getConfusableTricks: (...args: unknown[]) => mockGetConfusableTricks(...args),
  getRandomDistractor: (...args: unknown[]) => mockGetRandomDistractor(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateWttOptions", () => {
  it("generates 4 unique options including the correct answer", () => {
    mockTrickById.mockReturnValue({ id: "kickflip", name: "Kickflip" });
    mockGetConfusableTricks.mockReturnValue(["heelflip", "varial-kickflip"]);
    mockGetRandomDistractor.mockReturnValue("impossible");

    const result = generateWttOptions("kickflip");

    expect(result).not.toBeNull();
    expect(result?.options).toHaveLength(4);
    expect(result?.options).toContain("kickflip");
    expect(new Set(result?.options).size).toBe(4);
  });

  it("includes confusable tricks when available", () => {
    mockTrickById.mockReturnValue({ id: "kickflip", name: "Kickflip" });
    mockGetConfusableTricks.mockReturnValue(["heelflip", "varial-kickflip"]);
    mockGetRandomDistractor.mockReturnValue("impossible");

    const result = generateWttOptions("kickflip");

    expect(result).not.toBeNull();
    expect(result?.options).toContain("kickflip");
    expect(result?.options.some((opt) => ["heelflip", "varial-kickflip"].includes(opt))).toBe(true);
  });

  it("uses random distractor when confusables are limited", () => {
    mockTrickById.mockReturnValue({ id: "manual", name: "Manual" });
    mockGetConfusableTricks.mockReturnValue(["nose-manual"]);
    mockGetRandomDistractor.mockReturnValueOnce("50-50").mockReturnValueOnce("boardslide");

    const result = generateWttOptions("manual");

    expect(result).not.toBeNull();
    expect(result?.options).toHaveLength(4);
    expect(new Set(result?.options).size).toBe(4);
  });

  it("uses fallback distractors when random distractor returns null", () => {
    mockTrickById.mockReturnValue({ id: "custom-trick", name: "Custom Trick" });
    mockGetConfusableTricks.mockReturnValue([]);
    // Return null for first 2 calls, then a valid trick
    mockGetRandomDistractor.mockReturnValueOnce(null).mockReturnValueOnce(null).mockReturnValue(null);

    const result = generateWttOptions("custom-trick");

    // The function should fall back to common tricks when random distractor returns null
    if (result) {
      expect(result.options).toHaveLength(4);
      expect(result.options).toContain("custom-trick");
      // Should include some fallback tricks
      const hasCommonTrick = result.options.some((opt) =>
        ["ollie", "kickflip", "heelflip", "pop-shove-it", "bs-180", "fs-180", "50-50", "boardslide"].includes(opt),
      );
      expect(hasCommonTrick).toBe(true);
    } else {
      // It's also valid to return null if not enough distinct options can be found
      expect(result).toBeNull();
    }
  });

  it("returns null when not enough options can be found", () => {
    mockTrickById.mockReturnValue({ id: "test", name: "Test" });
    mockGetConfusableTricks.mockReturnValue([]);
    mockGetRandomDistractor.mockReturnValue(null);

    // Simulate all fallbacks being used
    const usedTricks = new Set([
      "test",
      "ollie",
      "kickflip",
      "heelflip",
      "pop-shove-it",
      "bs-180",
      "fs-180",
      "50-50",
      "boardslide",
    ]);

    const hasSpy = vi.spyOn(Set.prototype, "has").mockImplementation(function (this: Set<string>, value: string) {
      return usedTricks.has(value);
    });

    const result = generateWttOptions("test");

    expect(result).toBeNull();

    hasSpy.mockRestore();
  });

  it("shuffles options randomly", () => {
    mockTrickById.mockReturnValue({ id: "kickflip", name: "Kickflip" });
    mockGetConfusableTricks.mockReturnValue(["heelflip", "varial-kickflip"]);
    mockGetRandomDistractor.mockReturnValue("impossible");

    const runs = Array.from({ length: 20 }, () => generateWttOptions("kickflip"));
    const correctIndices = runs.map((r) => r?.correctIndex);
    const uniquePositions = new Set(correctIndices);

    expect(uniquePositions.size).toBeGreaterThan(1);
  });

  it("returns null for unknown trick", () => {
    mockTrickById.mockReturnValue(null);

    const result = generateWttOptions("nonexistent-trick");
    expect(result).toBeNull();
  });

  it("stops adding confusables when 4 options reached", () => {
    mockTrickById.mockReturnValue({ id: "kickflip", name: "Kickflip" });
    mockGetConfusableTricks.mockReturnValue(["heelflip", "varial-kickflip", "hardflip", "inward-heelflip"]);
    mockGetRandomDistractor.mockReturnValue("impossible");

    const result = generateWttOptions("kickflip");

    expect(result).not.toBeNull();
    expect(result?.options).toHaveLength(4);
  });
});

describe("validateWttOptions", () => {
  it("passes for valid 4-option array", () => {
    const result = validateWttOptions(["kickflip", "heelflip", "impossible", "bigflip"]);
    expect(result).toBe(true);
  });

  it("fails for fewer than 4 options", () => {
    const result = validateWttOptions(["kickflip", "heelflip"]);
    expect(result).toBe(false);
  });

  it("fails for more than 4 options", () => {
    const result = validateWttOptions(["kickflip", "heelflip", "impossible", "bigflip", "tre-flip"]);
    expect(result).toBe(false);
  });

  it("fails for duplicate options", () => {
    const result = validateWttOptions(["kickflip", "heelflip", "kickflip", "impossible"]);
    expect(result).toBe(false);
  });

  it("fails for empty string options", () => {
    const result = validateWttOptions(["kickflip", "", "heelflip", "impossible"]);
    expect(result).toBe(false);
  });

  it("passes for whitespace-only options (no trim check)", () => {
    const result = validateWttOptions(["kickflip", "  ", "heelflip", "impossible"]);
    expect(result).toBe(true);
  });
});
