import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
 *
 * Then it crashed again one step later: getStorage() lazy-loads
 * @google-cloud/storage → gaxios 6 → require("uuid"), and the root override
 * forced ESM-only uuid 14 → 500 erasure_failed. The override is now uuid
 * ^11.1.1 (patched for GHSA-w5hq-g745-h8pq, still ships CJS), and the guard
 * also runs call-time probes (scripts/api-call-time-probes.mjs) that drive the
 * SDK calls and the real deletion handler/helpers, offline and credential-free.
 */
const root = resolve(__dirname, "../..");
const req = createRequire(resolve(root, "package.json"));

type RunResult = { entry: string; ok: boolean; code: number | null; out: string };
type CheckResult = { ok: boolean; error?: string; results: RunResult[]; probeResults: RunResult[] };
type Probes = Record<string, { covers: string[]; mustLoad: string[]; noMustLoad?: string }>;

const scriptsDir = resolve(root, "scripts");
const loadScripts = async () => {
  const guard = (await import(/* @vite-ignore */ resolve(scriptsDir, "check-api-module-load.mjs"))) as {
    checkApiModuleLoad: () => Promise<CheckResult>;
    listFunctionEntries: () => string[];
    listApiExternalImports: (dir?: string) => string[];
  };
  const probes = (await import(/* @vite-ignore */ resolve(scriptsDir, "api-call-time-probes.mjs"))) as {
    PROBES: Probes;
    MODULE_LOAD_ERROR: RegExp;
    listVacuousProbes: (probes?: Probes) => string[];
  };
  return { ...guard, ...probes };
};

describe("api functions load like on Vercel", () => {
  it("every function entry loads, and every call-time SDK path runs, without a module-load crash", async () => {
    const { checkApiModuleLoad, listFunctionEntries, PROBES } = await loadScripts();
    const entries = listFunctionEntries();
    expect(entries).toContain("api/account/delete.ts");
    expect(entries.some((e) => e.split("/").some((part) => part.startsWith("_")))).toBe(false);

    const { ok, error, results, probeResults } = await checkApiModuleLoad();
    const failures = [...results, ...probeResults]
      .filter((r) => !r.ok)
      .map((r) => `${r.entry} (exit ${r.code}):\n${r.out}`);
    expect(error).toBeUndefined();
    expect(failures).toEqual([]);
    expect(results.map((r) => r.entry)).toEqual(entries);
    expect(probeResults.map((r) => r.entry)).toEqual(Object.keys(PROBES).map((n) => `probe:${n}`));
    expect(probeResults.map((r) => r.entry)).toContain("probe:api/account/delete");
    expect(ok).toBe(true);
  }, 120_000);

  it("every package api/ loads at runtime (import or import()) has a call-time probe", async () => {
    const { listApiExternalImports, PROBES } = await loadScripts();
    const imports = listApiExternalImports();
    // Sanity: the scan sees the static SDK imports and api/_sentry.ts's import("@sentry/node").
    expect(imports).toEqual(expect.arrayContaining(["firebase-admin/storage", "@sentry/node"]));
    const covered = new Set(Object.values(PROBES).flatMap((p) => p.covers));
    expect(imports.filter((s) => !covered.has(s))).toEqual([]);
    // The deletion path's lazy Storage chain is asserted, not just reached.
    expect(PROBES["firebase-admin/storage"].mustLoad).toEqual(["@google-cloud/storage", "gaxios", "uuid"]);
  });

  it("no call-time probe can pass with nothing checked", async () => {
    const { PROBES, listVacuousProbes } = await loadScripts();
    // A probe with an empty mustLoad passes even if its SDK call short-circuits.
    expect(listVacuousProbes()).toEqual([]);
    expect(listVacuousProbes({ x: { covers: [], mustLoad: [] } })).toEqual(["x"]);
    expect(listVacuousProbes({ x: { covers: [], mustLoad: [], noMustLoad: "  " } })).toEqual(["x"]);
    // The first 1.2.0 crash chain (jwks-rsa → jose) and the request-time transport are asserted.
    expect(PROBES["firebase-admin/auth"].mustLoad).toEqual(["jsonwebtoken", "jwks-rsa", "jose", "fetch-blob"]);
    expect(PROBES["firebase-admin/messaging"].mustLoad).toEqual(
      expect.arrayContaining(["google-auth-library", "gaxios", "firebase-admin/lib/messaging", "fetch-blob"]),
    );
    // @sentry/node is import()ed as ESM, invisible to require.cache: the runner's null check asserts it.
    expect(PROBES["@sentry/node"].mustLoad).toEqual([]);
    expect(PROBES["@sentry/node"].noMustLoad).toMatch(/ensureSentry\(\) returns null/);
  });

  it("the import scan also catches require(), createRequire() and import x = require()", async () => {
    const { listApiExternalImports } = await loadScripts();
    const dir = mkdtempSync(join(tmpdir(), "api-scan-"));
    try {
      mkdirSync(join(dir, "sub"));
      writeFileSync(
        join(dir, "a.ts"),
        [
          'import type { T } from "type-only-pkg";',
          'import x = require("import-equals-pkg");',
          'import type Y = require("type-only-equals-pkg");',
          'const r = require("require-pkg");',
          'const n = require("node:fs");',
          'const rel = require("./local");',
          "const dyn = require(process.env.X as string);",
          "export { x, r, n, rel, dyn };",
        ].join("\n"),
      );
      writeFileSync(
        join(dir, "sub", "b.ts"),
        [
          'import { createRequire } from "node:module";',
          'import * as mod from "node:module";',
          "const req = createRequire(import.meta.url);",
          "const req2 = mod.createRequire(import.meta.url);",
          'export const z = [req, req2, await import("import-call-pkg")];',
        ].join("\n"),
      );
      writeFileSync(join(dir, "c.test.ts"), 'require("test-only-pkg");');
      const found = listApiExternalImports(dir);
      expect(found).toEqual(expect.arrayContaining(["import-equals-pkg", "require-pkg", "import-call-pkg"]));
      expect(found.filter((s) => s.startsWith("<"))).toHaveLength(2);
      expect(found.some((s) => /^<non-literal require\(\) in .*a\.ts>$/.test(s))).toBe(true);
      expect(found.some((s) => /^<createRequire\(\) in .*sub\/b\.ts>$/.test(s))).toBe(true);
      for (const absent of ["type-only-pkg", "type-only-equals-pkg", "node:fs", "./local", "test-only-pkg"]) {
        expect(found).not.toContain(absent);
      }
      expect(found.filter((s) => !s.startsWith("<"))).toEqual(["import-call-pkg", "import-equals-pkg", "require-pkg"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // api/ itself is ESM: no require-style loads (any would need a probe or a look).
    expect(listApiExternalImports().filter((s) => s.startsWith("<"))).toEqual([]);
  });

  it("recognises the prod erasure_failed error as a module-load failure", async () => {
    const { MODULE_LOAD_ERROR } = await loadScripts();
    const prod =
      'Failed to import the Cloud Storage client library for Node.js. Make sure to install the "@google-cloud/storage" npm package. Original error: Error [ERR_REQUIRE_ESM]: require() of ES Module /var/task/node_modules/uuid/dist-node/index.js from /var/task/node_modules/gaxios/build/src/gaxios.js not supported.';
    expect(MODULE_LOAD_ERROR.test(prod)).toBe(true);
    expect(
      MODULE_LOAD_ERROR.test("request to https://www.googleapis.com/oauth2/v4/token failed, reason: network disabled"),
    ).toBe(false);
  });

  it("pins uuid to the newest patched major that still ships CommonJS, everywhere in the tree", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      overrides?: Record<string, unknown>;
    };
    // uuid 12+ is ESM-only; gaxios 6 (prod: @google-cloud/storage) and xcode (dev) require() it.
    // 11.1.1 is the GHSA-w5hq-g745-h8pq fix for the 11.x line.
    expect(pkg.overrides?.uuid).toBe("^11.1.1");
    const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8")) as {
      packages: Record<string, { version?: string }>;
    };
    const copies = Object.entries(lock.packages).filter(([path]) => /(^|\/)node_modules\/uuid$/.test(path));
    expect(copies.length).toBeGreaterThan(0);
    for (const [path, { version }] of copies) {
      const [major, minor, patch] = (version ?? "0.0.0").split(".").map(Number);
      expect({ path, major }).toEqual({ path, major: 11 });
      expect(minor * 1000 + patch, `${path}@${version}`).toBeGreaterThanOrEqual(1001);
      const installed = JSON.parse(readFileSync(resolve(root, path, "package.json"), "utf8")) as {
        exports: Record<string, { node?: { require?: string } }>;
      };
      expect(installed.exports["."].node?.require, `${path} has a CommonJS entry`).toBeTruthy();
    }
    const gaxiosReq = createRequire(req.resolve("gaxios"));
    expect((gaxiosReq("uuid/package.json") as { version: string }).version).toMatch(/^11\./);
  });

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
