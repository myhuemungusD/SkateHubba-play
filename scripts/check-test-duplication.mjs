#!/usr/bin/env node
/**
 * check-test-duplication.mjs
 *
 * Lightweight, zero-dependency duplication gate for TEST FILES ONLY.
 *
 * Why this exists:
 *   Test files drift fast because copy/paste is the path of least resistance.
 *   This check stops new duplicated blocks from accreting in test code. It is
 *   intentionally NOT a general codebase-wide duplication gate.
 *
 * What it checks:
 *   - Globs: src/** matching *.test.ts / *.test.tsx, plus e2e/**, rules-tests/**
 *   - Slides a window of MIN_BLOCK_LINES lines over each file, normalizes each
 *     line (strips comments, collapses whitespace, drops pure-punctuation/import
 *     noise), hashes the block, and counts occurrences across files.
 *   - A block that appears >= DUP_THRESHOLD times is a duplicate.
 *
 * Baseline strategy (approach "a" from the task spec):
 *   Current offenders are snapshotted in scripts/test-duplication-baseline.json.
 *   The gate only fails on NEW duplicated block hashes not present in the
 *   baseline. Use `--update-baseline` to regenerate the snapshot after an
 *   intentional change.
 *
 * Configuration (via CLI flags):
 *   --min-lines=N     Minimum block size in normalized lines (default 6)
 *   --threshold=N     Fail if a block appears N or more times (default 2)
 *   --update-baseline Rewrite baseline file from current state (exits 0)
 *   --no-baseline     Ignore baseline, fail on every duplicate (for local use)
 *   --json            Machine-readable output on stdout
 *
 * Exit codes:
 *   0 — no NEW duplication beyond baseline
 *   1 — new duplication found
 *   2 — misuse / IO error
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative, join, sep } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const BASELINE_PATH = resolve(REPO_ROOT, "scripts/test-duplication-baseline.json");

const DEFAULTS = {
  minLines: 6,
  threshold: 2,
};

function parseArgs(argv) {
  const opts = {
    minLines: DEFAULTS.minLines,
    threshold: DEFAULTS.threshold,
    updateBaseline: false,
    useBaseline: true,
    json: false,
  };
  for (const arg of argv) {
    if (arg.startsWith("--min-lines=")) opts.minLines = Number(arg.split("=")[1]);
    else if (arg.startsWith("--threshold=")) opts.threshold = Number(arg.split("=")[1]);
    else if (arg === "--update-baseline") opts.updateBaseline = true;
    else if (arg === "--no-baseline") opts.useBaseline = false;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(2);
    }
  }
  if (!Number.isFinite(opts.minLines) || opts.minLines < 2) {
    console.error("--min-lines must be an integer >= 2");
    process.exit(2);
  }
  if (!Number.isFinite(opts.threshold) || opts.threshold < 2) {
    console.error("--threshold must be an integer >= 2");
    process.exit(2);
  }
  return opts;
}

function printHelp() {
  console.log(
    "Usage: node scripts/check-test-duplication.mjs [--min-lines=6] [--threshold=2] [--update-baseline] [--no-baseline] [--json]",
  );
}

/** Directory roots to scan and per-root file-match predicate. */
const SCAN_ROOTS = [
  { dir: resolve(REPO_ROOT, "src"), match: (p) => /\.test\.(ts|tsx)$/.test(p) },
  { dir: resolve(REPO_ROOT, "e2e"), match: (p) => /\.(ts|tsx)$/.test(p) },
  { dir: resolve(REPO_ROOT, "rules-tests"), match: (p) => /\.(ts|tsx)$/.test(p) },
];

const IGNORED_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);

function walk(dir, match, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (IGNORED_DIRS.has(name)) continue;
    const p = join(dir, name);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(p, match, out);
    else if (s.isFile() && match(p)) out.push(p);
  }
}

function collectTestFiles() {
  const files = [];
  for (const { dir, match } of SCAN_ROOTS) {
    if (!existsSync(dir)) continue;
    walk(dir, match, files);
  }
  return files.sort();
}

/**
 * Normalize a single line for duplication hashing. Removes comments, collapses
 * whitespace, and returns "" for lines that should not participate in block
 * hashing (imports, pure punctuation, blank). Returning "" causes the block
 * window to skip the line entirely.
 */
function normalizeLine(raw) {
  let line = raw;
  // Strip // line comments (naive — fine for test code).
  const slashIdx = line.indexOf("//");
  if (slashIdx !== -1) line = line.slice(0, slashIdx);
  // Strip /* ... */ block comments on single line.
  line = line.replace(/\/\*[\s\S]*?\*\//g, "");
  // Collapse whitespace.
  line = line.replace(/\s+/g, " ").trim();
  if (!line) return "";
  // Drop imports — shared imports are expected duplication and noisy to flag.
  if (/^import[\s{]/.test(line) || /^export\s+.*from\s+["']/.test(line)) return "";
  // Drop pure-punctuation lines like `});` or `}` — they create false matches.
  if (/^[\s{}()[\];,.]*$/.test(line)) return "";
  return line;
}

/**
 * Extract (normalizedLine, originalLineNumber) pairs for a file. The original
 * line number is 1-based and points at the raw source line so reports can
 * cite real file positions.
 */
function extractNormalizedLines(source) {
  const lines = source.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const n = normalizeLine(lines[i]);
    if (n) out.push({ text: n, lineNo: i + 1 });
  }
  return out;
}

function hashBlock(block) {
  const h = createHash("sha1");
  for (const entry of block) h.update(entry.text + "\n");
  return h.digest("hex");
}

/**
 * Scan all test files and return a Map<hash, Occurrence[]> for blocks of
 * exactly `minLines` normalized lines that repeat. Only blocks with >=
 * threshold occurrences are kept.
 */
function findDuplicates(files, minLines, threshold) {
  /** @type {Map<string, {file: string, startLine: number, endLine: number, snippet: string[]}[]>} */
  const hashes = new Map();
  for (const absPath of files) {
    const rel = relative(REPO_ROOT, absPath).split(sep).join("/");
    let source;
    try {
      source = readFileSync(absPath, "utf-8");
    } catch (err) {
      console.error(`Failed to read ${rel}: ${err.message}`);
      process.exit(2);
    }
    const normalized = extractNormalizedLines(source);
    if (normalized.length < minLines) continue;
    for (let i = 0; i + minLines <= normalized.length; i++) {
      const block = normalized.slice(i, i + minLines);
      const h = hashBlock(block);
      const occ = {
        file: rel,
        startLine: block[0].lineNo,
        endLine: block[block.length - 1].lineNo,
        snippet: block.map((b) => b.text),
      };
      const arr = hashes.get(h);
      if (arr) arr.push(occ);
      else hashes.set(h, [occ]);
    }
  }
  // Filter: only blocks meeting the duplicate threshold.
  const dupes = new Map();
  for (const [h, occs] of hashes) {
    if (occs.length >= threshold) dupes.set(h, occs);
  }
  return dupes;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { hashes: [] };
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
  } catch (err) {
    console.error(`Baseline file invalid JSON (${BASELINE_PATH}): ${err.message}`);
    process.exit(2);
  }
}

function writeBaseline(dupes, opts) {
  const hashes = [...dupes.keys()].sort();
  const payload = {
    generatedAt: new Date().toISOString(),
    minLines: opts.minLines,
    threshold: opts.threshold,
    note:
      "Autogenerated by scripts/check-test-duplication.mjs. " +
      "Represents existing duplicate blocks that predate the gate. " +
      "Do not hand-edit — run with --update-baseline to refresh.",
    hashes,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + "\n");
}

function renderReport(newDupes, opts) {
  const entries = [...newDupes.entries()].sort((a, b) => b[1].length - a[1].length);
  if (opts.json) {
    console.log(
      JSON.stringify(
        entries.map(([h, occs]) => ({
          hash: h,
          count: occs.length,
          occurrences: occs.map((o) => ({
            file: o.file,
            startLine: o.startLine,
            endLine: o.endLine,
          })),
          snippet: occs[0].snippet,
        })),
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    `\nTest duplication gate: ${entries.length} NEW duplicate block${entries.length === 1 ? "" : "s"} ` +
      `(minLines=${opts.minLines}, threshold=${opts.threshold}).\n`,
  );
  for (const [, occs] of entries) {
    console.log(`Duplicate (x${occs.length}):`);
    for (const o of occs) console.log(`  - ${o.file}:${o.startLine}-${o.endLine}`);
    console.log("  snippet:");
    for (const line of occs[0].snippet) console.log(`    | ${line}`);
    console.log("");
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = collectTestFiles();
  if (files.length === 0) {
    console.warn("No test files found — nothing to scan.");
    process.exit(0);
  }
  const dupes = findDuplicates(files, opts.minLines, opts.threshold);

  if (opts.updateBaseline) {
    writeBaseline(dupes, opts);
    console.log(
      `Baseline updated: ${dupes.size} duplicate block hashes written to ${relative(REPO_ROOT, BASELINE_PATH)}`,
    );
    process.exit(0);
  }

  const baseline = opts.useBaseline ? new Set(loadBaseline().hashes) : new Set();
  const newDupes = new Map();
  for (const [h, occs] of dupes) {
    if (!baseline.has(h)) newDupes.set(h, occs);
  }

  if (newDupes.size === 0) {
    if (!opts.json) {
      console.log(
        `Test duplication gate: clean. Scanned ${files.length} files, ` +
          `${dupes.size} baseline duplicate block(s), 0 new.`,
      );
    } else {
      console.log("[]");
    }
    process.exit(0);
  }

  renderReport(newDupes, opts);
  console.error(
    `\nFail: ${newDupes.size} new duplicate block(s) detected in test files. ` +
      `Extract a helper, parametrize the case, or (if intentional) rerun with ` +
      `\`node scripts/check-test-duplication.mjs --update-baseline\`.`,
  );
  process.exit(1);
}

main();
