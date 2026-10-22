/**
 * Policy guard for .github/workflows/moderation-rescreen.yml: no key file,
 * WIF only, dry run by default, apply gated on confirm=rescreen and main.
 * Apply also needs production moderation ON (derived like the deploy, never
 * hard-coded), and CI output is redacted. The "Check inputs" and "Resolve
 * moderation switch" bash is extracted and run for real.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const WORKFLOW = readFileSync(resolve(__dirname, "../../.github/workflows/moderation-rescreen.yml"), "utf-8");

/** The `run: |` body of the named step, dedented. Ends at the next step or step comment. */
function stepScript(name: string): string {
  const start = WORKFLOW.indexOf(`      - name: ${name}\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = WORKFLOW.slice(start + 1);
  const next = rest.search(/^ {6}(- |# )/m);
  const block = next === -1 ? rest : rest.slice(0, next);
  const body = block.slice(block.indexOf("        run: |\n") + "        run: |\n".length);
  return body
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
}

function check(env: Record<string, string>) {
  const r = spawnSync("bash", ["-c", stepScript("Check inputs")], {
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

  it("never puts ${{ secrets.* }} inline in a shell script", () => {
    const runBlocks = WORKFLOW.split("        run: |").slice(1);
    for (const block of runBlocks) {
      const script = block.split(/\n {6}- /)[0];
      expect(script).not.toMatch(/\$\{\{\s*secrets\./);
    }
    expect(WORKFLOW).toContain("FIREBASE_PROJECT_ID: ${{ secrets.FIREBASE_PROJECT_ID }}");
  });

  it("never hard-codes MODERATION_ENABLED: apply passes through the value derived from FUNCTIONS_DOTENV only", () => {
    expect(WORKFLOW).not.toMatch(/^\s*(export\s+)?MODERATION_ENABLED\s*[=:]\s*["']?true/im);
    expect(WORKFLOW).toContain("FUNCTIONS_DOTENV: ${{ secrets.FUNCTIONS_DOTENV }}");
    // The deploy requires MODERATION_ENABLED= in FUNCTIONS_DOTENV and never reads a variable for it.
    expect(WORKFLOW).not.toMatch(/vars\.MODERATION_ENABLED|VAR_MODERATION_ENABLED/);
    expect(WORKFLOW).toContain("SWITCH: ${{ steps.switch.outputs.moderation }}");
    expect(WORKFLOW).toMatch(
      /if \[ "\$MODE" = "apply" \]; then\n(?:.*\n)*? +export MODERATION_ENABLED="\$SWITCH"\n(?:.*\n)*? +ARGS=\(--apply/,
    );
    // Same parse as the deploy: first KEY= line, whitespace stripped, lowercased.
    const deploy = readFileSync(resolve(__dirname, "../../.github/workflows/firebase-functions-deploy.yml"), "utf-8");
    expect(deploy).toContain("| head -n 1 | cut -d= -f2- | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]'");
    expect(stepScript("Resolve moderation switch")).toContain("grep -E '^MODERATION_ENABLED=' | head -n 1");
    // Checked before any install, so a refused apply costs nothing.
    expect(WORKFLOW.indexOf("- name: Resolve moderation switch")).toBeLessThan(
      WORKFLOW.indexOf("- uses: actions/checkout"),
    );
  });

  it("runs redacted: --redact, a counts-only job summary, and the redacted log as the rescreen artifact", () => {
    expect(WORKFLOW).toMatch(/ARGS=\(--redact .*--log "\$LOG_DIR\/rescreen\.md" --summary "\$LOG_DIR\/summary\.md"\)/);
    const summary = stepScript("Job summary");
    expect(summary).toContain('cat "$SUMMARY"');
    expect(summary).not.toContain("$LOG");
    expect(WORKFLOW).toContain("name: rescreen\n");
    expect(WORKFLOW).toContain("path: ${{ steps.run.outputs.log }}");
  });

  describe("Resolve moderation switch step", () => {
    const SECRET_DSN = "https://0123456789abcdef@o1.ingest.sentry.io/42";
    function resolveSwitch(env: Record<string, string>) {
      const dir = mkdtempSync(join(tmpdir(), "rescreen-switch-"));
      const out = join(dir, "out");
      try {
        const r = spawnSync("bash", ["-c", stepScript("Resolve moderation switch")], {
          encoding: "utf-8",
          env: { PATH: process.env.PATH ?? "", MODE: "apply", GITHUB_OUTPUT: out, ...env },
        });
        let output = "";
        try {
          output = readFileSync(out, "utf-8");
        } catch {
          output = "";
        }
        return { status: r.status ?? -1, log: `${r.stdout}${r.stderr}`, output };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    const dotenv = (value: string | null) =>
      ["XP_ENABLED=true", `SENTRY_DSN=${SECRET_DSN}`, ...(value === null ? [] : [`MODERATION_ENABLED=${value}`])].join(
        "\n",
      );

    it("allows apply when FUNCTIONS_DOTENV says true, and prints only the switch", () => {
      const r = resolveSwitch({ FUNCTIONS_DOTENV: dotenv("true") });
      expect(r.status).toBe(0);
      expect(r.output).toBe("moderation=true\n");
      expect(r.log).toContain("MODERATION_ENABLED=true (FUNCTIONS_DOTENV)");
      expect(r.log).not.toContain(SECRET_DSN);
      expect(r.log).not.toContain("XP_ENABLED");
    });

    it("parses like the deploy (whitespace, CRLF, case) and refuses apply when FUNCTIONS_DOTENV says false", () => {
      expect(resolveSwitch({ FUNCTIONS_DOTENV: dotenv(" TRUE\r") }).status).toBe(0);
      const r = resolveSwitch({ FUNCTIONS_DOTENV: dotenv("false") });
      expect(r.status).toBe(2);
      expect(r.output).toBe("moderation=false\n");
      expect(r.log).toContain(
        "Refusing to apply: production moderation is not ON (MODERATION_ENABLED=false in FUNCTIONS_DOTENV)",
      );
    });

    it("has no vars fallback: vars=true but no FUNCTIONS_DOTENV line refuses apply", () => {
      for (const FUNCTIONS_DOTENV of [dotenv(null), ""]) {
        const r = resolveSwitch({ FUNCTIONS_DOTENV, VAR_MODERATION_ENABLED: "true", MODERATION_ENABLED: "true" });
        expect(r.status).toBe(2);
        expect(r.output).toBe("moderation=false\n");
        expect(r.log).toContain("MODERATION_ENABLED=(missing) in FUNCTIONS_DOTENV");
      }
    });

    it("refuses apply (exit 2) when the switch is missing or not a boolean, without echoing the value", () => {
      const missing = resolveSwitch({});
      expect(missing.status).toBe(2);
      expect(missing.log).toContain("MODERATION_ENABLED=(missing) in FUNCTIONS_DOTENV");
      const junk = resolveSwitch({ FUNCTIONS_DOTENV: dotenv("yes-please-secret") });
      expect(junk.status).toBe(2);
      expect(junk.log).toContain("(not true or false)");
      expect(junk.log).not.toContain("yes-please-secret");
    });

    it("still allows a dry run with moderation off or missing", () => {
      const offCases: Array<Record<string, string>> = [
        {},
        { FUNCTIONS_DOTENV: dotenv("false") },
        { FUNCTIONS_DOTENV: dotenv(null) },
      ];
      for (const env of offCases) {
        const r = resolveSwitch({ MODE: "dry-run", ...env });
        expect(r.status).toBe(0);
        expect(r.output).toBe("moderation=false\n");
        expect(r.log).toContain("Dry run only.");
      }
    });
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
