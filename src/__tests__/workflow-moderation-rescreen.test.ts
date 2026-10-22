/**
 * Policy guard for .github/workflows/moderation-rescreen.yml: no key file,
 * WIF only, dry run by default, apply gated on confirm=rescreen and main.
 * The "Check inputs" bash is extracted and run for real.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const WORKFLOW = readFileSync(resolve(__dirname, "../../.github/workflows/moderation-rescreen.yml"), "utf-8");

function checkInputsScript(): string {
  const start = WORKFLOW.indexOf("      - name: Check inputs");
  const end = WORKFLOW.indexOf("      - uses: actions/checkout", start);
  const block = WORKFLOW.slice(start, end);
  const body = block.slice(block.indexOf("        run: |\n") + "        run: |\n".length);
  return body
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
}

function check(env: Record<string, string>) {
  const r = spawnSync("bash", ["-c", checkInputsScript()], {
    encoding: "utf-8",
    env: {
      PATH: process.env.PATH ?? "",
      MODE: "dry-run",
      LIMIT: "1",
      DELAY_MS: "5000",
      CONFIRM: "",
      REF: "refs/heads/main",
      ...env,
    },
  });
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe("moderation-rescreen.yml policy", () => {
  it("is manual only, one run at a time, never cancelled mid-run", () => {
    expect(WORKFLOW).toMatch(/^on:\n {2}workflow_dispatch:\n/m);
    expect(WORKFLOW).not.toMatch(/^\s*(schedule|push|pull_request):/m);
    expect(WORKFLOW).toContain("concurrency:\n  group: moderation-rescreen\n  cancel-in-progress: false");
  });

  it("defaults to a dry run of one clip", () => {
    expect(WORKFLOW).toMatch(/mode:\n(?:.*\n)*? {8}default: dry-run\n/);
    expect(WORKFLOW).toMatch(/limit:\n(?:.*\n)*? {8}default: "1"\n/);
  });

  it("uses least privilege and the deploy workflow's WIF auth, with no key file or token fallback", () => {
    expect(WORKFLOW).toContain("permissions:\n  contents: read\n");
    expect(WORKFLOW).toContain("    permissions:\n      contents: read\n      id-token: write\n    steps:");
    expect(WORKFLOW).toContain("    environment: production\n");
    const deploy = readFileSync(resolve(__dirname, "../../.github/workflows/firebase-functions-deploy.yml"), "utf-8");
    const authPin = /uses: (google-github-actions\/auth@[0-9a-f]{40})/.exec(deploy)?.[1];
    expect(authPin).toBeTruthy();
    expect(WORKFLOW).toContain(`uses: ${authPin}`);
    expect(WORKFLOW).toContain("workload_identity_provider: ${{ secrets.FIREBASE_WIF_PROVIDER }}");
    expect(WORKFLOW).toContain("service_account: ${{ secrets.FIREBASE_WIF_SERVICE_ACCOUNT }}");
    expect(WORKFLOW).not.toContain("secrets.FIREBASE_TOKEN");
    expect(WORKFLOW).not.toMatch(/credentials_json|GOOGLE_APPLICATION_CREDENTIALS:/);
    expect(WORKFLOW).not.toMatch(/^\s*continue-on-error:/m);
  });

  it("pins every action to a full commit SHA", () => {
    const uses = [...WORKFLOW.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) expect(ref).toMatch(/@[0-9a-f]{40}$/);
  });

  it("never interpolates inputs straight into a shell script", () => {
    const runBlocks = WORKFLOW.split("        run: |").slice(1);
    for (const block of runBlocks) {
      const script = block.split(/\n {6}- /)[0];
      expect(script).not.toMatch(/\$\{\{\s*(inputs|github\.event)/);
    }
  });

  it("sets MODERATION_ENABLED=true only for apply, and uploads the log as the rescreen artifact", () => {
    expect(WORKFLOW).toMatch(
      /if \[ "\$MODE" = "apply" \]; then\n(?:.*\n)*? +export MODERATION_ENABLED=true\n(?:.*\n)*? +ARGS=\(--apply/,
    );
    expect(WORKFLOW).toContain("name: rescreen\n");
    expect(WORKFLOW).toContain("GITHUB_STEP_SUMMARY");
  });

  describe("Check inputs step", () => {
    it("passes a default dry run on main", () => {
      const r = check({});
      expect(r.status).toBe(0);
      expect(r.out).toContain("Mode dry-run, limit 1, delay 5000 ms.");
    });

    it("refuses apply without confirm=rescreen", () => {
      expect(check({ MODE: "apply" }).out).toContain("The confirm input must be the word rescreen");
      expect(check({ MODE: "apply", CONFIRM: "RESCREEN" }).status).toBe(1);
      expect(check({ MODE: "apply", CONFIRM: "rescreen", LIMIT: "25" }).status).toBe(0);
    });

    it("refuses any branch but main, in both modes", () => {
      expect(check({ REF: "refs/heads/fix/x" }).out).toContain("Run this workflow from the main branch");
      expect(check({ MODE: "apply", CONFIRM: "rescreen", REF: "refs/heads/fix/x" }).status).toBe(1);
    });

    it("refuses unknown modes and out-of-range numbers", () => {
      expect(check({ MODE: "force" }).status).toBe(1);
      for (const LIMIT of ["0", "51", "1.5", "-1", "", "1;id"]) expect(check({ LIMIT }).status).toBe(1);
      for (const DELAY_MS of ["600001", "-5", "abc", ""]) expect(check({ DELAY_MS }).status).toBe(1);
      expect(check({ DELAY_MS: "0", LIMIT: "50" }).status).toBe(0);
    });
  });
});
