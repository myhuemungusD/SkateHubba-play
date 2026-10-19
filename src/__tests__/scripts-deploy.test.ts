/** Unit coverage for scripts/deploy.mjs (all side effects injected). */
import { describe, it, expect, vi } from "vitest";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script, no types
import * as d from "../../scripts/deploy.mjs";

const ROOT = resolve(__dirname, "../..");
const PARAMS = "/p/functions.env";
const DOTENV = join(ROOT, "functions", ".env.sk8hub-d7806");
const STATE = "/state/last-rules-deploy.sk8hub-d7806";

function goodParams(): string {
  return Object.entries(d.definedParams(ROOT) as Record<string, string>)
    .map(([k, t]) => `${k}=${t === "Boolean" ? "false" : t === "Int" ? "2" : ""}`)
    .join("\n");
}

function harness(
  over: {
    branch?: string;
    dirty?: string;
    behind?: boolean;
    fail?: string;
    files?: Record<string, string>;
    rulesDiff?: number;
  } = {},
) {
  const files: Record<string, string> = { [PARAMS]: goodParams(), ...over.files };
  const calls: string[] = [];
  let signal: (() => void) | null = null;
  const x = {
    run: vi.fn((cmd: string, args: string[]) => {
      const line = `${cmd} ${args.join(" ")}`;
      calls.push(line);
      if (line === "git rev-parse --abbrev-ref HEAD") return { status: 0, stdout: over.branch ?? "main" };
      if (line === "git status --porcelain") return { status: 0, stdout: over.dirty ?? "" };
      if (line === "git rev-parse HEAD") return { status: 0, stdout: "abc12345ffff" };
      if (line === "git rev-parse origin/main") return { status: 0, stdout: over.behind ? "zzz" : "abc12345ffff" };
      if (line.startsWith("git diff --quiet")) return { status: over.rulesDiff ?? 0, stdout: "" };
      if (over.fail && line.includes(over.fail)) {
        if (signal) signal();
        return { status: 1, stdout: "" };
      }
      return { status: 0, stdout: "" };
    }),
    exists: vi.fn((p: string) => p in files),
    read: vi.fn((p: string) => files[p]),
    write: vi.fn((p: string, t: string) => (files[p] = t)),
    copy: vi.fn((a: string, b: string) => (files[b] = files[a])),
    remove: vi.fn((p: string) => delete files[p]),
    log: vi.fn(),
    error: vi.fn(),
    onSignal: vi.fn((fn: () => void) => (signal = fn)),
  };
  const env = { SKATEHUBBA_FUNCTIONS_ENV: PARAMS, SKATEHUBBA_STATE_DIR: "/state" };
  const out = () => x.log.mock.calls.flat().join("\n");
  return { x, env, files, calls, out };
}

describe("deploy.mjs helpers", () => {
  it("parses args and builds --only", () => {
    expect(d.parseArgs(["functions", "--dry-run"])).toEqual({ target: "functions", dryRun: true, only: "" });
    expect(() => d.parseArgs(["nope"])).toThrow(/usage/);
    expect(() => d.parseArgs(["rules", "--only", "a"])).toThrow(/functions/);
    expect(d.onlyFlag({ target: "functions", only: "a, b" })).toBe("functions:a,functions:b");
    expect(d.onlyFlag({ target: "rules", only: "" })).toBe("firestore:rules,firestore:indexes,storage");
    expect(d.onlyFlag({ target: "all", only: "" })).toBe("functions,firestore:rules,firestore:indexes,storage");
  });

  it("finds params and validates values", () => {
    const defined = d.definedParams(ROOT);
    expect(defined.MAP_TESTER_UIDS).toBe("String");
    expect(defined.XP_ENABLED).toBe("Boolean");
    expect(defined.PRO_BLESSING_LIMIT).toBe("Int");
    expect(d.validateParams({ A: "yes", B: "x" }, { A: "Boolean", B: "Int", C: "String" })).toEqual([
      "A must be true or false",
      "B must be a whole number",
      expect.stringContaining("C is missing"),
    ]);
  });
});

describe("deploy.mjs main", () => {
  it("bad args exit 2", () => {
    const h = harness();
    expect(d.main([], h.x, h.env, ROOT)).toBe(2);
  });

  it("functions deploy: checks, copies params, deploys, deletes dotenv", () => {
    const h = harness();
    expect(d.main(["functions", "--only", "mapCheckin"], h.x, h.env, ROOT)).toBe(0);
    expect(h.calls).toContain("npm run typecheck");
    expect(h.calls).toContain("npm --prefix functions test");
    expect(h.calls).toContain(
      "npx firebase deploy --only functions:mapCheckin --project sk8hub-d7806 --non-interactive --force",
    );
    expect(h.x.copy).toHaveBeenCalledWith(PARAMS, DOTENV);
    expect(DOTENV in h.files).toBe(false);
    expect(h.out()).toContain("temp params file removed");
  });

  it("deletes the dotenv even when the deploy fails or is interrupted", () => {
    const h = harness({ fail: "firebase deploy" });
    expect(d.main(["functions"], h.x, h.env, ROOT)).toBe(1);
    expect(DOTENV in h.files).toBe(false);
  });

  it("dry run never writes the dotenv or deploys", () => {
    const h = harness();
    expect(d.main(["all", "--dry-run"], h.x, h.env, ROOT)).toBe(0);
    expect(h.x.copy).not.toHaveBeenCalled();
    expect(h.calls.some((c) => c.includes("firebase deploy"))).toBe(false);
    expect(h.out()).toContain("would run: npx firebase deploy --only functions,firestore:rules");
  });

  it.each([
    [{ branch: "feat" }, "deploy only from main"],
    [{ dirty: " M x" }, "uncommitted"],
    [{ behind: true }, "pull first"],
    [{ files: { [PARAMS]: "XP_ENABLED=maybe" } }, "must be true or false"],
    [{ fail: "functions test" }, "functions tests failed"],
  ])("refuses %o", (over, msg) => {
    const h = harness(over);
    expect(d.main(["functions"], h.x, h.env, ROOT)).toBe(1);
    expect(h.out()).toContain(msg);
  });

  it("missing params file fails", () => {
    const h = harness();
    delete h.files[PARAMS];
    expect(d.main(["functions"], h.x, h.env, ROOT)).toBe(1);
    expect(h.out()).toContain("params file not found");
  });

  it("rules: runs rules tests without a record, records the deploy, skips when unchanged", () => {
    const h = harness();
    expect(d.main(["rules"], h.x, h.env, ROOT)).toBe(0);
    expect(h.calls).toContain("npm run test:rules");
    expect(h.files[STATE]).toBe("abc12345ffff\n");
    expect(h.calls).not.toContain("npm --prefix functions test");

    const again = harness({ files: { [STATE]: "abc12345ffff" } });
    expect(d.main(["rules"], again.x, again.env, ROOT)).toBe(0);
    expect(again.calls).not.toContain("npm run test:rules");

    const changed = harness({ files: { [STATE]: "old" }, rulesDiff: 1 });
    expect(d.main(["rules"], changed.x, changed.env, ROOT)).toBe(0);
    expect(changed.calls).toContain("npm run test:rules");
  });
});
