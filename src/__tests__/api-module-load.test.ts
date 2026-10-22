import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cold-start guard for the Vercel functions (api/**). The unit tests mock
 * firebase-admin, so a crash while loading a function's real dependency graph
 * only shows up in prod, as 500 FUNCTION_INVOCATION_FAILED before Sentry starts.
 * 1.2.0's /api/account/delete shipped that way: firebase-admin 14 → jwks-rsa 4
 * → require("jose"), and jose 6 is ESM-only, which Vercel's loader rejects
 * (ERR_REQUIRE_ESM). package.json overrides jwks-rsa's jose to 5.x (dual
 * CJS/ESM). scripts/check-api-module-load.mjs loads every function in a fresh
 * Node with require(esm) disabled, the way Vercel does.
 */
const root = resolve(__dirname, "../..");
const req = createRequire(resolve(root, "package.json"));

type CheckResult = {
  ok: boolean;
  error?: string;
  results: { entry: string; ok: boolean; code: number | null; out: string }[];
};

describe("api functions load like on Vercel", () => {
  it("every function entry loads its full dependency graph without crashing", async () => {
    const script = resolve(root, "scripts/check-api-module-load.mjs");
    const { checkApiModuleLoad, listFunctionEntries } = (await import(/* @vite-ignore */ script)) as {
      checkApiModuleLoad: () => Promise<CheckResult>;
      listFunctionEntries: () => string[];
    };
    const entries = listFunctionEntries();
    expect(entries).toContain("api/account/delete.ts");
    expect(entries.some((e) => e.split("/").some((part) => part.startsWith("_")))).toBe(false);

    const { ok, error, results } = await checkApiModuleLoad();
    const failures = results.filter((r) => !r.ok).map((r) => `${r.entry} (exit ${r.code}):\n${r.out}`);
    expect(error).toBeUndefined();
    expect(failures).toEqual([]);
    expect(results.map((r) => r.entry)).toEqual(entries);
    expect(ok).toBe(true);
  }, 120_000);

  it("pins jwks-rsa's jose to a CommonJS-loadable 5.x", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      overrides?: Record<string, unknown>;
    };
    expect(pkg.overrides?.["jwks-rsa"]).toEqual({ jose: "^5.10.0" });
    const jwksReq = createRequire(req.resolve("jwks-rsa"));
    const jose = jwksReq("jose/package.json") as { version: string; exports: Record<string, Record<string, string>> };
    expect(jose.version).toMatch(/^5\./);
    expect(jose.exports["."].require).toBeTruthy();
  });

  it("jwks-rsa still turns a JWK into the SPKI PEM firebase-admin verifies with", async () => {
    const { retrieveSigningKeys } = req("jwks-rsa/src/utils.js") as {
      retrieveSigningKeys: (jwks: object[]) => Promise<{ kid?: string; getPublicKey: () => string }[]>;
    };
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
    const [key] = await retrieveSigningKeys([jwk]);
    expect(key.kid).toBe("k1");
    const pem = key.getPublicKey();
    expect(pem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    expect(createPublicKey(pem).export({ format: "jwk" })).toEqual(publicKey.export({ format: "jwk" }));
  });
});
