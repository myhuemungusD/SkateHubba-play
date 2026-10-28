/**
 * Unit coverage for scripts/check-doc-claims.mjs: docs and store text must not
 * contradict the workflows, manifests and config they describe.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  check,
  parseFlags,
  parseAndroidPermissions,
  parsePrivacyTypes,
  parseCoverageTuples,
  // @ts-expect-error -- plain .mjs script without type declarations
} from "../../scripts/check-doc-claims.mjs";

const ROOT = resolve(__dirname, "../..");

describe("parsers", () => {
  it("reads workflow, shell and input-default flag forms", () => {
    const flags = parseFlags(
      [
        '          VITE_FEATURE_A: "true"',
        "export VITE_FEATURE_B=false",
        "export VITE_FEATURE_C=${VITE_FEATURE_C:-false}",
        "          VITE_FEATURE_D: ${{ inputs.d }}",
      ].join("\n"),
    );
    expect(flags).toEqual({
      VITE_FEATURE_A: "true",
      VITE_FEATURE_B: "false",
      VITE_FEATURE_C: "false",
      VITE_FEATURE_D: "input",
    });
  });

  it("reads Android permissions and iOS data types", () => {
    expect(parseAndroidPermissions('<uses-permission android:name="android.permission.CAMERA" />')).toEqual(["CAMERA"]);
    expect(
      parsePrivacyTypes(
        "<string>NSPrivacyCollectedDataTypeEmailAddress</string><string>NSPrivacyCollectedDataTypePurposeAnalytics</string>",
      ),
    ).toEqual(["EmailAddress"]);
  });

  it("reads coverage tuples in both doc orders", () => {
    const t = parseCoverageTuples("lines: 90, functions: 80, branches: 70, statements: 60");
    expect(t.has("90/80/70/60")).toBe(true);
    expect(t.has("90/80/60/70")).toBe(true);
  });
});

describe("repo", () => {
  it("has no doc claim the code contradicts", () => {
    const { errors } = check(ROOT);
    expect(errors).toEqual([]);
  });
});
