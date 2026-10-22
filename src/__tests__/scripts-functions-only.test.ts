/**
 * Unit coverage for scripts/ci/functions-only.mjs, the --only builder and
 * post-deploy check for .github/workflows/firebase-functions-deploy.yml.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error — plain .mjs script, no types
import * as fo from "../../scripts/ci/functions-only.mjs";

const SCRIPT = resolve(__dirname, "../../scripts/ci/functions-only.mjs");

function run(args: string[], functions: string | undefined) {
  const env = { ...process.env };
  delete env.FUNCTIONS;
  if (functions !== undefined) env.FUNCTIONS = functions;
  const r = spawnSync("node", [SCRIPT, ...args], { encoding: "utf-8", env });
  return { status: r.status ?? -1, stdout: r.stdout };
}

describe("buildOnly", () => {
  it("prefixes every name (the run 39634702670 regression)", () => {
    expect(fo.buildOnly("diceAction,pushDispatchOnCreate,pushDispatchSweep")).toBe(
      "functions:diceAction,functions:pushDispatchOnCreate,functions:pushDispatchSweep",
    );
  });

  it("trims spaces and skips empty entries", () => {
    expect(fo.buildOnly(" diceAction , ,pushDispatchSweep,, ")).toBe(
      "functions:diceAction,functions:pushDispatchSweep",
    );
  });

  it("does not double-prefix names that already carry functions:", () => {
    expect(fo.buildOnly("functions:diceAction,pushDispatchSweep")).toBe(
      "functions:diceAction,functions:pushDispatchSweep",
    );
  });

  it("drops duplicates", () => {
    expect(fo.buildOnly("diceAction,functions:diceAction")).toBe("functions:diceAction");
  });

  it("deploys all functions when the input is empty", () => {
    expect(fo.buildOnly("")).toBe("functions");
    expect(fo.buildOnly(" , ")).toBe("functions");
    expect(fo.buildOnly(undefined)).toBe("functions");
  });

  it("rejects names firebase-tools would not accept", () => {
    expect(() => fo.buildOnly("diceAction,hosting:site")).toThrow(/Invalid function name/);
    expect(() => fo.buildOnly("1bad")).toThrow(/Invalid function name/);
    expect(() => fo.buildOnly("a;rm -rf /")).toThrow(/Invalid function name/);
  });
});

describe("missingFromLog", () => {
  const log = [
    "\x1b[32m\x1b[1m✔ \x1b[22m\x1b[39m \x1b[1m\x1b[32mfunctions[diceAction(us-central1)]\x1b[39m\x1b[22m Successful update operation.",
    "✔  functions[pushDispatchOnCreate(us-central1)] Successful create operation.",
    "✔  Deploy complete!",
  ].join("\n");

  it("passes names that logged a successful create or update (ANSI colours stripped)", () => {
    expect(fo.missingFromLog(["diceAction", "pushDispatchOnCreate"], log)).toEqual([]);
  });

  it("reports names the deploy silently dropped", () => {
    expect(fo.missingFromLog(["diceAction", "pushDispatchOnCreate", "pushDispatchSweep"], log)).toEqual([
      "pushDispatchSweep",
    ]);
  });

  it("does not match a name that is only a prefix of a deployed one", () => {
    expect(fo.missingFromLog(["pushDispatch"], log)).toEqual(["pushDispatch"]);
  });
});

describe("CLI", () => {
  it("only: prints the prefixed list", () => {
    const r = run(["only"], "diceAction, pushDispatchSweep");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("functions:diceAction,functions:pushDispatchSweep");
  });

  it("only: fails with a workflow error on a bad name", () => {
    const r = run(["only"], "dice-action");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/::error::Invalid function name/);
  });

  it("verify: fails when a requested function is missing from the log", () => {
    const dir = mkdtempSync(join(tmpdir(), "fn-only-"));
    try {
      const logPath = join(dir, "deploy.log");
      writeFileSync(logPath, "✔  functions[diceAction(us-central1)] Successful update operation.\n");
      const bad = run(["verify", logPath], "diceAction,pushDispatchSweep");
      expect(bad.status).toBe(1);
      expect(bad.stdout).toMatch(/Requested but not deployed: pushDispatchSweep/);
      const ok = run(["verify", logPath], "diceAction");
      expect(ok.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("verify: a deploy-all run has nothing to check by name", () => {
    expect(run(["verify", "/nonexistent"], "").status).toBe(0);
  });

  it("rejects an unknown mode", () => {
    expect(run(["bogus"], "x").status).toBe(1);
  });
});
