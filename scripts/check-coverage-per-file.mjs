#!/usr/bin/env node
/**
 * check-coverage-per-file.mjs
 *
 * Per-file coverage ratchet for the UI floors in vite.config.ts.
 *
 * Why this exists:
 *   The vitest thresholds for src/components/** and src/screens/** are
 *   AGGREGATE floors. A single file can drop to 0% — a component moved to a
 *   new path, a screen added without a test — and the glob still passes as
 *   long as everything else averages it out. That is exactly how PR #534
 *   shipped FeedScreen at 0% and PlayerDirectory at 18% branches.
 *
 *   vitest's `thresholds.perFile` closes that hole but is global across every
 *   glob, and at the 80/80/75/80 floors dozens of pre-existing files would
 *   fail on day one. This script applies the per-file rule with a baseline:
 *
 *   - A file NOT in the baseline must meet the floor on every metric.
 *   - A file IN the baseline may sit below the floor, but must not regress
 *     below the value recorded for it. Once it meets the floor, it is
 *     reported as graduated and should be pruned with --update-baseline.
 *   - The baseline only shrinks. --update-baseline never ADDS a file that is
 *     below the floor; new offenders must be fixed, not baselined.
 *
 * Input:
 *   coverage/coverage-summary.json — written by `vitest run --coverage`
 *   (reporter "json-summary" in vite.config.ts). Run this AFTER coverage.
 *
 * Flags:
 *   --update-baseline  Prune graduated files and refresh recorded values for
 *                      remaining entries (values can only go up). Exits 0.
 *   --json             Machine-readable output.
 *
 * Exit codes:
 *   0 — every file meets its floor or its baseline
 *   1 — a file is below the floor (unlisted) or regressed (listed)
 *   2 — misuse / IO error (missing summary, unreadable baseline)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, relative, dirname, sep } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUMMARY_PATH = resolve(REPO_ROOT, "coverage/coverage-summary.json");
const BASELINE_PATH = resolve(REPO_ROOT, "scripts/coverage-per-file-baseline.json");

const METRICS = ["lines", "functions", "branches", "statements"];

/**
 * Per-file floors. Keep in sync with the glob thresholds in vite.config.ts —
 * this script is the per-file half of the same contract.
 */
const FLOORS = [
  { prefix: "src/components/", floor: { lines: 80, functions: 80, branches: 75, statements: 80 } },
  { prefix: "src/screens/", floor: { lines: 80, functions: 80, branches: 75, statements: 80 } },
];

/** Float noise guard: V8 pcts are deterministic, but round-trip through JSON. */
const EPSILON = 0.005;

function parseArgs(argv) {
  const opts = { updateBaseline: false, json: false };
  for (const arg of argv) {
    if (arg === "--update-baseline") opts.updateBaseline = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-coverage-per-file.mjs [--update-baseline] [--json]");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

function toPosix(p) {
  return p.split(sep).join("/");
}

function floorFor(file) {
  const entry = FLOORS.find(({ prefix }) => file.startsWith(prefix));
  return entry ? entry.floor : null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function loadSummary() {
  if (!existsSync(SUMMARY_PATH)) {
    console.error(
      `Missing ${relative(REPO_ROOT, SUMMARY_PATH)} — run \`vitest run --coverage\` first (json-summary reporter).`,
    );
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(SUMMARY_PATH, "utf8"));
  const files = new Map();
  for (const [key, data] of Object.entries(raw)) {
    if (key === "total") continue;
    const file = toPosix(relative(REPO_ROOT, key));
    const pct = {};
    for (const m of METRICS) pct[m] = round2(data[m].pct);
    files.set(file, pct);
  }
  return files;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { files: {} };
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    return { files: parsed.files ?? {} };
  } catch (err) {
    console.error(`Could not read ${relative(REPO_ROOT, BASELINE_PATH)}: ${err.message}`);
    process.exit(2);
  }
}

function meetsFloor(pct, floor) {
  return METRICS.every((m) => pct[m] + EPSILON >= floor[m]);
}

function evaluate(files, baseline) {
  const failures = [];
  const graduated = [];
  const seen = new Set();

  for (const [file, pct] of files) {
    const floor = floorFor(file);
    if (!floor) continue;
    const recorded = baseline.files[file];

    if (recorded) {
      seen.add(file);
      if (meetsFloor(pct, floor)) {
        graduated.push(file);
        continue;
      }
      for (const m of METRICS) {
        if (pct[m] + EPSILON < recorded[m]) {
          failures.push({ file, metric: m, actual: pct[m], required: recorded[m], kind: "regressed" });
        }
      }
      continue;
    }

    for (const m of METRICS) {
      if (pct[m] + EPSILON < floor[m]) {
        failures.push({ file, metric: m, actual: pct[m], required: floor[m], kind: "below-floor" });
      }
    }
  }

  const stale = Object.keys(baseline.files).filter((f) => !seen.has(f) && !files.has(f));
  return { failures, graduated, stale };
}

function writeBaseline(files, baseline, { graduated, stale }) {
  const next = {};
  for (const [file, recorded] of Object.entries(baseline.files)) {
    if (graduated.includes(file) || stale.includes(file)) continue;
    const pct = files.get(file);
    const merged = {};
    // Ratchet: a recorded value only ever moves up.
    for (const m of METRICS) merged[m] = pct ? Math.max(recorded[m], pct[m]) : recorded[m];
    next[file] = merged;
  }
  const sorted = Object.fromEntries(
    Object.keys(next)
      .sort()
      .map((k) => [k, next[k]]),
  );
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: "Files under the per-file UI coverage floor when the gate was introduced. Each entry is the minimum coverage that file may have; the list only shrinks. Do not add files by hand — fix their coverage instead. Prune graduated entries with `node scripts/check-coverage-per-file.mjs --update-baseline`.",
        floors: Object.fromEntries(FLOORS.map(({ prefix, floor }) => [`${prefix}**`, floor])),
        files: sorted,
      },
      null,
      2,
    ) + "\n",
  );
  return Object.keys(sorted).length;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = loadSummary();
  const baseline = loadBaseline();
  const result = evaluate(files, baseline);

  if (opts.updateBaseline) {
    const remaining = writeBaseline(files, baseline, result);
    console.log(
      `Baseline updated: ${remaining} file(s) remain below the floor, ${result.graduated.length} graduated, ${result.stale.length} stale entries pruned.`,
    );
    if (result.failures.length > 0) {
      console.log(`NOTE: ${result.failures.length} failure(s) were NOT baselined — the list only shrinks. Fix them:`);
      for (const f of result.failures)
        console.log(`  ${f.file} ${f.metric} ${f.actual}% (${f.kind}, need ${f.required}%)`);
    }
    process.exit(0);
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.failures) {
      const why =
        f.kind === "regressed"
          ? `regressed below its baseline (${f.required}%)`
          : `does not meet the per-file floor (${f.required}%)`;
      console.error(`ERROR: Coverage for ${f.metric} (${f.actual}%) ${why} for ${f.file}`);
    }
    for (const file of result.graduated) {
      console.log(`Graduated: ${file} now meets the floor — prune it with --update-baseline.`);
    }
    for (const file of result.stale) {
      console.log(`Stale baseline entry (file no longer measured): ${file} — prune it with --update-baseline.`);
    }
    const checked = [...files.keys()].filter((f) => floorFor(f)).length;
    console.log(
      `Per-file coverage gate: ${result.failures.length === 0 ? "clean" : "FAILED"}. ` +
        `Checked ${checked} UI file(s), ${Object.keys(baseline.files).length} baselined, ${result.failures.length} failure(s).`,
    );
  }

  process.exit(result.failures.length > 0 ? 1 : 0);
}

main();
