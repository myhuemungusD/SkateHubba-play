/**
 * Unit coverage for scripts/check-coverage-ignores.mjs: every coverage-ignore
 * hint must carry a written reason.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error -- plain .mjs script without type declarations
import { checkHintLine } from "../../scripts/check-coverage-ignores.mjs";

const SCRIPT = resolve(__dirname, "../../scripts/check-coverage-ignores.mjs");

describe("checkHintLine", () => {
  it("ignores lines with no coverage hint", () => {
    expect(checkHintLine("const x = 1; // ignore next time")).toBeNull();
  });

  it.each([
    "/* v8 ignore next -- jsdom has no WebGL context */",
    "/* v8 ignore next 3 -- CLI entry guard */",
    "/* v8 ignore start -- native-only bridge */",
    "/* c8 ignore else -- unreachable in browsers */",
    "/* istanbul ignore if -- @preserve server-only path */",
    "/* node:coverage ignore next -- native shell only, no jsdom bridge */",
    "/* v8 ignore next -- first reason here */ const a = 1; /* v8 ignore next -- second reason here */",
  ])("accepts a hint with a reason: %s", (line) => {
    expect(checkHintLine(line)).toBeNull();
  });

  it("accepts a bare stop marker", () => {
    expect(checkHintLine("  /* v8 ignore stop */")).toBeNull();
  });

  it.each([
    "/* v8 ignore next */",
    "/* v8 ignore next 2 */",
    "/* c8 ignore start */",
    "// istanbul ignore else",
    "/* node:coverage ignore next */",
    "/* node:coverage ignore start */",
    "// node:coverage ignore next",
  ])("rejects a hint without a reason: %s", (line) => {
    expect(checkHintLine(line)).toMatch(/without a reason/);
  });

  it.each([
    "/* v8 ignore next -- */",
    "/* v8 ignore next -- x */",
    "/* v8 ignore next -- tbd */",
    "/* v8 ignore next -- abc */",
    "/* v8 ignore next -- untestable */",
    "/* v8 ignore next -- a b c d e f */",
    "/* v8 ignore next -- ok go */",
    "/* node:coverage ignore next -- abc */",
  ])("rejects an empty, placeholder or one-word reason: %s", (line) => {
    expect(checkHintLine(line)).toMatch(/empty, a placeholder or too short/);
  });

  it.each([
    // A reasoned hint followed by a bare one on the same line.
    "/* v8 ignore next -- ok reason here */ /* v8 ignore next */",
    // A reasoned hint, more code, then a bare hint of another prefix.
    "/* v8 ignore next -- ok reason here */ const y = 2; /* c8 ignore next */",
    "/* v8 ignore next -- ok reason here */ /* node:coverage ignore start */",
  ])("checks every hint on a line, not just the first: %s", (line) => {
    expect(checkHintLine(line)).toMatch(/without a reason/);
  });

  it("checks a later hint's reason even when the first is fine", () => {
    expect(checkHintLine("/* v8 ignore next -- ok reason here */ /* v8 ignore next -- abc */")).toMatch(/too short/);
  });

  it("reports a reason wrapped onto the next line as missing", () => {
    expect(checkHintLine("/* v8 ignore next")).toMatch(/without a reason/);
  });
});

describe("check-coverage-ignores CLI", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function seed(files: Record<string, string>) {
    dir = mkdtempSync(join(tmpdir(), "cov-ignores-"));
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts/check-coverage-ignores.mjs"), readFileSync(SCRIPT, "utf-8"));
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), body);
    }
    const r = spawnSync("node", [join(dir, "scripts/check-coverage-ignores.mjs")], { cwd: dir, encoding: "utf-8" });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  it("passes when every hint has a reason", () => {
    const r = seed({
      "src/lib/a.ts": "/* v8 ignore start -- native only */\nfoo();\n/* v8 ignore stop */\n",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("every coverage ignore has a reason");
  });

  it("fails with file and line for an unreasoned hint, including under lib/ and functions/src", () => {
    const r = seed({
      "src/lib/a.ts": "ok();\n/* v8 ignore next */\nbar();\n",
      "functions/src/b.ts": "/* c8 ignore else */\n",
      "src/node_modules/c.ts": "/* v8 ignore next */\n",
      "src/lib/__tests__/d.ts": "/* v8 ignore next */\n",
      "src/lib/e.test.ts": "/* v8 ignore next */\n",
      "src/lib/f.ts": "/* node:coverage ignore next */\nx();\n",
      "src/lib/g.ts": "/* v8 ignore next -- ok reason here */ /* v8 ignore next */\n",
      "src/lib/h.ts": "/* v8 ignore next -- abc */\n",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("src/lib/a.ts:2:");
    expect(r.stderr).toContain("functions/src/b.ts:1:");
    expect(r.stderr).not.toContain("node_modules");
    expect(r.stderr).not.toContain("__tests__");
    expect(r.stderr).not.toContain("e.test.ts");
    expect(r.stderr).toContain("src/lib/f.ts:1:");
    expect(r.stderr).toContain("src/lib/g.ts:1:");
    expect(r.stderr).toContain("src/lib/h.ts:1:");
    expect(r.stderr).toContain("5 coverage ignore(s) without a reason");
  });
});
