/**
 * Unit coverage for scripts/check-test-duplication.mjs.
 *
 * The script is a Node CLI, not an importable module, so these tests invoke it
 * via child_process against a temp directory of synthetic test files. This
 * keeps the coverage decoupled from the real repo's ever-changing baseline.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = resolve(__dirname, "../../scripts/check-test-duplication.mjs");

/**
 * Run the duplication script against an isolated fixture dir. The script is
 * hard-coded to scan ./src, ./e2e, ./rules-tests relative to the repo, so we
 * spawn it with `cwd` pointing at our fixture root but also override the
 * module URL by copying the script into the fixture — simplest is to just
 * invoke the script directly with its own REPO_ROOT expectation. We do so by
 * running it with cwd set to fixture and then feeding fake test files at
 * fixture/src/*.test.ts. The script resolves REPO_ROOT via import.meta.url,
 * which points at the real scripts/ dir, so we instead COPY the script into
 * the fixture to neutralize that.
 */
function runScript(fixtureRoot: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [join(fixtureRoot, "scripts/check-test-duplication.mjs"), ...args], {
    cwd: fixtureRoot,
    encoding: "utf-8",
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function seedFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "dup-gate-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  // Copy the real script so import.meta.url's parent (the fixture's scripts/)
  // becomes the REPO_ROOT it walks.
  const scriptSrc = readFileSync(SCRIPT, "utf-8");
  writeFileSync(join(dir, "scripts/check-test-duplication.mjs"), scriptSrc);
  return dir;
}

describe("check-test-duplication.mjs", () => {
  let fixture: string;

  beforeEach(() => {
    fixture = seedFixture();
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it("passes when no test files duplicate a block", () => {
    writeFileSync(
      join(fixture, "src/a.test.ts"),
      [
        'describe("a", () => {',
        '  it("adds", () => {',
        "    const x = 1;",
        "    const y = 2;",
        "    expect(x + y).toBe(3);",
        "  });",
        "});",
      ].join("\n"),
    );
    writeFileSync(
      join(fixture, "src/b.test.ts"),
      [
        'describe("b", () => {',
        '  it("multiplies", () => {',
        "    const p = 4;",
        "    const q = 5;",
        "    expect(p * q).toBe(20);",
        "  });",
        "});",
      ].join("\n"),
    );
    const res = runScript(fixture);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/clean/);
  });

  it("detects a duplicate block across two test files and exits 1", () => {
    const shared = [
      "    const user = { id: 'u1', email: 'x@y' };",
      "    const token = 'abc';",
      "    const session = { user, token, ts: 1 };",
      "    await store.save(session);",
      "    const loaded = await store.load(session.id);",
      "    expect(loaded).toEqual(session);",
    ].join("\n");
    writeFileSync(
      join(fixture, "src/one.test.ts"),
      `describe("one", () => { it("runs", async () => {\n${shared}\n}); });\n`,
    );
    writeFileSync(
      join(fixture, "src/two.test.ts"),
      `describe("two", () => { it("runs", async () => {\n${shared}\n}); });\n`,
    );
    const res = runScript(fixture);
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/Duplicate/);
    expect(res.stdout).toMatch(/one\.test\.ts/);
    expect(res.stdout).toMatch(/two\.test\.ts/);
  });

  it("respects baseline so existing duplication does not fail the gate", () => {
    const shared = [
      "    const a = computeThing();",
      "    const b = transformThing(a);",
      "    const c = await persist(b);",
      "    expect(c.ok).toBe(true);",
      "    expect(c.value).toEqual(b);",
      "    expect(c.ts).toBeGreaterThan(0);",
    ].join("\n");
    writeFileSync(join(fixture, "src/x.test.ts"), `it("x", async () => {\n${shared}\n});\n`);
    writeFileSync(join(fixture, "src/y.test.ts"), `it("y", async () => {\n${shared}\n});\n`);

    // First run fails (no baseline yet).
    expect(runScript(fixture).status).toBe(1);

    // Snapshot baseline — now the same duplication is ignored.
    const seed = runScript(fixture, ["--update-baseline"]);
    expect(seed.status).toBe(0);
    const after = runScript(fixture);
    expect(after.status).toBe(0);
    expect(after.stdout).toMatch(/baseline duplicate/);
  });

  it("warns when baseline entries are no longer seen (drift)", () => {
    const driftShared = [
      "    const drift1 = makeDriftInput();",
      "    const drift2 = transformDrift(drift1);",
      "    const drift3 = await commitDrift(drift2);",
      "    expect(drift3.committed).toBe(true);",
      "    expect(drift3.payload).toEqual(drift2);",
      "    expect(drift3.version).toBeGreaterThan(0);",
    ].join("\n");
    writeFileSync(join(fixture, "src/drift-a.test.ts"), `it("a", async () => {\n${driftShared}\n});\n`);
    writeFileSync(join(fixture, "src/drift-b.test.ts"), `it("b", async () => {\n${driftShared}\n});\n`);
    // Seed the baseline with the current duplication.
    expect(runScript(fixture, ["--update-baseline"]).status).toBe(0);
    // Delete one of the duplicates — the baseline is now stale.
    rmSync(join(fixture, "src/drift-b.test.ts"));
    const res = runScript(fixture);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/no longer seen/);
  });

  it("fails with a clear message when the baseline file is malformed", () => {
    writeFileSync(
      join(fixture, "src/ok.test.ts"),
      [
        'describe("ok", () => {',
        '  it("runs", () => {',
        "    const x = 1;",
        "    expect(x).toBe(1);",
        "  });",
        "});",
      ].join("\n"),
    );
    // Seed a baseline that is valid JSON but structurally wrong.
    writeFileSync(join(fixture, "scripts/test-duplication-baseline.json"), JSON.stringify({ nope: "not an array" }));
    const res = runScript(fixture);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/malformed/);
    expect(res.stderr).toMatch(/--update-baseline/);
  });

  it("fails when baseline hashes array contains non-strings", () => {
    writeFileSync(join(fixture, "src/ok.test.ts"), "export const x = 1;\n");
    writeFileSync(
      join(fixture, "scripts/test-duplication-baseline.json"),
      JSON.stringify({ hashes: ["valid-hash", 42] }),
    );
    const res = runScript(fixture);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/array of strings/);
  });

  it("emits JSON when --json flag is passed", () => {
    const shared = [
      "    const x1 = 'foo-bar-baz';",
      "    const x2 = 'qux-quux';",
      "    const x3 = compute(x1, x2);",
      "    const x4 = await save(x3);",
      "    expect(x4).toBeTruthy();",
      "    expect(x4.id).toMatch(/[a-z]+/);",
    ].join("\n");
    writeFileSync(join(fixture, "src/j1.test.ts"), `it("j1", async () => {\n${shared}\n});\n`);
    writeFileSync(join(fixture, "src/j2.test.ts"), `it("j2", async () => {\n${shared}\n});\n`);
    const res = runScript(fixture, ["--json", "--no-baseline"]);
    expect(res.status).toBe(1);
    const parsed = JSON.parse(res.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].count).toBeGreaterThanOrEqual(2);
  });
});
