/**
 * scripts/ios-preflight.mjs must catch the three bugs that cost three paid
 * Mac builds on 2026-10-18 (#753, #754, #755). Fixtures are the exact patch
 * inputs from before each fix, applied to a pristine video-recorder 7.5.0.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script, no types
import { applyPatches, validateSwift, main } from "../../scripts/ios-preflight.mjs";

const FIX = resolve(__dirname, "../../scripts/__fixtures__/ios-preflight");
const PRISTINE = resolve(FIX, "pristine");
const ROOT = resolve(__dirname, "../..");

function patchedErrors(root: string): string[] {
  const { tmp, swift } = applyPatches(PRISTINE, { root });
  try {
    return validateSwift(readFileSync(swift, "utf-8"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("ios-preflight", () => {
  it("passes the current patches", () => {
    expect(patchedErrors(ROOT)).toEqual([]);
  });

  it("catches bug 1: self.isRecording does not exist (#753)", () => {
    const errs = patchedErrors(resolve(FIX, "bug1-isRecording"));
    expect(errs.some((e) => e.includes("self.isRecording"))).toBe(true);
  });

  it("catches bug 2: missing AVCaptureVideoDataOutputSampleBufferDelegate conformance (#754)", () => {
    const errs = patchedErrors(resolve(FIX, "bug2-conformance"));
    expect(errs.some((e) => e.includes("conformance to AVCaptureVideoDataOutputSampleBufferDelegate"))).toBe(true);
    expect(errs.some((e) => e.includes("self.isRecording"))).toBe(false);
  });

  it("catches bug 3: non-public protocol witnesses on a public class (#755)", () => {
    const errs = patchedErrors(resolve(FIX, "bug3-public-witness"));
    expect(errs.filter((e) => e.includes("captureOutput(...)") && e.includes("not public"))).toHaveLength(2);
    expect(errs.some((e) => e.includes("conformance"))).toBe(false);
  });

  it("flags unbalanced braces and a missing class", () => {
    expect(validateSwift("class Other {")).toEqual(
      expect.arrayContaining([expect.stringContaining("unbalanced"), expect.stringContaining("not found")]),
    );
  });

  it("ignores self references inside comments and allows inherited members", () => {
    const src =
      "public class VideoRecorder: CAPPlugin {\n // self.ghost\n func a() { self.bridge; self.notifyListeners }\n}\n";
    expect(validateSwift(src)).toEqual([]);
  });

  it("main() validates a single file and returns 1 on problems", () => {
    const file = resolve(FIX, "bug3-public-witness/scripts/ios-patches/video-recorder-pro.swift.txt");
    expect(main(["--swift", file])).toBe(1);
    expect(main(["--plugin-dir", PRISTINE])).toBe(0);
  });
});
