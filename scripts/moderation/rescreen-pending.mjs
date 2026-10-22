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
 * Admin only. It never ships to the client and adds no callable. Docs:
 * docs/DEPLOY_DICE_MODERATION.md, "Rescreen clips stuck in pending".
 *
 * Production runs go through the workflow, never a laptop or the team box:
 *
 *   gh workflow run moderation-rescreen.yml -f mode=dry-run
 *   gh workflow run moderation-rescreen.yml -f mode=apply -f limit=1 -f confirm=rescreen
 *
 * The workflow signs in with Workload Identity Federation (the same deploy
 * service account as firebase-functions-deploy.yml), so no service-account
 * key file exists anywhere. The script only uses Application Default
 * Credentials; it has no key-file option on purpose.
 *
 * Local runs are for the emulator only:
 *
 *   npm --prefix functions ci && npm --prefix functions run build
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GOOGLE_CLOUD_PROJECT=demo-skatehubba \
 *     node scripts/moderation/rescreen-pending.mjs --log /tmp/rescreen.md
 *
 * Run it with node (no shebang: the root Vitest transform imports this file).
 *
 * Flags:
 *   --apply              Screen and write. Without it nothing is written.
 *   --limit N            Most clips to screen this run (default 25).
 *   --delay-ms N         Pause between clips (default 5000) to spread Video
 *                        Intelligence calls.
 *   --min-age-minutes N  Skip clips newer than this (default 10); the live
 *                        trigger may still be screening them.
 *   --max-errors N       Stop after N screener errors in a row (default 2).
 *   --log PATH           Markdown log to append to (default
 *                        ./rescreen-YYYY-MM-DD.md in the current directory,
 *                        Pacific date). The workflow always passes --log.
 *   --database ID        Firestore database (default skatehubba).
 *   --redact             Public-log mode: no owner handles or uids anywhere
 *                        in the output, and no users/{uid} reads. Always on
 *                        when GITHUB_ACTIONS=true (the repo is public, so its
 *                        Actions logs and artifacts are too).
 *   --summary PATH       Also write a counts-only markdown summary (the
 *                        workflow's job summary).
 *
 * MODERATION_ENABLED: --apply fails closed unless it is exactly "true", read
 * from the environment, else from the functions parameter file
 * (scripts/lib/functions-env.mjs). That is the same switch and the same
 * strict parse as the deployed param, which defaults to off. The workflow
 * derives it from the required MODERATION_ENABLED= line of FUNCTIONS_DOTENV,
 * exactly as the deploy does (no vars fallback), and never hard-codes it.
 *
 * Idempotent: a clip is re-read right before screening and skipped unless it
 * is still a pending user upload, and the handler's transaction re-checks
 * "pending" at write time. Re-running is safe; finished clips drop out.
 *
 * Exit codes: 0 clean run, 1 a screener error or an early stop (check the
 * log), 2 refused (switch off, missing build) before anything was read.
 *
 * The log holds clip ids, usernames, ages and states. Never tokens, emails,
 * uids or credentials. Redacted (CI) logs drop usernames and screener error
 * text too: clip ids, ages and states only.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DATABASE_ID, functionsEnvPath, parseDotenv } from "../lib/functions-env.mjs";

/** Cwd-relative, dated by the Pacific calendar day: rescreen-YYYY-MM-DD.md. */
export function defaultLogPath(date = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return `rescreen-${day}.md`;
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const COMPILED = join(ROOT, "functions", "lib", "moderation", "rescreen.js");

const DEFAULTS = {
  apply: false,
  limit: 25,
  delayMs: 5000,
  minAgeMinutes: 10,
  maxErrors: 2,
  database: DATABASE_ID,
  redact: false,
  summary: "",
};

function positiveInt(flag, raw, { allowZero = false } = {}) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < (allowZero ? 0 : 1)) {
    throw new Error(`${flag} needs a whole number${allowZero ? "" : " above 0"}, got "${raw ?? ""}"`);
  }
  return n;
}

export function parseArgs(argv, now = new Date()) {
  const out = { ...DEFAULTS, log: defaultLogPath(now) };
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
      case "--redact":
        out.redact = true;
        break;
      case "--summary": {
        const path = value();
        if (!path) throw new Error("--summary needs a path");
        out.summary = path;
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

/** Redaction is forced on in GitHub Actions; there is no flag to turn it off there. */
export function redactFrom(args, env = process.env) {
  return args.redact === true || env.GITHUB_ACTIONS === "true";
}

/** Project to pin: GOOGLE_CLOUD_PROJECT (set by the workflow), then GCLOUD_PROJECT, else let ADC decide. */
export function projectIdFrom(env = process.env) {
  return (env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT ?? "").trim();
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
  const redact = redactFrom(args, env);
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
    projectId: projectIdFrom(env),
    sentryDsn: env.SENTRY_DSN ?? "",
  });
  const emulator = env.FIRESTORE_EMULATOR_HOST ? ` (emulator ${env.FIRESTORE_EMULATOR_HOST})` : "";
  const target = `${runtime.projectId || "(default project)"}${emulator}`;
  io.log(
    `rescreen: ${args.apply ? "APPLY" : "dry run"} on ${target}, database ${args.database}${redact ? " (redacted: no owners)" : ""}`,
  );
  if (args.apply && !env.FIRESTORE_EMULATOR_HOST) await runtime.checkToken();

  const options = {
    apply: args.apply,
    limit: args.limit,
    delayMs: args.delayMs,
    minAgeMs: args.minAgeMinutes * 60_000,
    maxErrors: args.maxErrors,
    redact,
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
  if (args.summary) writeFileSync(args.summary, lib.renderRescreenCounts(result, { apply: args.apply }));
  // Only the rendered (redacted in CI) markdown is printed, never row objects.
  io.log(markdown);
  io.log(`rescreen: log appended to ${args.log}`);
  const failed = result.stopped || result.rows.some((row) => row.action === "error");
  return failed ? 1 : 0;
}

const GRPC_CODES =
  /\b(PERMISSION_DENIED|UNAUTHENTICATED|NOT_FOUND|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|UNAVAILABLE|INVALID_ARGUMENT|FAILED_PRECONDITION|ABORTED)\b/;

/**
 * Top-level failure text. Locally, the full message. Redacted (CI), the same
 * fixed vocabulary as the log's error notes (noteFor in rescreen.ts): the
 * error class, "annotate", an HTTP status and a gRPC code, never the message
 * itself, which can quote doc paths (users/{uid}, clips/...) or storage paths.
 * Kept here rather than imported because the compiled functions code may be
 * the thing that failed to load.
 */
export function failureText(error, redact) {
  const message = error instanceof Error ? error.message : String(error);
  if (!redact) return message;
  const name = error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : "error";
  const code = error && typeof error === "object" ? error.code : undefined;
  const parts = [
    /annotate/i.test(message) ? "annotate" : "",
    /\b[45]\d\d\b/.exec(message)?.[0] ?? "",
    GRPC_CODES.exec(message)?.[0] ?? "",
    typeof code === "number" && Number.isInteger(code) ? `code ${code}` : "",
  ].filter((part) => part.length > 0);
  return `${name}${parts.length > 0 ? ` (${parts.join(" ")})` : ""}; details are in Sentry or a local run`;
}

/** Entry point: main() plus the redaction-aware top-level failure line. */
export async function cli(argv = process.argv.slice(2), env = process.env, io = console) {
  try {
    return await main(argv, env, io);
  } catch (error) {
    const redact = env.GITHUB_ACTIONS === "true" || argv.includes("--redact");
    io.error(`rescreen: failed: ${failureText(error, redact)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().then((code) => process.exit(code));
}
