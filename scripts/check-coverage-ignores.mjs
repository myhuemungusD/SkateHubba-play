#!/usr/bin/env node
/**
 * check-coverage-ignores.mjs
 *
 * Every coverage-ignore hint must say why. A bare `/* v8 ignore next *\/`
 * hides a branch from the 100% gates with no record of whether it is truly
 * untestable or just untested, and the next reader cannot tell.
 *
 * Rule: a `v8 ignore`, `c8 ignore`, `istanbul ignore` or `node:coverage
 * ignore` hint (next, next N, start, if, else, file) must carry a written
 * reason after `--`. These are the four prefixes the coverage remapper
 * (ast-v8-to-istanbul) honors. Every hint on a line is checked, not just the
 * first, and the reason must be on the same line as the hint:
 *
 *   /* v8 ignore next -- jsdom has no WebGL context *\/
 *
 * `ignore stop` closes a block and needs no reason of its own. The reason
 * must be a real explanation: at least two words (each with 2+ letters) and
 * at least 10 characters, and not a placeholder, so `-- x`, `-- abc` or
 * `-- todo` do not pass. A reason wrapped onto the next line of a block
 * comment is reported as missing; keep it on the hint's line.
 *
 * Scans: src/, api/, functions/src/ and scripts/ (the code our coverage and
 * lint gates cover). Test files (`__tests__/`, `*.test.*`) are skipped: they
 * are outside coverage, and tests of this script quote bare hints on purpose.
 * Wired into `npm run verify` and CI (build-and-test).
 *
 * Exit codes: 0 clean, 1 at least one hint without a reason.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["src", "api", "functions/src", "scripts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", "__fixtures__", "__tests__"]);
const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

// Global: a line can carry more than one hint. The capture stops at the end
// of the enclosing block comment, so a later hint is matched on its own.
const HINT = /\b(?:v8|c8|istanbul|node:coverage)\s+ignore\b((?:(?!\*\/).)*)/g;
const STOP = /^\s*stop\b/;
const PLACEHOLDER = /^(todo|tbd|fixme|reason|n\/?a)$/i;

/**
 * Returns null when the hint is fine, or a short problem description.
 * Exported for the unit test.
 */
export function checkHintLine(line) {
  for (const m of line.matchAll(HINT)) {
    const problem = checkHintRest(m[1]);
    if (problem) return problem;
  }
  return null;
}

/** Minimum bar for a reason: two real words and 10+ characters. */
function isRealReason(reason) {
  if (reason.length < 10 || PLACEHOLDER.test(reason)) return false;
  const words = reason.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
  return words.length >= 2;
}

function checkHintRest(rest) {
  if (STOP.test(rest)) return null;
  const sep = rest.indexOf("--");
  if (sep === -1) return "coverage ignore without a reason (add `-- why this cannot be tested`)";
  const reason = rest
    .slice(sep + 2)
    .replace(/@preserve/g, "")
    .trim();
  if (!isRealReason(reason)) {
    return "coverage ignore reason is empty, a placeholder or too short (explain why in a few words)";
  }
  return null;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (EXTENSIONS.test(name) && !TEST_FILE.test(name)) yield full;
  }
}

export function scan(rootDir = REPO_ROOT, roots = ROOTS) {
  const problems = [];
  for (const root of roots) {
    for (const file of walk(join(rootDir, root))) {
      // This script documents the syntax in its own comments.
      if (resolve(file) === fileURLToPath(import.meta.url)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const problem = checkHintLine(line);
        if (problem) problems.push({ file: relative(rootDir, file), line: i + 1, problem, text: line.trim() });
      });
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = scan();
  if (problems.length === 0) {
    console.log("check-coverage-ignores: every coverage ignore has a reason.");
    process.exit(0);
  }
  for (const p of problems) {
    console.error(`${p.file}:${p.line}: ${p.problem}\n    ${p.text}`);
  }
  console.error(`\n${problems.length} coverage ignore(s) without a reason. Write why, or test the code instead.`);
  process.exit(1);
}
