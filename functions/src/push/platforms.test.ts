import { describe, expect, it } from "vitest";
import {
  testerEligibleTokens,
  DICE_PUSH_PLATFORMS,
  diceEligibleTokens,
  isDicePush,
  mirrorTokens,
  tokenAllowsDice,
} from "./platforms.js";

describe("dice push platforms", () => {
  it("allows android and web, never ios (dice is off in the iOS build)", () => {
    expect([...DICE_PUSH_PLATFORMS].sort()).toEqual(["android", "web"]);
  });

  it("treats untagged, unknown and malformed tags as iOS (fail closed)", () => {
    const mirror = { platforms: { a: "android", w: "web", i: "ios", x: "watch", n: 3 } };
    expect(diceEligibleTokens(mirror, ["a", "w", "i", "x", "n", "untagged"])).toEqual(["a", "w"]);
    expect(diceEligibleTokens(undefined, ["a"])).toEqual([]);
    expect(diceEligibleTokens({ platforms: ["a"] }, ["a"])).toEqual([]);
    expect(diceEligibleTokens({ platforms: null }, ["a"])).toEqual([]);
    expect(tokenAllowsDice({ platforms: { a: "web" } }, "a")).toBe(true);
  });

  it("recognises a dice dispatch by kind or by type", () => {
    expect(isDicePush({ kind: "dice" })).toBe(true);
    expect(isDicePush({ type: "dice_result" })).toBe(true);
    expect(isDicePush({ type: "your_turn" })).toBe(false);
    expect(isDicePush({})).toBe(false);
  });
});

describe("mirrorTokens", () => {
  it("keeps non-empty strings, de-duplicates and caps at 10", () => {
    const many = Array.from({ length: 12 }, (_, i) => `t${i}`);
    expect(mirrorTokens({ tokens: ["t0", ...many, 3, "", null] })).toEqual(many.slice(0, 10));
  });
  it("returns [] for a missing doc or a non-list", () => {
    expect(mirrorTokens(undefined)).toEqual([]);
    expect(mirrorTokens({ tokens: "t" })).toEqual([]);
  });
});

describe("tester announcement push platforms", () => {
  it("keeps android and web tokens, drops ios and untagged ones", () => {
    const mirror = { platforms: { a: "android", w: "web", i: "ios" } };
    expect(testerEligibleTokens(mirror, ["a", "w", "i", "old"])).toEqual(["a", "w"]);
    expect(testerEligibleTokens(undefined, ["a"])).toEqual([]);
  });
});
