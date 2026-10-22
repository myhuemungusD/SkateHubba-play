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
