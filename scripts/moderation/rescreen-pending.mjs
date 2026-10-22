/**
 * Rescreen public clips stuck at moderation == "pending".
 *
 * Why: `moderateNewClip` only runs when a clip is created. Clips posted while
 * the server switch MODERATION_ENABLED was off stay pending ("Checking…")
 * forever, even after the switch is turned on. This script runs each one
 * through the SAME handler the trigger uses (handleClipCreated in
 * functions/src/moderation/handlers.ts), so thresholds, notices, the badge
 * count, and the approved-path video copy all match a live screen.
 *
 * Admin only. It uses a service account, never ships to the client, and adds
 * no callable. Docs: docs/DEPLOY_DICE_MODERATION.md, "Rescreen clips stuck
 * in pending".
 *
 * Build first. The script imports the compiled functions code:
 *
 *   npm --prefix functions ci
 *   npm --prefix functions run build
 *
 * Run it with node (no shebang: the root Vitest transform imports this file).
 *
 * Usage:
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/admin-sa.json
 *
 *   # Dry run (default): lists pending clips with id, owner, age. No writes.
 *   node scripts/moderation/rescreen-pending.mjs
 *
 *   # Apply. Only after the deploy log shows "switch MODERATION: ON".
 *   MODERATION_ENABLED=true node scripts/moderation/rescreen-pending.mjs --apply --limit 1
 *   MODERATION_ENABLED=true node scripts/moderation/rescreen-pending.mjs --apply --limit 25 --delay-ms 5000
 *
 * Flags:
 *   --apply              Screen and write. Without it nothing is written.
 *   --limit N            Most clips to screen this run (default 25).
 *   --delay-ms N         Pause between clips (default 5000) to spread Video
 *                        Intelligence calls.
 *   --min-age-minutes N  Skip clips newer than this (default 10); the live
 *                        trigger may still be screening them.
 *   --max-errors N       Stop after N screener errors in a row (default 2).
 *   --log PATH           Markdown log to append to
 *                        (default /workspace/team/qa/2026-10-21/rescreen.md).
 *   --database ID        Firestore database (default skatehubba).
 *
 * MODERATION_ENABLED: --apply fails closed unless it is exactly "true", read
 * from the environment, else from the functions parameter file
 * (scripts/lib/functions-env.mjs). That is the same switch and the same
 * strict parse as the deployed param, which defaults to off.
 *
 * Idempotent: a clip is re-read right before screening and skipped unless it
 * is still a pending user upload, and the handler's transaction re-checks
 * "pending" at write time. Re-running is safe; finished clips drop out.
 *
 * Exit codes: 0 clean run, 1 a screener error or an early stop (check the
 * log), 2 refused (switch off, missing build) before anything was read.
 *
 * The log holds clip ids, usernames, ages and states. Never tokens, emails,
 * uids or credentials.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DATABASE_ID, functionsEnvPath, parseDotenv } from "../lib/functions-env.mjs";

export const DEFAULT_LOG = "/workspace/team/qa/2026-10-21/rescreen.md";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const COMPILED = join(ROOT, "functions", "lib", "moderation", "rescreen.js");

const DEFAULTS = {
  apply: false,
  limit: 25,
  delayMs: 5000,
  minAgeMinutes: 10,
  maxErrors: 2,
  log: DEFAULT_LOG,
  database: DATABASE_ID,
};

function positiveInt(flag, raw, { allowZero = false } = {}) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < (allowZero ? 0 : 1)) {
    throw new Error(`${flag} needs a whole number${allowZero ? "" : " above 0"}, got "${raw ?? ""}"`);
  }
  return n;
}

export function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const value = () => (eq > 0 ? arg.slice(eq + 1) : argv[++i]);
    switch (flag) {
      case "--apply":
        out.apply = true;
        break;
      case "--dry-run":
        out.apply = false;
        break;
      case "--limit":
        out.limit = positiveInt(flag, value());
        break;
      case "--delay-ms":
        out.delayMs = positiveInt(flag, value(), { allowZero: true });
        break;
      case "--min-age-minutes":
        out.minAgeMinutes = positiveInt(flag, value(), { allowZero: true });
        break;
      case "--max-errors":
        out.maxErrors = positiveInt(flag, value());
        break;
      case "--log": {
        const path = value();
        if (!path) throw new Error("--log needs a path");
        out.log = path;
        break;
      }
      case "--database": {
        const db = value();
        if (!db) throw new Error("--database needs an id");
        out.database = db;
        break;
      }
      default:
        throw new Error(`Unknown flag ${arg}. See the header of scripts/moderation/rescreen-pending.mjs.`);
    }
  }
  return out;
}

/**
 * Same strict parse as the deployed defineBoolean("MODERATION_ENABLED",
 * { default: false }): only "true" is on. The environment wins, then the
 * functions parameter file.
 */
export function moderationSwitch(env = process.env, readFile = readFileSync) {
  if (env.MODERATION_ENABLED !== undefined) {
    return { on: env.MODERATION_ENABLED.trim() === "true", source: "environment" };
  }
  const path = functionsEnvPath(env);
  let text = "";
  try {
    text = readFile(path, "utf8");
  } catch {
    return { on: false, source: "default (off; no environment value or parameter file)" };
  }
  const value = parseDotenv(text).MODERATION_ENABLED;
  if (value === undefined) return { on: false, source: "default (off; not in the parameter file)" };
  return { on: value.trim() === "true", source: "functions parameter file" };
}

export function appendLog(path, text, fs = { appendFileSync, existsSync, mkdirSync }) {
  fs.mkdirSync(dirname(path), { recursive: true });
  const header = fs.existsSync(path)
    ? ""
    : "# Clip moderation rescreen log\n\nAppended by scripts/moderation/rescreen-pending.mjs.\n\n";
  fs.appendFileSync(path, header + text + "\n");
}

/** Pacific time, which is what the team logs use. */
export function pacific(date = new Date()) {
  return `${date.toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour12: false })} PT`;
}

export async function main(argv = process.argv.slice(2), env = process.env, io = console) {
  const args = parseArgs(argv);
  if (args.apply) {
    const sw = moderationSwitch(env);
    if (!sw.on) {
      io.error(
        `Refusing --apply: MODERATION_ENABLED is off (${sw.source}). The server screener must be on first, or ` +
          "rescreened clips would be screened by code the live trigger is not running. Deploy with the switch on " +
          '(the deploy log prints "switch MODERATION: ON"), then rerun with MODERATION_ENABLED=true.',
      );
      return 2;
    }
  }
  if (!existsSync(COMPILED)) {
    io.error("Compiled functions code not found. Run: npm --prefix functions ci && npm --prefix functions run build");
    return 2;
  }
  const lib = await import(/* @vite-ignore */ pathToFileURL(COMPILED).href);
  const runtime = lib.adminRescreenRuntime({
    databaseId: args.database,
    credentialsPath: env.GOOGLE_APPLICATION_CREDENTIALS ?? "",
    sentryDsn: env.SENTRY_DSN ?? "",
  });
  const emulator = env.FIRESTORE_EMULATOR_HOST ? ` (emulator ${env.FIRESTORE_EMULATOR_HOST})` : "";
  const target = `${runtime.projectId || "(default project)"}${emulator}`;
  io.log(`rescreen: ${args.apply ? "APPLY" : "dry run"} on ${target}, database ${args.database}`);
  if (args.apply && !env.FIRESTORE_EMULATOR_HOST) await runtime.checkToken();

  const options = {
    apply: args.apply,
    limit: args.limit,
    delayMs: args.delayMs,
    minAgeMs: args.minAgeMinutes * 60_000,
    maxErrors: args.maxErrors,
  };
  const startedAt = pacific();
  const result = await lib.rescreenPending(runtime.deps, options);
  const markdown = lib.renderRescreenLog(result, {
    startedAt,
    finishedAt: pacific(),
    apply: args.apply,
    project: target,
    database: args.database,
    options,
  });
  appendLog(args.log, markdown);
  io.log(markdown);
  io.log(`rescreen: log appended to ${args.log}`);
  const failed = result.stopped || result.rows.some((row) => row.action === "error");
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`rescreen: failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
