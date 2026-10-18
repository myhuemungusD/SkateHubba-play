import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FEATURE_SWITCH_KEYS, readFeatureSwitches } from "../featureSwitches";

describe("featureSwitches", () => {
  it("lists every VITE_FEATURE_* key read in featureFlags.ts", () => {
    const src = readFileSync("src/lib/featureFlags.ts", "utf8");
    const keys = [...new Set(src.match(/VITE_FEATURE_[A-Z0-9_]+/g))].sort();
    expect([...FEATURE_SWITCH_KEYS].sort()).toEqual(keys);
  });
  it("reads on only for literal true and labels plainly", () => {
    const rows = readFeatureSwitches({ VITE_FEATURE_DICE_ENABLED: "true", VITE_FEATURE_XP_ENABLED: "1" });
    expect(rows.find((r) => r.key === "VITE_FEATURE_DICE_ENABLED")).toEqual({
      key: "VITE_FEATURE_DICE_ENABLED",
      label: "DICE",
      on: true,
    });
    expect(rows.find((r) => r.key === "VITE_FEATURE_XP_ENABLED")?.on).toBe(false);
  });
  it("defaults to the build env", () => {
    expect(readFeatureSwitches().length).toBe(FEATURE_SWITCH_KEYS.length);
  });
});
