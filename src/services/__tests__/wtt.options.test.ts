import { describe, it, expect } from "vitest";
import { generateWttOptions, validateWttOptions } from "../wtt.options";

describe("generateWttOptions", () => {
  it("generates 4 unique options including the correct answer", () => {
    const options = generateWttOptions("kickflip");

    expect(options).toHaveLength(4);
    expect(options).toContain("kickflip");
    expect(new Set(options).size).toBe(4);
  });

  it("includes confusable tricks when available", () => {
    const options = generateWttOptions("kickflip");

    expect(options).toContain("kickflip");
    expect(options.some((opt) => ["heelflip", "varial-kickflip", "hardflip", "inward-heelflip"].includes(opt))).toBe(
      true,
    );
  });

  it("generates options for tricks without confusables", () => {
    const options = generateWttOptions("indy");

    expect(options).toHaveLength(4);
    expect(options).toContain("indy");
    expect(new Set(options).size).toBe(4);
  });

  it("generates options for tricks with few confusables", () => {
    const options = generateWttOptions("manual");

    expect(options).toHaveLength(4);
    expect(options).toContain("manual");
    expect(new Set(options).size).toBe(4);
  });

  it("shuffles options randomly", () => {
    const runs = Array.from({ length: 20 }, () => generateWttOptions("kickflip"));
    const firstPositions = runs.map((opts) => opts.indexOf("kickflip"));
    const uniquePositions = new Set(firstPositions);

    expect(uniquePositions.size).toBeGreaterThan(1);
  });
});

describe("validateWttOptions", () => {
  it("passes for valid 4-option array", () => {
    expect(() => {
      validateWttOptions(["kickflip", "heelflip", "impossible", "bigflip"]);
    }).not.toThrow();
  });

  it("throws for fewer than 4 options", () => {
    expect(() => {
      validateWttOptions(["kickflip", "heelflip"]);
    }).toThrow("WTT options must have exactly 4 choices");
  });

  it("throws for more than 4 options", () => {
    expect(() => {
      validateWttOptions(["kickflip", "heelflip", "impossible", "bigflip", "tre-flip"]);
    }).toThrow("WTT options must have exactly 4 choices");
  });

  it("throws for duplicate options", () => {
    expect(() => {
      validateWttOptions(["kickflip", "heelflip", "kickflip", "impossible"]);
    }).toThrow("WTT options must be unique");
  });

  it("throws for empty string options", () => {
    expect(() => {
      validateWttOptions(["kickflip", "", "heelflip", "impossible"]);
    }).toThrow("WTT options cannot be empty");
  });

  it("throws for whitespace-only options", () => {
    expect(() => {
      validateWttOptions(["kickflip", "  ", "heelflip", "impossible"]);
    }).toThrow("WTT options cannot be empty");
  });
});
