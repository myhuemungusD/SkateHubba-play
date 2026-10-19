#!/usr/bin/env node
/**
 * deploy.mjs — one-command Firebase deploy for sk8hub-d7806 (database
 * "skatehubba"). Works on Windows (Jason's PC) and Linux.
 *
 *   npm run deploy:functions [-- --only mapCheckin,diceAction]
 *   npm run deploy:rules
 *   npm run deploy:all
 *   add -- --dry-run to run every check and print the deploy command only.
 *
 * Steps:
 *   1. Pre-flight: on main, clean tree, same commit as origin/main.
 *   2. Checks: typecheck; functions build + tests (functions/all); rules
 *      tests when firestore.rules / storage.rules changed since the last
 *      rules deploy from this machine (rules/all).
 *   3. Functions: copy the params file (scripts/lib/functions-env.mjs) to
 *      functions/.env.sk8hub-d7806 after checking every defineString /
 *      defineBoolean / defineInt in functions/src has a valid value.
 *   4. firebase deploy --non-interactive --force.
 *   5. ALWAYS delete functions/.env.sk8hub-d7806 (finally + Ctrl-C handler).
 *   6. Summary.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROJECT_ID, functionsEnvPath, parseDotenv } from "./lib/functions-env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RULES_FILES = ["firestore.rules", "storage.rules", "firestore.indexes.json"];

/** Every non-secret param functions/src defines → { name: "String"|"Boolean"|"Int" }. */
export function definedParams(root = ROOT) {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
        for (const m of readFileSync(p, "utf-8").matchAll(/define(String|Boolean|Int)\(\s*"([A-Z0-9_]+)"/g))
          out[m[2]] = m[1];
      }
    }
  };
  walk(join(root, "functions/src"));
  return out;
}

/** Problems with a params map against the defined params. */
export function validateParams(values, defined) {
  const errs = [];
  for (const [key, type] of Object.entries(defined)) {
    if (!(key in values)) errs.push(`${key} is missing (deploy --non-interactive will not use the code default)`);
    else if (type === "Boolean" && !/^(true|false)$/.test(values[key])) errs.push(`${key} must be true or false`);
    else if (type === "Int" && !/^-?\d+$/.test(values[key])) errs.push(`${key} must be a whole number`);
  }
  return errs;
}

export function parseArgs(argv) {
  const target = argv[0];
  if (!["functions", "rules", "all"].includes(target))
    throw new Error("usage: deploy.mjs <functions|rules|all> [--dry-run] [--only a,b]");
  const i = argv.indexOf("--only");
  const only = i >= 0 ? argv[i + 1] : "";
  if (only && target === "rules") throw new Error("--only is for functions");
  return { target, dryRun: argv.includes("--dry-run"), only };
}

/** The firebase --only value. */
export function onlyFlag({ target, only }) {
  const parts = [];
  if (target !== "rules")
    parts.push(
      only
        ? only
            .split(",")
            .map((n) => `functions:${n.trim()}`)
            .join(",")
        : "functions",
    );
  if (target !== "functions") parts.push("firestore:rules,firestore:indexes,storage");
  return parts.join(",");
}

const stateFile = (env) =>
  join(env.SKATEHUBBA_STATE_DIR || join(homedir(), ".skatehubba"), `last-rules-deploy.${PROJECT_ID}`);

export const io = {
  run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, {
      cwd: ROOT,
      stdio: opts.capture ? "pipe" : "inherit",
      encoding: "utf-8",
      shell: process.platform === "win32",
    });
    return { status: r.status ?? 1, stdout: (r.stdout ?? "").trim() };
  },
  exists: existsSync,
  read: (p) => readFileSync(p, "utf-8"),
  write: (p, t) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, t);
  },
  copy: (a, b) => copyFileSync(a, b),
  remove: (p) => rmSync(p, { force: true }),
  log: (...a) => console.log(...a),
  error: (...a) => console.error(...a),
  onSignal: (fn) => {
    for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(s, () => (fn(), process.exit(130)));
  },
};

export function main(argv = process.argv.slice(2), x = io, env = process.env, root = ROOT) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    x.error(`[deploy] ${e.message}`);
    return 2;
  }
  const summary = [];
  const step = (name, cmd, args) => {
    x.log(`\n[deploy] ▶ ${name}`);
    const ok = x.run(cmd, args).status === 0;
    summary.push(`${ok ? "✓" : "✗"} ${name}`);
    if (!ok) throw new Error(`${name} failed`);
  };
  const dotenv = join(root, "functions", `.env.${PROJECT_ID}`);
  let wroteDotenv = false;
  const cleanup = () => {
    if (wroteDotenv && x.exists(dotenv)) x.remove(dotenv);
    wroteDotenv = false;
  };
  x.onSignal(cleanup);

  try {
    // 1. git pre-flight
    const git = (...a) => x.run("git", a, { capture: true });
    const branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout;
    if (branch !== "main") throw new Error(`on branch "${branch}" — deploy only from main`);
    if (git("status", "--porcelain").stdout) throw new Error("working tree has uncommitted changes");
    git("fetch", "--quiet", "origin", "main");
    const head = git("rev-parse", "HEAD").stdout;
    if (head !== git("rev-parse", "origin/main").stdout)
      throw new Error("local main is not the same commit as origin/main — pull first");
    summary.push(`✓ git: main @ ${head.slice(0, 8)}, clean`);

    // 2. checks
    step("typecheck", "npm", ["run", "typecheck"]);
    if (opts.target !== "rules") {
      step("functions build", "npm", ["--prefix", "functions", "run", "build"]);
      step("functions tests", "npm", ["--prefix", "functions", "test"]);
    }
    let rulesHead = null;
    if (opts.target !== "functions") {
      const last = x.exists(stateFile(env)) ? x.read(stateFile(env)).trim() : "";
      const changed = !last || git("diff", "--quiet", last, "HEAD", "--", ...RULES_FILES).status !== 0;
      if (changed)
        step(`rules tests (${last ? "rules changed since last deploy" : "no deploy record"})`, "npm", [
          "run",
          "test:rules",
        ]);
      else summary.push("✓ rules tests skipped (rules unchanged since last deploy)");
      rulesHead = head;
    }

    // 3. params
    if (opts.target !== "rules") {
      const src = env.SKATEHUBBA_FUNCTIONS_ENV ? env.SKATEHUBBA_FUNCTIONS_ENV : functionsEnvPath(env);
      if (!x.exists(src)) throw new Error(`functions params file not found: ${src} (see docs/DEPLOY_FUNCTIONS.md)`);
      const errs = validateParams(parseDotenv(x.read(src)), definedParams(root));
      if (errs.length) throw new Error(`params file ${src}:\n  ${errs.join("\n  ")}`);
      summary.push(`✓ params: ${src}`);
    }

    // 4. deploy
    const args = [
      "firebase",
      "deploy",
      "--only",
      onlyFlag(opts),
      "--project",
      PROJECT_ID,
      "--non-interactive",
      "--force",
    ];
    if (opts.dryRun) {
      summary.push(`• dry run — would run: npx ${args.join(" ")}`);
    } else {
      if (opts.target !== "rules") {
        x.copy(env.SKATEHUBBA_FUNCTIONS_ENV || functionsEnvPath(env), dotenv);
        wroteDotenv = true;
      }
      step(`firebase deploy --only ${onlyFlag(opts)}`, "npx", args);
      if (rulesHead) x.write(stateFile(env), `${rulesHead}\n`);
    }
    return 0;
  } catch (e) {
    summary.push(`✗ ${e.message}`);
    return 1;
  } finally {
    cleanup();
    if (opts.target !== "rules")
      summary.push(x.exists(dotenv) ? `✗ ${dotenv} still exists — delete it` : "✓ temp params file removed");
    x.log(`\n[deploy] summary (${opts.target}${opts.dryRun ? ", dry run" : ""}, project ${PROJECT_ID}):`);
    for (const s of summary) x.log(`  ${s}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
