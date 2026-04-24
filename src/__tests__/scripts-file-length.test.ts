/**
 * Unit coverage for scripts/check-file-length.mjs.
 *
 * Runs the script against a synthetic fixture with files above, at, and below
 * the configured budgets to confirm reporting and --strict exit semantics.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = resolve(__dirname, "../../scripts/check-file-length.mjs");

function runScript(fixtureRoot: string, args: string[] = []) {
  const r = spawnSync("node", [join(fixtureRoot, "scripts/check-file-length.mjs"), ...args], {
    cwd: fixtureRoot,
    encoding: "utf-8",
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function seedFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "file-len-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "src/services"), { recursive: true });
  mkdirSync(join(dir, "src/screens"), { recursive: true });
  mkdirSync(join(dir, "src/components"), { recursive: true });
  const scriptSrc = readFileSync(SCRIPT, "utf-8");
  writeFileSync(join(dir, "scripts/check-file-length.mjs"), scriptSrc);
  return dir;
}

function longFile(loc: number): string {
  const lines: string[] = [];
  for (let i = 0; i < loc; i++) lines.push(`export const v${i} = ${i};`);
  return lines.join("\n") + "\n";
}

describe("check-file-length.mjs", () => {
  let fixture: string;

  beforeEach(() => {
    fixture = seedFixture();
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it("reports 'All files within budget' when every file fits", () => {
    writeFileSync(join(fixture, "src/services/tiny.ts"), longFile(10));
    writeFileSync(join(fixture, "src/screens/tiny.tsx"), longFile(20));
    writeFileSync(join(fixture, "src/components/tiny.tsx"), longFile(30));
    const res = runScript(fixture);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/All files within budget/);
  });

  it("lists over-budget files sorted by overage (soft mode exits 0)", () => {
    writeFileSync(join(fixture, "src/services/big.ts"), longFile(410)); // +10
    writeFileSync(join(fixture, "src/screens/huge.tsx"), longFile(500)); // +150
    writeFileSync(join(fixture, "src/components/slim.tsx"), longFile(100)); // ok
    const res = runScript(fixture);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/2 file\(s\) over budget/);
    const bigIdx = res.stdout.indexOf("big.ts");
    const hugeIdx = res.stdout.indexOf("huge.tsx");
    // huge (+150) should appear before big (+10) in the sorted table.
    expect(hugeIdx).toBeGreaterThan(-1);
    expect(bigIdx).toBeGreaterThan(hugeIdx);
  });

  it("--strict exits non-zero when files exceed budget", () => {
    writeFileSync(join(fixture, "src/services/big.ts"), longFile(410));
    const res = runScript(fixture, ["--strict"]);
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/Strict mode/);
  });

  it("--json emits structured report", () => {
    writeFileSync(join(fixture, "src/services/big.ts"), longFile(410));
    const res = runScript(fixture, ["--json"]);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.overBudget).toHaveLength(1);
    expect(parsed.overBudget[0].file).toMatch(/big\.ts$/);
    expect(parsed.overBudget[0].overage).toBe(10);
  });

  it("does not count comment-only or blank lines toward LOC", () => {
    // 3 code lines + 2 comment lines + 1 blank line = 3 LOC, under any budget.
    const source = [
      "// header comment",
      "/* block",
      "   comment */",
      "",
      "export const a = 1;",
      "export const b = 2;",
      "export const c = 3;",
    ].join("\n");
    writeFileSync(join(fixture, "src/services/mixed.ts"), source);
    const res = runScript(fixture, ["--json"]);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    const entry = parsed.all.find((r: { file: string }) => r.file.endsWith("mixed.ts"));
    expect(entry.loc).toBe(3);
  });

  it("ignores __tests__ and .test.ts files under the target dirs", () => {
    mkdirSync(join(fixture, "src/services/__tests__"), { recursive: true });
    writeFileSync(join(fixture, "src/services/__tests__/huge.test.ts"), longFile(999));
    writeFileSync(join(fixture, "src/services/also.test.ts"), longFile(999));
    writeFileSync(join(fixture, "src/services/real.ts"), longFile(50));
    const res = runScript(fixture, ["--json"]);
    const parsed = JSON.parse(res.stdout);
    const files = parsed.all.map((r: { file: string }) => r.file);
    expect(files).toContain("src/services/real.ts");
    expect(files.some((f: string) => f.includes("__tests__"))).toBe(false);
    expect(files.some((f: string) => f.endsWith(".test.ts"))).toBe(false);
  });
});
