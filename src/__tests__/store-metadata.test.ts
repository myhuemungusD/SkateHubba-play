import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * App Store listing copy (fastlane/metadata) must stay within Apple's field
 * limits and describe the app accurately (Guideline 2.3). Games are
 * turn-based, so the copy must never promise "real-time" play.
 */
const dir = resolve(__dirname, "../../fastlane/metadata/en-US");
const read = (name: string): string => readFileSync(resolve(dir, name), "utf8").trim();

describe("App Store listing metadata", () => {
  it.each([
    ["name.txt", 30],
    ["subtitle.txt", 30],
    ["promotional_text.txt", 170],
    ["keywords.txt", 100],
    ["description.txt", 4000],
    ["release_notes.txt", 4000],
  ])("%s fits Apple's %i-character limit", (file, max) => {
    const text = read(file);
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(max);
  });

  it("never describes turn-based games as real-time", () => {
    for (const file of ["description.txt", "promotional_text.txt", "release_notes.txt", "subtitle.txt"]) {
      expect(read(file)).not.toMatch(/real[- ]time/i);
    }
  });

  it("points privacy and support at live https pages", () => {
    expect(read("privacy_url.txt")).toBe("https://skatehubba.com/privacy");
    expect(read("support_url.txt")).toMatch(/^https:\/\/skatehubba\.com\/support/);
  });

  it("doesn't advertise the Closet while the iPhone build ships with it off", () => {
    // Guideline 2.3: the listing must match the submitted build. See
    // closet-return in the screenshots plan for turning both back on together.
    const workflow = readFileSync(resolve(__dirname, "../../.github/workflows/ios-release.yml"), "utf8");
    const closetOff = /VITE_FEATURE_CLOSET_ENABLED:\s*"false"/.test(workflow);
    for (const file of [
      "description.txt",
      "promotional_text.txt",
      "release_notes.txt",
      "subtitle.txt",
      "keywords.txt",
    ]) {
      if (closetOff) expect(read(file)).not.toMatch(/closet/i);
    }
  });
});
