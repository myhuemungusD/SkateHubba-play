import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const workflow = readFileSync(resolve(root, ".github/workflows/firebase-functions-deploy.yml"), "utf8");
const docs = readFileSync(resolve(root, "docs/DEPLOY_FUNCTIONS.md"), "utf8");

/** The deploy step's "Fill switches the secret predates" loop. */
const fillLoop = workflow.match(/for key in (CLOSET_ENABLED[^;]*); do/)?.[1].split(" ") ?? [];
/** The repository-variable override loop (`ovr="OVR_${key}"`). */
const overrideLoop = workflow.match(/for key in ([A-Z_ ]+); do\n\s+ovr="OVR_\$\{key\}"/)?.[1].split(" ") ?? [];
/** The "Print the on/off switches" loop (the last `for key in XP_ENABLED ...`). */
const printLoop = [...workflow.matchAll(/for key in (XP_ENABLED[^;]*); do\n\s+raw=/g)].at(-1)?.[1].split(" ") ?? [];

const REQUIRED_SECRET = [
  "XP_ENABLED=false",
  "XP_TESTER_UIDS=",
  "DICE_ENABLED=false",
  "DICE_TESTER_UIDS=",
  "MODERATION_ENABLED=false",
  "SENTRY_DSN=",
  "PRO_BLESSING_ENABLED=false",
  "PRO_BLESSING_TESTER_UIDS=",
  "PRO_BLESSING_LIMIT=1",
  "PRO_BLESSING_WINDOW_DAYS=1",
  "PRO_BLESSING_MIN_ACCOUNT_DAYS=1",
];

/**
 * Runs the "Write function parameters" step's script with bash in a temp dir.
 * Returns the written value of the switch (null when the step refused) and
 * the log.
 */
function writeParams(secretExtra: string[], variable?: string): { value: string | null; out: string } {
  const script = workflow.match(/- name: Write function parameters\n[\s\S]*?run: \|\n([\s\S]*?)\n\n/)?.[1];
  if (!script) throw new Error("Write function parameters step not found");
  const dir = mkdtempSync(join(tmpdir(), "deploy-switch-"));
  mkdirSync(join(dir, "functions"));
  writeFileSync(join(dir, "run.sh"), script.replace(/^ {10}/gm, ""));
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    PROJECT_ID: "p",
    FUNCTIONS_DOTENV: [...REQUIRED_SECRET, ...secretExtra].join("\n"),
  };
  if (variable !== undefined) env.OVR_GAME_VIDEO_RETENTION_ENABLED = variable;
  try {
    const out = execFileSync("bash", ["run.sh"], {
      cwd: dir,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const line = readFileSync(join(dir, "functions/.env.p"), "utf8").match(/^GAME_VIDEO_RETENTION_ENABLED=(.*)$/m);
    return { value: line?.[1] ?? "", out };
  } catch (err) {
    return { value: null, out: (err as { stdout: string }).stdout };
  }
}

describe("firebase-functions-deploy game video retention switch", () => {
  it("is a repository-variable override, not a fill-if-missing switch", () => {
    expect(overrideLoop).toContain("GAME_VIDEO_RETENTION_ENABLED");
    expect(fillLoop).not.toContain("GAME_VIDEO_RETENTION_ENABLED");
    expect(workflow).toContain("OVR_GAME_VIDEO_RETENTION_ENABLED: ${{ vars.GAME_VIDEO_RETENTION_ENABLED }}");
    expect(workflow).not.toContain("VAR_GAME_VIDEO_RETENTION_ENABLED");
  });

  it("prints the switch state in every deploy log", () => {
    expect(printLoop).toContain("GAME_VIDEO_RETENTION_ENABLED");
  });

  it("documents the switch in the parameter file block", () => {
    expect(docs).toContain("GAME_VIDEO_RETENTION_ENABLED=false");
  });

  it.each([
    ["no variable and no secret line", [], undefined, "false"],
    ["the variable on", [], "true", "true"],
    ["the variable off over a secret line that says on", ["GAME_VIDEO_RETENTION_ENABLED=true"], "false", "false"],
    ["a secret line and no variable", ["GAME_VIDEO_RETENTION_ENABLED=true"], undefined, "true"],
  ])("writes the switch for %s", (_label, secret, variable, expected) => {
    const { value, out } = writeParams(secret, variable);
    expect(value).toBe(expected);
    expect(out).toContain(`switch GAME_VIDEO_RETENTION: ${expected === "true" ? "ON" : "OFF"}`);
  });

  it.each([
    ["a variable that is not exactly true or false", [], "TRUE"],
    ["a secret line that is not exactly true or false", ["GAME_VIDEO_RETENTION_ENABLED=yes"], undefined],
    ["an uppercase secret line", ["GAME_VIDEO_RETENTION_ENABLED=TRUE"], undefined],
  ])("refuses the deploy for %s", (_label, secret, variable) => {
    const { value, out } = writeParams(secret, variable);
    expect(value).toBeNull();
    expect(out).toMatch(/GAME_VIDEO_RETENTION_ENABLED must be exactly true or false/);
  });
});
