import { describe, it, expect } from "vitest";
import { getConfusableTricks, getRandomDistractor, TRICK_CONFUSION_MAP } from "../tricks";

describe("TRICK_CONFUSION_MAP", () => {
  it("contains entries for common tricks", () => {
    const commonTricks = ["kickflip", "heelflip", "pop-shove-it", "bs-180", "50-50", "boardslide"];

    for (const trickId of commonTricks) {
      expect(TRICK_CONFUSION_MAP[trickId]).toBeDefined();
      expect(TRICK_CONFUSION_MAP[trickId].length).toBeGreaterThan(0);
    }
  });

  it("maps kickflip to heelflip and vice versa", () => {
    expect(TRICK_CONFUSION_MAP.kickflip).toContain("heelflip");
    expect(TRICK_CONFUSION_MAP.heelflip).toContain("kickflip");
  });

  it("maps hospital-flip to related tricks", () => {
    const confusables = TRICK_CONFUSION_MAP["hospital-flip"];
    expect(confusables).toBeDefined();
    expect(confusables.length).toBeGreaterThan(0);
  });

  it("has symmetric relationships for key pairs", () => {
    // If A confuses with B, B should confuse with A (mostly)
    const pairs = [
      ["kickflip", "heelflip"],
      ["pop-shove-it", "fs-pop-shove-it"],
      ["50-50", "5-0"],
      ["boardslide", "lipslide"],
    ];

    for (const [a, b] of pairs) {
      const aConfusables = TRICK_CONFUSION_MAP[a] ?? [];
      const bConfusables = TRICK_CONFUSION_MAP[b] ?? [];

      expect(aConfusables).toContain(b);
      expect(bConfusables).toContain(a);
    }
  });
});

describe("getConfusableTricks", () => {
  it("returns confusables for a trick with many options", () => {
    const confusables = getConfusableTricks("kickflip", 2);
    expect(confusables).toHaveLength(2);
    expect(confusables.every((id) => typeof id === "string")).toBe(true);
  });

  it("returns fewer than requested if not enough confusables exist", () => {
    const confusables = getConfusableTricks("kickflip", 10);
    expect(confusables.length).toBeLessThanOrEqual(10);
  });

  it("returns empty array for trick with no confusables", () => {
    const confusables = getConfusableTricks("nonexistent-trick", 2);
    expect(confusables).toEqual([]);
  });

  it("respects count parameter", () => {
    const one = getConfusableTricks("kickflip", 1);
    const two = getConfusableTricks("kickflip", 2);
    const three = getConfusableTricks("kickflip", 3);

    expect(one.length).toBe(1);
    expect(two.length).toBe(2);
    expect(three.length).toBe(3);
  });
});

describe("getRandomDistractor", () => {
  it("returns a trick from the same category", () => {
    const exclude = new Set(["kickflip", "heelflip"]);
    const distractor = getRandomDistractor("kickflip", exclude);

    expect(distractor).not.toBeNull();
    expect(distractor).not.toBe("kickflip");
    expect(exclude.has(distractor!)).toBe(false);
  });

  it("returns different tricks on multiple calls", () => {
    const exclude = new Set(["kickflip"]);
    const distractors = new Set<string>();

    // Call 10 times and collect results
    for (let i = 0; i < 10; i++) {
      const distractor = getRandomDistractor("kickflip", exclude);
      if (distractor) {
        distractors.add(distractor);
      }
    }

    // Should get at least 2 different distractors
    expect(distractors.size).toBeGreaterThanOrEqual(2);
  });

  it("returns null for invalid trick ID", () => {
    const exclude = new Set<string>();
    const distractor = getRandomDistractor("nonexistent-trick", exclude);
    expect(distractor).toBeNull();
  });

  it("excludes specified tricks", () => {
    const exclude = new Set(["heelflip", "varial-kickflip", "hardflip", "inward-heelflip"]);
    const distractor = getRandomDistractor("kickflip", exclude);

    if (distractor) {
      expect(exclude.has(distractor)).toBe(false);
      expect(distractor).not.toBe("kickflip");
    }
  });
});
