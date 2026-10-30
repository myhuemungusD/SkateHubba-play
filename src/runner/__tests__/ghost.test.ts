import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBest, noteSample, sampleAt, saveBest, type GhostSample } from "../ghost";
import { GHOST_SPACING } from "../tune";

const KEY = "skatehubba.runner.best.v1";
const emptyBest = () => ({ score: 0, distance: 0, samples: [] });
const store = (value: unknown) => localStorage.setItem(KEY, typeof value === "string" ? value : JSON.stringify(value));

afterEach(() => {
  localStorage.clear();
});

describe("loadBest", () => {
  it("returns an empty best for nothing, null, junk JSON, or a missing sample list", () => {
    expect(loadBest()).toEqual(emptyBest());
    store("null");
    expect(loadBest()).toEqual(emptyBest());
    store("{not json");
    expect(loadBest()).toEqual(emptyBest());
    store({ score: 10, distance: 5 });
    expect(loadBest()).toEqual(emptyBest());
  });

  it("drops bad samples and refuses a best with no score or no usable samples", () => {
    store({ score: "lots", distance: 5, samples: [{ d: 0, x: 0, y: 0 }] });
    expect(loadBest()).toEqual(emptyBest());
    store({ score: 10, distance: 5, samples: [null, 3, { d: "x", x: 0, y: 0 }] });
    expect(loadBest()).toEqual(emptyBest());
  });

  it("keeps a valid best and floors a bad distance at zero", () => {
    store({ score: 12, distance: -4, samples: [null, { d: 1, x: 2, y: 3 }] });
    expect(loadBest()).toEqual({ score: 12, distance: 0, samples: [{ d: 1, x: 2, y: 3 }] });
  });
});

describe("saveBest", () => {
  it("round-trips through storage and swallows a full store", () => {
    const best = { score: 9, distance: 20, samples: [{ d: 0, x: 1, y: 0 }] };
    saveBest(best);
    expect(loadBest()).toEqual(best);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => saveBest({ ...best, score: 99 })).not.toThrow();
    vi.restoreAllMocks();
    expect(loadBest().score).toBe(9);
  });
});

describe("noteSample", () => {
  it("spaces samples and stops at the cap", () => {
    const samples: GhostSample[] = [];
    noteSample(samples, 0, 0, 0);
    noteSample(samples, GHOST_SPACING / 2, 0, 0);
    expect(samples).toHaveLength(1);
    for (let i = 1; i < 700; i += 1) noteSample(samples, i * GHOST_SPACING, 0, 0);
    expect(samples).toHaveLength(600);
  });
});

describe("sampleAt", () => {
  const path: GhostSample[] = [
    { d: 0, x: 0, y: 0 },
    { d: 10, x: 1, y: 2 },
    { d: 20, x: 3, y: 2 },
    { d: 30, x: 3, y: 0 },
  ];

  it("has nothing for an empty path or past its end", () => {
    expect(sampleAt([], 5)).toBeNull();
    expect(sampleAt(path, 31)).toBeNull();
  });

  it("pins to the first sample before the start and interpolates between samples", () => {
    expect(sampleAt(path, -3)).toEqual({ x: 0, y: 0 });
    expect(sampleAt(path, 5)).toEqual({ x: 0.5, y: 1 });
    expect(sampleAt(path, 25)).toEqual({ x: 3, y: 1 });
  });

  it("holds the earlier point when two samples are a hair apart", () => {
    const stacked: GhostSample[] = [
      { d: 0, x: 4, y: 4 },
      { d: 1e-7, x: 8, y: 8 },
    ];
    expect(sampleAt(stacked, 5e-8)).toEqual({ x: 4, y: 4 });
  });

  it("gives up on a sparse path with holes", () => {
    const trailingHole: GhostSample[] = new Array<GhostSample>(3);
    trailingHole[0] = { d: 0, x: 0, y: 0 };
    expect(sampleAt(trailingHole, 5)).toBeNull();

    const middleHole: GhostSample[] = new Array<GhostSample>(3);
    middleHole[0] = { d: 0, x: 0, y: 0 };
    middleHole[2] = { d: 20, x: 2, y: 2 };
    expect(sampleAt(middleHole, 5)).toBeNull();
  });
});
