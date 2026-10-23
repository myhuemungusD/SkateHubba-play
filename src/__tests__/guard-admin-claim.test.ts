/**
 * CI guard: the admin custom claim is set in exactly one place,
 * scripts/set-admin-claim.mjs. Nothing else in the repo (app, API, Cloud
 * Functions, scripts) may call the Admin SDK claim setter, so no feature,
 * pro status included, can ever mint admin. Spec:
 * /workspace/team/specs/pro-filmer-stats.md §3.6.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const ROOTS = ["src", "api", "functions/src", "scripts", "e2e", ".github"];
const SKIP = new Set(["node_modules", "dist", "lib", "coverage"]);
// Built from parts so this file doesn't match its own scan.
const CLAIM_SETTER = ["setCustom", "UserClaims"].join("");
const ALLOWED = new Set(["scripts/set-admin-claim.mjs"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(m?[jt]sx?|cjs|ya?ml|sh)$/.test(name) ? [path] : [];
  });
}

describe("admin claim guard", () => {
  it(`only scripts/set-admin-claim.mjs calls ${CLAIM_SETTER}`, () => {
    const files = ROOTS.flatMap((r) => walk(join(ROOT, r))).map((f) => relative(ROOT, f).replace(/\\/g, "/"));
    expect(files).toContain("scripts/set-admin-claim.mjs");
    const offenders = files.filter(
      (f) => !ALLOWED.has(f) && readFileSync(join(ROOT, f), "utf8").includes(CLAIM_SETTER),
    );
    expect(offenders).toEqual([]);
  });

  it("the allowed script really is where the claim gets set", () => {
    expect(readFileSync(join(ROOT, "scripts/set-admin-claim.mjs"), "utf8")).toContain(CLAIM_SETTER);
  });
});
