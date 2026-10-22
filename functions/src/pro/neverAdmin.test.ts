/**
 * Guard: pro status never grants admin. Admin is only the `admin: true`
 * custom claim, set by scripts/set-admin-claim.mjs. No Cloud Function may
 * mint claims, and a pro without the claim can't use the admin-only revoke.
 * Spec: /workspace/team/specs/pro-filmer-stats.md §3.6.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { handleBlessingCall } from "./callable.js";

const SRC = fileURLToPath(new URL("..", import.meta.url));
// Built from parts so this file doesn't match its own scan.
const CLAIM_SETTER = ["setCustom", "UserClaims"].join("");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe("pro is never admin", () => {
  it("no Cloud Function sets custom claims", () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes(CLAIM_SETTER));
    expect(offenders).toEqual([]);
  });

  it("accepting a co-sign writes only the three pro fields", () => {
    const handlers = readFileSync(join(SRC, "pro", "handlers.ts"), "utf8");
    const grants = handlers.match(/tx\.update\(`users\/\$\{actor\.uid\}`, \{[^}]*\}/g) ?? [];
    expect(grants).toEqual([
      "tx.update(`users/${actor.uid}`, { isVerifiedPro: true, verifiedBy: blesserUid, verifiedAt: now }",
    ]);
  });

  it("a pro without the admin claim can't revoke", async () => {
    const request = {
      auth: { uid: "pro-uid", token: { email_verified: true, isVerifiedPro: true } },
      data: { action: "revoke", targetUid: "t", reason: "not a real pro" },
    } as unknown as Parameters<typeof handleBlessingCall>[0];
    const deps = {
      enabled: true,
      testers: "",
      nowMs: 0,
      db: {} as never,
      config: { limit: 2, windowDays: 30, minAccountAgeDays: 30, offerTtlDays: 14 },
    };
    await expect(handleBlessingCall(request, deps)).rejects.toMatchObject({ message: "not_admin" });
  });
});
