import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The iOS app ships iPhone-only (TARGETED_DEVICE_FAMILY = 1), decided before the
 * first release: Apple won't let an app drop iPad support once an iPad version
 * has shipped, and iPhone-only means no iPad screenshot set. iPads still run it
 * in iPhone compatibility mode.
 */
const root = resolve(__dirname, "../..");
const pbxproj = readFileSync(resolve(root, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
const plist = readFileSync(resolve(root, "ios/App/App/Info.plist"), "utf8");

describe("iOS device family", () => {
  it("targets iPhone only in every build configuration", () => {
    const families = [...pbxproj.matchAll(/TARGETED_DEVICE_FAMILY = ([^;]+);/g)].map((m) => m[1]);
    expect(families.length).toBeGreaterThanOrEqual(2);
    expect(new Set(families)).toEqual(new Set(["1"]));
  });

  it("carries no iPad-only Info.plist keys", () => {
    expect(plist).not.toMatch(/~ipad/);
    expect(plist).toContain("<key>UISupportedInterfaceOrientations</key>");
  });
});
