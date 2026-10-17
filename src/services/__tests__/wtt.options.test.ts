import { describe, it, expect } from "vitest";
import { generateWttOptions, validateWttOptions } from "../wtt.options";

describe("generateWttOptions", () => {
  it("generates 4 distinct options for a valid trick", () => {
    const result = generateWttOptions("kickflip");
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(4);

    const uniqueIds = new Set(result!.options);
    expect(uniqueIds.size).toBe(4);
  });

  it("includes the correct answer in the options", () => {
    const result = generateWttOptions("kickflip");
    expect(result).not.toBeNull();
    expect(result!.options).toContain("kickflip");
  });

  it("includes confusable tricks when available", () => {
    const result = generateWttOptions("kickflip");
    expect(result).not.toBeNull();

    // kickflip's confusables include heelflip, varial-kickflip, hardflip, inward-heelflip
    const confusables = ["heelflip", "varial-kickflip", "hardflip", "inward-heelflip"];
    const hasConfusable = result!.options.some((opt) => confusables.includes(opt));
    expect(hasConfusable).toBe(true);
  });

  it("returns null for invalid trick ID", () => {
    const result = generateWttOptions("nonexistent-trick");
    expect(result).toBeNull();
  });

  it("shuffles options so correct answer position varies", () => {
    const positions = new Set<number>();

    // Generate 20 quizzes and check correct answer positions
    for (let i = 0; i < 20; i++) {
      const result = generateWttOptions("kickflip");
      if (result) {
        positions.add(result.correctIndex);
      }
    }

    // Should have at least 2 different positions (ideally 3-4)
    expect(positions.size).toBeGreaterThanOrEqual(2);
  });

  it("maintains correct answer at correctIndex after shuffle", () => {
    const result = generateWttOptions("kickflip");
    expect(result).not.toBeNull();

    const actualCorrect = result!.options[result!.correctIndex];
    expect(actualCorrect).toBe("kickflip");
  });

  it("works for tricks with few confusables", () => {
    const result = generateWttOptions("ollie");
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(4);
    expect(result!.options).toContain("ollie");
  });

  it("works for tricks from different categories", () => {
    const categories = ["kickflip", "pop-shove-it", "bs-180", "50-50", "boardslide", "manual", "indy"];

    for (const trickId of categories) {
      const result = generateWttOptions(trickId);
      expect(result).not.toBeNull();
      expect(result!.options).toHaveLength(4);
      expect(result!.options).toContain(trickId);
    }
  });
});

describe("validateWttOptions", () => {
  it("validates correct 4-option array", () => {
    const options = ["kickflip", "heelflip", "varial-kickflip", "hardflip"];
    expect(validateWttOptions(options)).toBe(true);
  });

  it("rejects array with wrong length", () => {
    expect(validateWttOptions(["kickflip", "heelflip"])).toBe(false);
    expect(validateWttOptions(["kickflip", "heelflip", "varial-kickflip", "hardflip", "ollie"])).toBe(false);
  });

  it("rejects array with duplicate IDs", () => {
    const options = ["kickflip", "heelflip", "kickflip", "hardflip"];
    expect(validateWttOptions(options)).toBe(false);
  });

  it("rejects array with empty strings", () => {
    const options = ["kickflip", "", "varial-kickflip", "hardflip"];
    expect(validateWttOptions(options)).toBe(false);
  });

  it("rejects empty array", () => {
    expect(validateWttOptions([])).toBe(false);
  });
});
