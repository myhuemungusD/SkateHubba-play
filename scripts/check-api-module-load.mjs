/**
 * Cold-start guard for the Vercel functions under api/.
 *
 * Loads every function entry the way the Vercel Node runtime does, in a fresh
 * Node process, and fails if any of them crashes while loading its modules.
 * A crash at module load is invisible to unit tests (they mock firebase-admin)
 * and to Sentry (it happens before Sentry starts): prod just answers 500
 * FUNCTION_INVOCATION_FAILED. 1.2.0's account deletion shipped like that:
 * firebase-admin 14 → jwks-rsa 4 → `require("jose")`, and jose 6 is ESM-only.
 *
 * How it models Vercel:
 *   • Each api/**.ts is transpiled on its own (isolated modules, ESM, like
 *     @vercel/node for a `"type": "module"` package) into
 *     node_modules/.tmp/api-load-check. node_modules is NOT bundled: packages
 *     resolve from the repo's node_modules, as in the deployed /var/task.
 *   • Entries are what Vercel deploys as functions: api/**.ts, skipping any
 *     file or folder whose name starts with "_".
 *   • The child runs with --no-experimental-require-module. Vercel's loader
 *     rejects CommonJS require() of an ES module with ERR_REQUIRE_ESM even on
 *     nodejs24.x (prod log, 2026-10-22), so plain local Node 22.12+/24, which
 *     allows it, would hide exactly this crash.
 *   • The child gets a minimal env (no credentials). Module load must not need
 *     any: every function initialises Firebase lazily inside the handler.
 *
 * Before checking the functions, a self-test proves the flag still turns
 * require(esm) into ERR_REQUIRE_ESM on this Node, so the guard can't go
 * vacuous on a future Node that drops the flag.
 *
 * Usage: node scripts/check-api-module-load.mjs
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "node_modules", ".tmp", "api-load-check");
const NODE_FLAGS = ["--no-experimental-require-module"];
const TIMEOUT_MS = 60_000;

/** Every function entry Vercel deploys from api/ (posix paths, repo-relative). */
export function listFunctionEntries(dir = join(root, "api")) {
  const entries = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.name.startsWith("_") || d.name.startsWith(".")) continue;
    const full = join(dir, d.name);
    if (d.isDirectory()) entries.push(...listFunctionEntries(full));
    else if (/\.ts$/.test(d.name) && !/\.(test|spec|d)\.ts$/.test(d.name)) {
      entries.push(relative(root, full).split(sep).join("/"));
    }
  }
  return entries.sort();
}

/** Transpile the api tsconfig's files one by one (isolatedModules), ESM out. */
function transpileApi() {
  const configPath = join(root, "tsconfig.api.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (!parsed || parsed.errors.length > 0) throw new Error("could not read tsconfig.api.json");
  rmSync(outDir, { recursive: true, force: true });
  const compilerOptions = {
    ...parsed.options,
    noEmit: false,
    composite: false,
    declaration: false,
    incremental: false,
    sourceMap: false,
    module: ts.ModuleKind.ESNext,
  };
  for (const file of parsed.fileNames) {
    if (!file.endsWith(".ts") || file.endsWith(".d.ts")) continue;
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions, fileName: file });
    const target = join(outDir, relative(root, file)).replace(/\.ts$/, ".js");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, outputText);
  }
  // The deployed package is "type": "module"; say so explicitly for the copy.
  writeFileSync(join(outDir, "package.json"), JSON.stringify({ type: "module" }));
}

/** Minimal child env: PATH only, plus a throwaway HOME. No credentials. */
function childEnv(home) {
  return { PATH: process.env.PATH ?? "", HOME: home, NODE_ENV: "production" };
}

function runNode(args, cwd, env) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [...NODE_FLAGS, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, out });
    });
  });
}

/** The loader model must reject require(esm); if it doesn't, the guard is void. */
async function selfTest(home) {
  const dir = mkdtempSync(join(tmpdir(), "api-load-selftest-"));
  try {
    writeFileSync(join(dir, "esm.mjs"), "export const x = 1;\n");
    writeFileSync(join(dir, "cjs.cjs"), 'require("./esm.mjs");\n');
    const r = await runNode([join(dir, "cjs.cjs")], dir, childEnv(home));
    return r.code !== 0 && r.out.includes("ERR_REQUIRE_ESM");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LOADER = `
const url = process.argv[1];
const mod = await import(url);
const handler = mod.default;
if (typeof handler !== "function" && typeof handler?.fetch !== "function" && typeof mod.GET !== "function" && typeof mod.POST !== "function") {
  console.error("no handler export (default function, default.fetch, GET or POST)");
  process.exit(2);
}
console.log("loaded");
`;

export async function checkApiModuleLoad() {
  const home = mkdtempSync(join(tmpdir(), "api-load-home-"));
  try {
    if (!(await selfTest(home))) {
      return {
        ok: false,
        results: [],
        error: `this Node (${process.version}) no longer turns require(esm) into ERR_REQUIRE_ESM under ${NODE_FLAGS.join(" ")}; update the loader model`,
      };
    }
    transpileApi();
    const entries = listFunctionEntries();
    const results = await Promise.all(
      entries.map(async (entry) => {
        const compiled = join(outDir, entry.replace(/\.ts$/, ".js"));
        const r = await runNode(
          ["--input-type=module", "-e", LOADER, pathToFileURL(compiled).href],
          root,
          childEnv(home),
        );
        return { entry, ok: r.code === 0 && r.out.includes("loaded"), code: r.code, signal: r.signal, out: r.out };
      }),
    );
    return { ok: results.length > 0 && results.every((r) => r.ok), results };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ok, results, error } = await checkApiModuleLoad();
  if (error) console.error(`[check-api-module-load] ${error}`);
  for (const r of results) {
    if (r.ok) console.log(`[check-api-module-load] ok    ${r.entry}`);
    else {
      const why = r.signal ? `killed (${r.signal}) after ${TIMEOUT_MS} ms` : `exit ${r.code}`;
      console.error(`[check-api-module-load] FAIL  ${r.entry}: ${why}\n${r.out.trim()}\n`);
    }
  }
  if (!ok) {
    console.error(
      "[check-api-module-load] A function above crashes while loading its modules. On Vercel that is a 500 FUNCTION_INVOCATION_FAILED on every request.",
    );
    process.exit(1);
  }
  console.log(
    `[check-api-module-load] ${results.length} functions load cleanly (${process.version}, ${NODE_FLAGS.join(" ")}).`,
  );
}
