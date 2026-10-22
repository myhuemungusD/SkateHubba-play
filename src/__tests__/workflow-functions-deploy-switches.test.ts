import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const workflow = readFileSync(resolve(root, ".github/workflows/firebase-functions-deploy.yml"), "utf8");
const docs = readFileSync(resolve(root, "docs/DEPLOY_FUNCTIONS.md"), "utf8");

/** The deploy step's "Fill switches the secret predates" loop. */
const fillLoop = workflow.match(/for key in (CLOSET_ENABLED[^;]*); do/)?.[1].split(" ") ?? [];
/** The "Print the on/off switches" loop (the last `for key in XP_ENABLED ...`). */
const printLoop = [...workflow.matchAll(/for key in (XP_ENABLED[^;]*); do\n\s+raw=/g)].at(-1)?.[1].split(" ") ?? [];

describe("firebase-functions-deploy game video retention switch", () => {
  it("fills GAME_VIDEO_RETENTION_ENABLED from a repo variable, defaulting to off", () => {
    expect(fillLoop).toContain("GAME_VIDEO_RETENTION_ENABLED");
    expect(workflow).toContain("VAR_GAME_VIDEO_RETENTION_ENABLED: ${{ vars.GAME_VIDEO_RETENTION_ENABLED }}");
    expect(workflow).toMatch(/val=\$\(printf '%s' "\$\{!var:-false\}"/);
  });

  it("prints the switch state in every deploy log", () => {
    expect(printLoop).toContain("GAME_VIDEO_RETENTION_ENABLED");
  });

  it("documents the switch in the parameter file block", () => {
    expect(docs).toContain("GAME_VIDEO_RETENTION_ENABLED=false");
  });
});
