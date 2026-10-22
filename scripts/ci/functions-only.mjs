#!/usr/bin/env node
/**
 * Build and check the `--only` target for .github/workflows/firebase-functions-deploy.yml.
 *
 * WHY: firebase-tools treats each comma-separated `--only` entry as its own
 * selector, and only entries that start with `functions:` select a function
 * (firebase-tools src/deploy/functions/functionsDeployHelper.ts). The workflow
 * used to emit `functions:a,b,c`, so b and c were dropped without an error.
 * Run 39634702670 (2026-10-21) asked for diceAction,pushDispatchOnCreate,
 * pushDispatchSweep and deployed only diceAction.
 *
 * Usage (both read the comma-separated names from $FUNCTIONS):
 *   node scripts/ci/functions-only.mjs only          -> prints the --only value
 *   node scripts/ci/functions-only.mjs verify <log>  -> exits 1 unless every
 *       requested function logged "Successful create|update operation".
 *       firebase-tools never skips a function named in --only, so a missing
 *       line means the function was not deployed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "functions:";
const NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * Parse the workflow input into bare function names. Trims spaces, skips
 * empty entries, strips an existing `functions:` prefix, and drops duplicates.
 * Throws on a name firebase-tools would not accept.
 */
export function parseFunctionNames(raw) {
  const names = [];
  for (const part of String(raw ?? "").split(",")) {
    let name = part.trim();
    if (name.startsWith(PREFIX)) name = name.slice(PREFIX.length).trim();
    if (name === "") continue;
    if (!NAME_RE.test(name)) {
      throw new Error(`Invalid function name "${name}". Use names like diceAction,diceSweep.`);
    }
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** The `--only` value: every name prefixed, or plain `functions` (deploy all) when none were given. */
export function buildOnly(raw) {
  const names = parseFunctionNames(raw);
  return names.length === 0 ? "functions" : names.map((n) => PREFIX + n).join(",");
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Requested names with no "functions[name(region)] Successful create|update operation." line in the log. */
export function missingFromLog(names, log) {
  const text = String(log).replace(ANSI_RE, "");
  return names.filter((name) => {
    const re = new RegExp(`functions\\[${name}\\([^)]*\\)\\] Successful (create|update) operation`);
    return !re.test(text);
  });
}

function main(argv) {
  const [mode, logPath] = argv;
  try {
    if (mode === "only") {
      console.log(buildOnly(process.env.FUNCTIONS));
      return 0;
    }
    if (mode === "verify") {
      const names = parseFunctionNames(process.env.FUNCTIONS);
      if (names.length === 0) {
        console.log("Deploy-all run: nothing to verify by name.");
        return 0;
      }
      if (!logPath) throw new Error("verify needs the deploy log path.");
      const missing = missingFromLog(names, readFileSync(logPath, "utf-8"));
      if (missing.length > 0) {
        console.log(`::error::Requested but not deployed: ${missing.join(", ")}`);
        return 1;
      }
      console.log(`Verified deployed: ${names.join(", ")}`);
      return 0;
    }
    throw new Error("Usage: functions-only.mjs only | verify <log>");
  } catch (err) {
    console.log(`::error::${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
