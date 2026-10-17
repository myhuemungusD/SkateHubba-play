import { describe, it, expect, vi, beforeEach } from "vitest";

const confusable = vi.fn<(id: string, n: number) => string[]>();
const distractor = vi.fn<(id: string, used: Set<string>) => string | null>();

vi.mock("../../constants/tricks", () => ({
  trickById: (id: string) => ({ id }),
  getConfusableTricks: (id: string, n: number) => confusable(id, n),
  getRandomDistractor: (id: string, used: Set<string>) => distractor(id, used),
}));

import { generateWttOptions } from "../wtt.options";

beforeEach(() => {
  confusable.mockReset();
  distractor.mockReset();
});

describe("generateWttOptions fallbacks", () => {
  it("skips a confusable that repeats the answer and fills from the common list", () => {
    confusable.mockReturnValue(["kickflip", "heelflip"]);
    distractor.mockReturnValue(null);
    const result = generateWttOptions("kickflip");
    expect(result?.options).toHaveLength(4);
    expect(new Set(result?.options)).toEqual(new Set(["kickflip", "heelflip", "ollie", "pop-shove-it"]));
    expect(result?.options[result.correctIndex]).toBe("kickflip");
  });

  it("returns null once every fallback is already used", () => {
    const common = ["ollie", "kickflip", "heelflip", "pop-shove-it", "bs-180", "fs-180", "50-50", "boardslide"];
    confusable.mockReturnValue([]);
    distractor.mockImplementation((_id, used) => {
      // Burn every common fallback so the generator runs dry.
      common.forEach((c) => used.add(c));
      return null;
    });
    expect(generateWttOptions("tre-flip")).toBeNull();
  });
});
