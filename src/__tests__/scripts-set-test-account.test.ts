/** Unit coverage for the argument parsing in scripts/set-test-account.mjs. */
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs script, no types
import { parseArgs } from "../../scripts/set-test-account.mjs";

describe("set-test-account parseArgs", () => {
  it("defaults to a dry run that sets the flag", () => {
    expect(parseArgs(["QA_Tester_1", "uid:abc123"])).toEqual({
      targets: [
        { kind: "username", value: "qa_tester_1" },
        { kind: "uid", value: "abc123" },
      ],
      unset: false,
      apply: false,
    });
  });

  it("reads --unset and --apply", () => {
    expect(parseArgs(["sk8testdemo", "--unset", "--apply"])).toMatchObject({ unset: true, apply: true });
  });

  it("rejects unknown flags, no targets, and malformed names", () => {
    expect(() => parseArgs(["qa_tester_1", "--execute"])).toThrow(/Unknown flag/);
    expect(() => parseArgs(["--apply"])).toThrow(/Usage/);
    expect(() => parseArgs(["uid:"])).toThrow(/Invalid uid/);
    expect(() => parseArgs(["uid:a/b"])).toThrow(/Invalid uid/);
    expect(() => parseArgs(["no spaces"])).toThrow(/Invalid username/);
  });
});
