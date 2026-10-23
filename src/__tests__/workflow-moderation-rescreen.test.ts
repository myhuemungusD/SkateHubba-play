/**
 * Policy guard for .github/workflows/moderation-rescreen.yml: no key file,
 * WIF only, dry run by default, apply gated on confirm=rescreen and main.
 * Apply also needs production moderation ON (resolved like the deploy: the
 * MODERATION_ENABLED repository variable wins when set, else the
 * FUNCTIONS_DOTENV line; never hard-coded), and CI output is redacted. The
 * "Check inputs" and "Resolve moderation switch" bash is extracted and run for
 * real, and the switch is checked against the deploy's own "Write function
 * parameters" step, also run for real.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const WORKFLOW = readFileSync(resolve(__dirname, "../../.github/workflows/moderation-rescreen.yml"), "utf-8");
const DEPLOY = readFileSync(resolve(__dirname, "../../.github/workflows/firebase-functions-deploy.yml"), "utf-8");

/** The `run: |` body of the named step, dedented. Ends at the next step or step comment. */
function stepScript(name: string, workflow = WORKFLOW): string {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
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
    const authPin = /uses: (google-github-actions\/auth@[0-9a-f]{40})/.exec(DEPLOY)?.[1];
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

  it("never hard-codes MODERATION_ENABLED: apply passes through the value resolved like the deploy", () => {
    expect(WORKFLOW).not.toMatch(/^\s*(export\s+)?MODERATION_ENABLED\s*[=:]\s*["']?true/im);
    // Same inputs, under the same names, as the deploy's "Write function parameters" step.
    for (const line of [
      "FUNCTIONS_DOTENV: ${{ secrets.FUNCTIONS_DOTENV }}",
      "OVR_MODERATION_ENABLED: ${{ vars.MODERATION_ENABLED }}",
    ]) {
      expect(DEPLOY).toContain(line);
      expect(WORKFLOW).toContain(line);
    }
    // The deploy still lets the variable replace the secret's line; if that changes, so must the rescreen.
    expect(DEPLOY).toContain(
      "for key in XP_ENABLED DICE_ENABLED MODERATION_ENABLED PRO_BLESSING_ENABLED; do\n            ovr=",
    );
    expect(WORKFLOW).toContain("SWITCH: ${{ steps.switch.outputs.moderation }}");
    expect(WORKFLOW).toMatch(
      /if \[ "\$MODE" = "apply" \]; then\n(?:.*\n)*? +export MODERATION_ENABLED="\$SWITCH"\n(?:.*\n)*? +ARGS=\(--apply/,
    );
    // Both jobs see the same environment-scoped vars and secrets.
    expect(DEPLOY).toContain("    environment: production\n");
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
    /** Every key the deploy requires, so the deploy step itself can run on it. */
    const dotenv = (value: string | null) =>
      [
        "XP_ENABLED=true",
        "XP_TESTER_UIDS=",
        "DICE_ENABLED=false",
        "DICE_TESTER_UIDS=",
        `SENTRY_DSN=${SECRET_DSN}`,
        "PRO_BLESSING_ENABLED=false",
        "PRO_BLESSING_TESTER_UIDS=",
        "PRO_BLESSING_LIMIT=3",
        "PRO_BLESSING_WINDOW_DAYS=30",
        "PRO_BLESSING_MIN_ACCOUNT_DAYS=7",
        ...(value === null ? [] : [`MODERATION_ENABLED=${value}`]),
      ].join("\n");
    const VAR = "repository variable MODERATION_ENABLED, which overrides FUNCTIONS_DOTENV";
    const SECRET = "FUNCTIONS_DOTENV; repository variable MODERATION_ENABLED unset";

    it("allows apply when the secret says true and the variable is unset, and prints only the switch", () => {
      const r = resolveSwitch({ FUNCTIONS_DOTENV: dotenv("true") });
      expect(r.status).toBe(0);
      expect(r.output).toBe("moderation=true\n");
      expect(r.log).toContain(`MODERATION_ENABLED=true (${SECRET})`);
      expect(r.log).not.toContain(SECRET_DSN);
      expect(r.log).not.toContain("XP_ENABLED");
    });

    it("var true wins over secret false, or over a secret with no MODERATION_ENABLED line", () => {
      for (const FUNCTIONS_DOTENV of [dotenv("false"), dotenv(null), dotenv("junk")]) {
        const r = resolveSwitch({ FUNCTIONS_DOTENV, OVR_MODERATION_ENABLED: "true" });
        expect(r.status).toBe(0);
        expect(r.output).toBe("moderation=true\n");
        expect(r.log).toContain(`MODERATION_ENABLED=true (${VAR})`);
      }
      // Whitespace is stripped from the variable, as in the deploy.
      expect(resolveSwitch({ FUNCTIONS_DOTENV: dotenv("false"), OVR_MODERATION_ENABLED: " true\n" }).status).toBe(0);
    });

    it("var false refuses apply even when the secret says true", () => {
      const r = resolveSwitch({ FUNCTIONS_DOTENV: dotenv("true"), OVR_MODERATION_ENABLED: "false" });
      expect(r.status).toBe(2);
      expect(r.output).toBe("moderation=false\n");
      expect(r.log).toContain(
        `Refusing to apply: production moderation is not ON (MODERATION_ENABLED=false from ${VAR})`,
      );
    });

    it("var invalid refuses apply, case-sensitive like the deploy, without echoing it", () => {
      for (const OVR_MODERATION_ENABLED of ["TRUE", "True", "1", "yes-please-secret", " "]) {
        const r = resolveSwitch({ FUNCTIONS_DOTENV: dotenv("true"), OVR_MODERATION_ENABLED });
        expect(r.status).toBe(2);
        expect(r.output).toBe("moderation=false\n");
        expect(r.log).toContain(`MODERATION_ENABLED=(not exactly true or false) from ${VAR}`);
        expect(r.log).not.toContain("yes-please-secret");
      }
    });

    it("var unset uses the secret's first line, whitespace and CRLF stripped", () => {
      expect(resolveSwitch({ FUNCTIONS_DOTENV: dotenv(" true\r") }).status).toBe(0);
      expect(resolveSwitch({ FUNCTIONS_DOTENV: `${dotenv("true")}\nMODERATION_ENABLED=false` }).status).toBe(0);
      const off = resolveSwitch({ FUNCTIONS_DOTENV: dotenv("false"), OVR_MODERATION_ENABLED: "" });
      expect(off.status).toBe(2);
      expect(off.log).toContain(`(MODERATION_ENABLED=false from ${SECRET})`);
      // TRUE passes the deploy's validation but deploys OFF (case-sensitive defineBoolean), so it is off here.
      const upper = resolveSwitch({ FUNCTIONS_DOTENV: dotenv("TRUE") });
      expect(upper.status).toBe(2);
      expect(upper.log).toContain("(not exactly true or false)");
      const junk = resolveSwitch({ FUNCTIONS_DOTENV: dotenv("yes-please-secret") });
      expect(junk.status).toBe(2);
      expect(junk.log).not.toContain("yes-please-secret");
    });

    it("both missing refuses apply (exit 2), and an empty secret refuses even with var true", () => {
      const missingCases: Array<Record<string, string>> = [
        {},
        { FUNCTIONS_DOTENV: dotenv(null) },
        { FUNCTIONS_DOTENV: dotenv("") },
      ];
      for (const env of missingCases) {
        const r = resolveSwitch(env);
        expect(r.status).toBe(2);
        expect(r.output).toBe("moderation=false\n");
        expect(r.log).toContain("MODERATION_ENABLED=(missing)");
      }
      const empty = resolveSwitch({ FUNCTIONS_DOTENV: "", OVR_MODERATION_ENABLED: "true" });
      expect(empty.status).toBe(2);
      expect(empty.log).toContain("FUNCTIONS_DOTENV is empty, so no deploy could run");
    });

    it("still allows a dry run with moderation off, missing or invalid", () => {
      const offCases: Array<Record<string, string>> = [
        {},
        { FUNCTIONS_DOTENV: dotenv("false") },
        { FUNCTIONS_DOTENV: dotenv(null) },
        { FUNCTIONS_DOTENV: dotenv("true"), OVR_MODERATION_ENABLED: "false" },
        { FUNCTIONS_DOTENV: dotenv("true"), OVR_MODERATION_ENABLED: "nope" },
      ];
      for (const env of offCases) {
        const r = resolveSwitch({ MODE: "dry-run", ...env });
        expect(r.status).toBe(0);
        expect(r.output).toBe("moderation=false\n");
        expect(r.log).toContain("Dry run only.");
      }
    });

    /** Runs the deploy's real "Write function parameters" step: ON only if it succeeds and logs ON. */
    function deployState(env: Record<string, string>): boolean {
      const dir = mkdtempSync(join(tmpdir(), "deploy-params-"));
      try {
        mkdirSync(join(dir, "functions"));
        const r = spawnSync("bash", ["-c", stepScript("Write function parameters", DEPLOY)], {
          cwd: dir,
          encoding: "utf-8",
          env: { PATH: process.env.PATH ?? "", PROJECT_ID: "demo-parity", ...env },
        });
        return r.status === 0 && `${r.stdout}`.includes("switch MODERATION: ON");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it("matches the deploy step exactly: apply is allowed only when the deploy would deploy moderation ON", () => {
      const vars = [undefined, "true", "false", " true\n", "TRUE", "1", " "];
      const lines = [null, "true", "false", " true\r", "TRUE", "yes", ""];
      let on = 0;
      for (const v of vars) {
        for (const line of lines) {
          const env: Record<string, string> = { FUNCTIONS_DOTENV: dotenv(line) };
          if (v !== undefined) env.OVR_MODERATION_ENABLED = v;
          const expected = deployState(env);
          if (expected) on += 1;
          expect({ v, line, allowed: resolveSwitch(env).status === 0 }).toEqual({ v, line, allowed: expected });
        }
      }
      // Sanity: the matrix has both outcomes (var true/" true" over every line, plus the two secret-true cases).
      expect(on).toBe(2 * lines.length + 2);
      // ~100 real bash runs; the default 5 s is too tight on a loaded CI runner with coverage on.
    }, 60_000);
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
