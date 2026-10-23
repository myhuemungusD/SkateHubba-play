/**
 * XP UI gate guard. Every source file that renders an XP or level surface
 * (level chip, the "L1 · 0 / 24 XP" progress line, the achievements ribbon,
 * the game-over level-up moment) must gate it on isXpEnabled(), and on
 * nothing platform-specific: a Capacitor/platform check would make a local
 * Xcode archive behave differently from the CI build for the same
 * VITE_FEATURE_XP_ENABLED value. A new XP surface that skips the gate fails here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");
const XP_SURFACE = /<LevelChip\b|data-testid="xp-progress"|<AchievementsRibbon\b|useLevelUpMoment\(/;
/** The hook itself takes `enabled` as an argument; its callers pass the flag. */
const DEFINES_ONLY = new Set(["hooks/useLevelUpMoment.ts"]);
/** Capacitor calls and the repo's own helpers (isNativeShell, isIosDevice, isIOSSafari, ...). */
const PLATFORM_CHECK =
  /Capacitor\.(isNativePlatform|getPlatform)|\b(isNative\w*|isIos\w*|isIOS\w*|isAndroid\w*|getPlatform)\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.|\.test-helpers\./.test(name) ? [full] : [];
  });
}

const surfaces = sourceFiles(SRC)
  .map((full) => ({ rel: relative(SRC, full).replace(/\\/g, "/"), text: readFileSync(full, "utf8") }))
  .filter(({ rel, text }) => XP_SURFACE.test(text) && !DEFINES_ONLY.has(rel));

describe("XP surface gate", () => {
  it("finds the known XP surfaces (the scan is live)", () => {
    expect(surfaces.map((s) => s.rel).sort()).toEqual(
      expect.arrayContaining([
        "screens/GameOverScreen.tsx",
        "screens/PlayerProfileScreen/components/ProfileIdentityCard.tsx",
        "screens/PlayerProfileScreen/index.tsx",
      ]),
    );
  });

  it.each(surfaces.map((s) => [s.rel, s.text]))("%s gates its XP UI on isXpEnabled()", (_rel, text) => {
    expect(text).toMatch(/\bisXpEnabled\(\)/);
  });

  it.each(surfaces.map((s) => [s.rel, s.text]))("%s has no platform check", (_rel, text) => {
    expect(text).not.toMatch(PLATFORM_CHECK);
  });
});
