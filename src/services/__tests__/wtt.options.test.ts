import { describe, it, expect } from "vitest";
import { generateWttOptions, validateWttOptions } from "../wtt.options";

describe("generateWttOptions", () => {
  it("generates 4 unique options including the correct answer", () => {
    const result = generateWttOptions("kickflip");

    expect(result).not.toBeNull();
    expect(result?.options).toHaveLength(4);
    expect(result?.options).toContain("kickflip");
    expect(new Set(result?.options).size).toBe(4);
  });

  it("includes confusable tricks when available", () => {
    const result = generateWttOptions("kickflip");

    expect(result).not.toBeNull();
    expect(result?.options).toContain("kickflip");
    // Kickflip has confusable tricks like heelflip, varial-kickflip, etc
    expect(result?.options.length).toBe(4);
  });

  it("generates options for tricks with limited confusables", () => {
    const result = generateWttOptions("manual");

    expect(result).not.toBeNull();
    expect(result?.options).toHaveLength(4);
    expect(result?.options).toContain("manual");
    expect(new Set(result?.options).size).toBe(4);
  });

  it("generates options for grabs with different distractors", () => {
    const result = generateWttOptions("indy");

    expect(result).not.toBeNull();
    expect(result?.options).toHaveLength(4);
    expect(result?.options).toContain("indy");
    expect(new Set(result?.options).size).toBe(4);
  });

  it("generates options for grinds", () => {
    const result = generateWttOptions("50-50");

    expect(result).not.toBeNull();
    expect(result?.options).toHaveLength(4);
    expect(result?.options).toContain("50-50");
    expect(new Set(result?.options).size).toBe(4);
  });

  it("shuffles options randomly", () => {
    const runs = Array.from({ length: 20 }, () => generateWttOptions("kickflip"));
    const correctIndices = runs.map((r) => r?.correctIndex);
    const uniquePositions = new Set(correctIndices);

    // With random shuffling, kickflip should appear in different positions
    expect(uniquePositions.size).toBeGreaterThan(1);
  });

  it("returns null for unknown trick", () => {
    const result = generateWttOptions("nonexistent-trick-that-does-not-exist-12345");
    expect(result).toBeNull();
  });

  it("returns correct index pointing to the correct answer", () => {
    const result = generateWttOptions("kickflip");

    expect(result).not.toBeNull();
    if (result) {
      expect(result.options[result.correctIndex]).toBe("kickflip");
    }
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
