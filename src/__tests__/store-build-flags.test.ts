/**
 * The App Store and Play Store builds must ship the same features (compliance
 * audit G6). Each workflow sets the VITE_FEATURE_* build flags by hand, so
 * this pins the Android list to the iOS one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FLAG_LINE = /^\s+(VITE_FEATURE_[A-Z0-9_]+):\s*(.+?)\s*$/gm;
/** Flags that only exist on one platform. */
const IOS_ONLY = new Set(["VITE_FEATURE_APPLE_SIGNIN_ENABLED"]);
/** iOS sets this from a tester-build input; store builds leave it off. */
const TESTER_INPUT = "VITE_FEATURE_WTT_ENABLED";
/**
 * XP, levels and the achievements ribbon are hidden on iPhone for 1.2.0
 * (Jason, 2026-10-23). The launch is iPhone-only, so the Android workflow is
 * left as it was; line it up before the first Play Store build.
 */
const XP_FLAG = "VITE_FEATURE_XP_ENABLED";

function flags(workflow: string): Map<string, string> {
  const text = readFileSync(resolve(__dirname, "../../.github/workflows", workflow), "utf8");
  return new Map([...text.matchAll(FLAG_LINE)].map((m) => [m[1], m[2]]));
}

describe("store build flags", () => {
  const ios = flags("ios-release.yml");
  const android = flags("android-aab.yml");

  it("reads a real flag list from both workflows", () => {
    expect(ios.size).toBeGreaterThan(20);
    expect(android.size).toBeGreaterThan(20);
  });

  it("Android sets every iOS flag to the same value", () => {
    const expected = new Map(
      [...ios].filter(([name]) => !IOS_ONLY.has(name) && name !== TESTER_INPUT && name !== XP_FLAG),
    );
    const actual = new Map([...android].filter(([name]) => name !== TESTER_INPUT && name !== XP_FLAG));
    expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
  });

  it("What's That Trick is off in the Play Store build", () => {
    expect(ios.get(TESTER_INPUT)).toContain("inputs.wtt");
    expect(android.get(TESTER_INPUT)).toBe('"false"');
  });

  it("XP is off in both iPhone build paths and Android still sets it", () => {
    expect(ios.get(XP_FLAG)).toBe('"false"');
    const script = readFileSync(resolve(__dirname, "../../ios/App/ci_scripts/ci_post_clone.sh"), "utf8");
    expect(script).toMatch(/^export VITE_FEATURE_XP_ENABLED=false$/m);
    expect(script).not.toMatch(/^export VITE_FEATURE_XP_ENABLED=(?!false$)/m);
    expect(android.has(XP_FLAG)).toBe(true);
  });
});
