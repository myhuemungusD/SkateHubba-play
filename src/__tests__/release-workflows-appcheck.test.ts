/**
 * Guard: every store build turns App Check on, as a literal so the website's
 * cost switch (reCAPTCHA) can't turn it off. Without it ensureAppCheck() is a
 * no-op and the enforceAppCheck callables (Closet, pro seed) reject every
 * call from that build. iOS shipped without it once.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf-8");

/** The env block of the workflow step named "Build web assets". */
function buildStepEnv(workflow: string): string {
  const lines = read(workflow).split("\n");
  const start = lines.findIndex((l) => /^\s*- name: Build web assets\s*$/.test(l));
  expect(start, `${workflow} has a "Build web assets" step`).toBeGreaterThan(-1);
  const indent = lines[start].indexOf("-");
  const end = lines.findIndex((l, i) => i > start && /^\s*- /.test(l) && l.indexOf("-") <= indent);
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

describe("store builds set VITE_APPCHECK_ENABLED to true", () => {
  it.each([".github/workflows/ios-release.yml", ".github/workflows/android-aab.yml"])(
    "%s sets it in the web build step",
    (workflow) => {
      expect(buildStepEnv(workflow)).toMatch(/^\s+VITE_APPCHECK_ENABLED: "true"$/m);
    },
  );

  it("Xcode Cloud exports it before the web build", () => {
    const script = read("ios/App/ci_scripts/ci_post_clone.sh");
    const exportAt = script.indexOf("export VITE_APPCHECK_ENABLED=true\n");
    expect(exportAt).toBeGreaterThan(-1);
    expect(exportAt).toBeLessThan(script.indexOf("npm run build"));
  });
});

/**
 * Until App Check is verified on a TestFlight device, the iPhone build ships
 * with the Closet off, and Closet Studio (its clothes editor, reachable from
 * Settings) has to go with it. Otherwise review sees a Closet feature the
 * listing and the review notes say isn't there, and the photo-library prompt
 * would be describing a screen that doesn't exist.
 */
describe("iPhone builds with the Closet off", () => {
  const closetOff = /^\s+VITE_FEATURE_CLOSET_ENABLED: "false"$/m.test(
    buildStepEnv(".github/workflows/ios-release.yml"),
  );

  it.runIf(closetOff)("turn Closet Studio off in both iPhone build paths", () => {
    expect(buildStepEnv(".github/workflows/ios-release.yml")).toMatch(/^\s+VITE_FEATURE_CLOSET_STUDIO: "false"$/m);
    const script = read("ios/App/ci_scripts/ci_post_clone.sh");
    expect(script).toMatch(/^export VITE_FEATURE_CLOSET_ENABLED=false$/m);
    expect(script).toMatch(/^export VITE_FEATURE_CLOSET_STUDIO=false$/m);
  });

  it.runIf(closetOff)("don't mention the Closet in any permission prompt", () => {
    const prompts = [
      ...read("ios/App/App/Info.plist").matchAll(/<key>NS\w+UsageDescription<\/key>\s*<string>([^<]*)</g),
    ];
    expect(prompts.length).toBeGreaterThan(0);
    for (const [, text] of prompts) expect(text).not.toMatch(/closet/i);
  });
});

/**
 * Guard: both store workflows stop before the build when the Mapbox token
 * secret is missing. The web build passes without it, and the reviewer then
 * sees a Map tab that only says "Map is temporarily unavailable."
 */
describe("store builds require VITE_MAPBOX_TOKEN up front", () => {
  it.each([".github/workflows/ios-release.yml", ".github/workflows/android-aab.yml"])(
    "%s checks it before the web build",
    (workflow) => {
      const text = read(workflow);
      const check = text.indexOf("require-github-secrets.sh");
      expect(check, `${workflow} runs the secret check`).toBeGreaterThan(-1);
      const before = text.slice(0, check);
      const checkStep = before.slice(before.lastIndexOf("- name:"));
      expect(checkStep).toMatch(/^\s+VITE_MAPBOX_TOKEN: \$\{\{ secrets\.VITE_MAPBOX_TOKEN \}\}$/m);
      expect(check).toBeLessThan(text.indexOf("- name: Build web assets"));
    },
  );

  it("Android passes it to the check", () => {
    const text = read(".github/workflows/android-aab.yml");
    expect(text).toMatch(/^\s+run: bash \.github\/scripts\/require-github-secrets\.sh VITE_MAPBOX_TOKEN$/m);
  });

  it("iOS lists it with the names the check requires", () => {
    const text = read(".github/workflows/ios-release.yml");
    const lists = [...text.matchAll(/names\+?=\(([\s\S]*?)\)/g)].map((m) => m[1]);
    expect(lists.some((list) => /^\s+VITE_MAPBOX_TOKEN$/m.test(list))).toBe(true);
  });
});
