import { describe, it, expect } from "vitest";

import { TRICK_CATEGORIES, normalizeTrickCategory, trickCategoryLabel, type TrickCategoryId } from "../trickCategories";

describe("normalizeTrickCategory", () => {
  // Every valid id must pass through unchanged. Table-driven so a new
  // category id can't silently escape the round-trip guarantee.
  it.each(TRICK_CATEGORIES.map((c) => c.id))("passes through the valid id %s", (id) => {
    expect(normalizeTrickCategory(id)).toBe(id);
  });

  // Anything that is not one of the six ids collapses to "any". Covers the
  // untrusted-boundary cases: unknown string, number, null, undefined, and a
  // structurally-similar-but-wrong object.
  it.each<[string, unknown]>([
    ["an unknown string", "kickflips"],
    ["an empty string", ""],
    ["a number", 3],
    ["null", null],
    ["undefined", undefined],
    ["a boolean", true],
    ["an object", { id: "flip" }],
  ])("falls back to 'any' for %s", (_label, raw) => {
    expect(normalizeTrickCategory(raw)).toBe("any");
  });
});

describe("trickCategoryLabel", () => {
  // Known ids resolve to their configured display label.
  it.each(TRICK_CATEGORIES.map((c): [TrickCategoryId, string] => [c.id, c.label]))(
    "returns the configured label for %s",
    (id, label) => {
      expect(trickCategoryLabel(id)).toBe(label);
    },
  );

  // Unknown / missing ids (legacy game docs) fall back to the "any" label.
  it.each<[string, string | null | undefined]>([
    ["an unknown id", "kickflips"],
    ["null", null],
    ["undefined", undefined],
  ])("falls back to 'Anything Goes' for %s", (_label, id) => {
    expect(trickCategoryLabel(id)).toBe("Anything Goes");
  });
});
