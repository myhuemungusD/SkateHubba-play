#!/usr/bin/env node
/**
 * testers-sync.mjs — keep every server-side tester list matched to
 * config/featureTesters (the one list the app itself reads).
 *
 * Map, Dice, XP, Closet and Pro Blessing each have their own server switch
 * (*_TESTER_UIDS). If one of them drifts from config/featureTesters, a
 * feature quietly fails for a tester. This finds every list by scanning the
 * code, compares it with the source of truth, and (with --apply) fixes it.
 *
 * Targets:
 *   functions  KEY=value lines in the functions parameter file
 *              (see scripts/lib/functions-env.mjs). Live after the next
 *              `npm run deploy:functions`.
 *   vercel     Vercel production env (api/ cron jobs), via `npx vercel env`.
 *
 * Usage:
 *   npm run testers:sync                       # dry run: report only
 *   npm run testers:sync -- --apply            # write the changes
 *   npm run testers:sync -- --uids a,b         # skip Firestore, use these uids
 *   npm run testers:sync -- --skip-vercel
 *   node scripts/testers-sync.mjs --check      # CI: every list in code is known
 *
 * Firestore is read with Application Default Credentials (the same login the
 * admin scripts use: GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth
 * application-default login`).
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DATABASE_ID,
  PROJECT_ID,
  functionsEnvPath,
  normalizeUids,
  parseDotenv,
  setDotenv,
} from "./lib/functions-env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every tester list the sync knows, and where its value lives.
 * Adding a *_TESTER_UIDS anywhere in code without adding it here fails CI
 * (`--check`), so a new list can never silently miss the sync.
 */
export const KNOWN_LISTS = {
  XP_TESTER_UIDS: ["functions", "vercel"],
  DICE_TESTER_UIDS: ["functions"],
  MAP_TESTER_UIDS: ["functions"],
  CLOSET_TESTER_UIDS: ["functions"],
  PRO_BLESSING_TESTER_UIDS: ["functions"],
  SPOT_PRESENCE_TESTER_UIDS: ["functions"],
  // Named in src/lib/featureFlags.ts docs; no server reads it yet (WTT crons
  // are stubbed off). Kept so --check passes and it syncs once wired.
  WTT_TESTER_UIDS: [],
};

const SCAN_DIRS = ["functions/src", "api", "src"];
const SKIP_DIRS = new Set(["node_modules", "__tests__", "__mocks__", "dist"]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const CODE_FILE = /\.[cm]?[jt]sx?$/;

/** Scan production code for *_TESTER_UIDS names → { name: [files] }. */
export function discoverLists(root = ROOT) {
  const found = {};
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(p);
      } else if (CODE_FILE.test(name) && !TEST_FILE.test(name)) {
        for (const m of readFileSync(p, "utf-8").matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_TESTER_UIDS)\b/g)) {
          (found[m[1]] ??= new Set()).add(relative(root, p).split(sep).join("/"));
        }
      }
    }
  };
  for (const d of SCAN_DIRS) walk(join(root, d));
  return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, [...v].sort()]));
}

/** Lists referenced in code that KNOWN_LISTS doesn't cover. */
export function unknownLists(discovered, known = KNOWN_LISTS) {
  return Object.keys(discovered)
    .filter((k) => !(k in known))
    .sort();
}

/**
 * Compare desired uids with current per-target values.
 * @param {string[]} desired
 * @param {{ functions?: Record<string,string>|null, vercel?: Record<string,string>|null }} current
 *        null target = not readable (reported, not changed)
 */
export function planSync(desired, current, known = KNOWN_LISTS) {
  const want = normalizeUids(desired).join(",");
  const rows = [];
  for (const [key, targets] of Object.entries(known)) {
    for (const target of targets) {
      const values = current[target];
      if (values == null) {
        rows.push({ key, target, status: "unreadable", from: null, to: want });
        continue;
      }
      const have = key in values ? normalizeUids(values[key]).join(",") : null;
      const status = have === want ? "ok" : have === null ? "missing" : "drift";
      rows.push({ key, target, status, from: have, to: want });
    }
  }
  return rows;
}

/* ── side-effecting adapters (thin; injected in tests) ── */

async function readFeatureTesters() {
  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, "testers-sync");
  const snap = await getFirestore(app, DATABASE_ID).doc("config/featureTesters").get();
  const uids = snap.exists ? snap.get("uids") : null;
  if (!Array.isArray(uids)) throw new Error("config/featureTesters has no uids array");
  return uids;
}

function vercel(args, input) {
  return spawnSync("npx", ["--yes", "vercel", ...args], {
    cwd: ROOT,
    encoding: "utf-8",
    input,
    shell: process.platform === "win32",
  });
}

function readVercel() {
  const dir = mkdtempSync(join(tmpdir(), "testers-vercel-"));
  try {
    const file = join(dir, ".env");
    const r = vercel(["env", "pull", file, "--environment=production", "--yes"]);
    if (r.status !== 0 || !existsSync(file)) return null;
    return parseDotenv(readFileSync(file, "utf-8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeVercel(key, value) {
  vercel(["env", "rm", key, "production", "--yes"]);
  const r = vercel(["env", "add", key, "production"], value);
  if (r.status !== 0) throw new Error(`vercel env add ${key} failed: ${r.stderr}`);
}

export const adapters = {
  readFeatureTesters,
  readVercel,
  writeVercel,
  readFile: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
  writeFile: (p, text) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text, { mode: 0o600 });
  },
  log: (...a) => console.log(...a),
  error: (...a) => console.error(...a),
};

export async function main(argv = process.argv.slice(2), io = adapters, env = process.env) {
  const has = (f) => argv.includes(f);
  const val = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const discovered = discoverLists(env.TESTERS_SYNC_ROOT || ROOT);
  const unknown = unknownLists(discovered);
  if (unknown.length) {
    io.error(`[testers-sync] code references tester lists the sync doesn't know: ${unknown.join(", ")}`);
    for (const k of unknown) io.error(`  ${k}: ${discovered[k].join(", ")}`);
    io.error("  Add them to KNOWN_LISTS in scripts/testers-sync.mjs with their target(s).");
    return 1;
  }
  if (has("--check")) {
    io.log(`[testers-sync] OK — ${Object.keys(discovered).length} tester list(s) in code, all known.`);
    return 0;
  }

  const apply = has("--apply");
  let desired;
  try {
    desired = val("--uids") ? normalizeUids(val("--uids")) : normalizeUids(await io.readFeatureTesters());
  } catch (err) {
    io.error(`[testers-sync] could not read config/featureTesters: ${err instanceof Error ? err.message : err}`);
    io.error("  Sign in with `gcloud auth application-default login`, or pass --uids a,b.");
    return 1;
  }
  if (!desired.length) {
    io.error("[testers-sync] source list is empty — refusing to wipe every tester list.");
    return 1;
  }

  const envPath = val("--env-file") || functionsEnvPath(env);
  const envText = io.readFile(envPath);
  const current = {
    functions: envText == null ? {} : parseDotenv(envText),
    vercel: has("--skip-vercel") ? null : io.readVercel(),
  };
  const rows = planSync(desired, current);

  io.log(`[testers-sync] source of truth: config/featureTesters → ${desired.join(", ")}`);
  io.log(`[testers-sync] functions params: ${envPath}${envText == null ? " (does not exist yet)" : ""}`);
  for (const r of rows) {
    const mark = { ok: "✓", drift: "≠", missing: "+", unreadable: "?" }[r.status];
    io.log(
      `  ${mark} ${r.key.padEnd(26)} ${r.target.padEnd(9)} ${r.status}${r.status === "drift" ? ` (now: ${r.from || "empty"})` : ""}`,
    );
  }
  const todo = rows.filter((r) => r.status === "drift" || r.status === "missing");
  if (!todo.length) {
    io.log("[testers-sync] everything matches.");
    return 0;
  }
  if (!apply) {
    io.log(`[testers-sync] dry run — ${todo.length} change(s). Re-run with --apply to write them.`);
    return 0;
  }

  const fnUpdates = Object.fromEntries(todo.filter((r) => r.target === "functions").map((r) => [r.key, r.to]));
  if (Object.keys(fnUpdates).length) {
    io.writeFile(envPath, setDotenv(envText ?? "", fnUpdates));
    io.log(
      `[testers-sync] wrote ${Object.keys(fnUpdates).length} list(s) to ${envPath}. Run npm run deploy:functions to make them live.`,
    );
  }
  for (const r of todo.filter((x) => x.target === "vercel")) {
    io.writeVercel(r.key, r.to);
    io.log(`[testers-sync] set ${r.key} in Vercel production. It applies on the next Vercel deploy.`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
