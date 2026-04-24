#!/usr/bin/env node
/**
 * check-file-length.mjs
 *
 * Soft budget (warning-only by default) for source-file length.
 *
 * Budgets:
 *   src/services/**     400 LOC
 *   src/screens/**      350 LOC
 *   src/components/**   250 LOC
 *
 * LOC definition:
 *   Non-empty, non-comment lines. A "comment line" is one whose trimmed text
 *   starts with "//" or sits inside a /* ... *\/ block comment. Tests and
 *   __tests__/__mocks__/*.d.ts files are excluded — these budgets target
 *   production code only.
 *
 * Usage:
 *   node scripts/check-file-length.mjs            # informational, exit 0
 *   node scripts/check-file-length.mjs --strict   # exit 1 if any file over budget
 *   node scripts/check-file-length.mjs --json     # JSON report on stdout
 *
 * Output (default):
 *   A sorted table of files over budget, sorted by overage (most over first).
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, relative, join, sep, dirname } from "node:path";

// Derive REPO_ROOT via fileURLToPath so the resolved path is correct on
// Windows too (URL.pathname would yield "/C:/..." which resolve() mangles).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BUDGETS = [
  { label: "services", root: "src/services", budget: 400 },
  { label: "screens", root: "src/screens", budget: 350 },
  { label: "components", root: "src/components", budget: 250 },
];

const IGNORED_DIRS = new Set(["__tests__", "__mocks__", "node_modules"]);

function parseArgs(argv) {
  const opts = { strict: false, json: false };
  for (const a of argv) {
    if (a === "--strict") opts.strict = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node scripts/check-file-length.mjs [--strict] [--json]\n" +
          "  --strict   Exit 1 if any file exceeds its budget (default: exit 0, informational).\n" +
          "  --json     Emit machine-readable JSON.",
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function walk(dir, out) {
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
    if (s.isDirectory()) walk(p, out);
    else if (s.isFile() && /\.(ts|tsx)$/.test(p) && !/\.test\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p)) {
      out.push(p);
    }
  }
}

/**
 * Count LOC per the definition in the header. Walks the file once, tracking
 * block-comment state, so /* ... *\/ spanning multiple lines is ignored.
 */
function countLoc(source) {
  const lines = source.split(/\r?\n/);
  let inBlock = false;
  let loc = 0;
  for (const raw of lines) {
    let line = raw;
    let code = "";
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf("*/", i);
        if (end === -1) {
          i = line.length;
        } else {
          inBlock = false;
          i = end + 2;
        }
      } else {
        const blockStart = line.indexOf("/*", i);
        const lineStart = line.indexOf("//", i);
        // Pick whichever comment marker comes first (if any).
        const nextComment =
          blockStart === -1
            ? lineStart
            : lineStart === -1
              ? blockStart
              : Math.min(blockStart, lineStart);
        if (nextComment === -1) {
          code += line.slice(i);
          i = line.length;
        } else {
          code += line.slice(i, nextComment);
          if (nextComment === lineStart) {
            // // comment — rest of line is a comment.
            i = line.length;
          } else {
            inBlock = true;
            i = nextComment + 2;
          }
        }
      }
    }
    if (code.trim().length > 0) loc += 1;
  }
  return loc;
}

function scanCategory(category) {
  const absRoot = resolve(REPO_ROOT, category.root);
  const files = [];
  if (existsSync(absRoot)) walk(absRoot, files);
  const rows = [];
  for (const f of files) {
    const source = readFileSync(f, "utf-8");
    const loc = countLoc(source);
    const rel = relative(REPO_ROOT, f).split(sep).join("/");
    rows.push({
      category: category.label,
      file: rel,
      loc,
      budget: category.budget,
      overage: loc - category.budget,
    });
  }
  return rows;
}

function formatTable(rows) {
  if (rows.length === 0) return "All files within budget.";
  const headers = ["Category", "File", "LOC", "Budget", "Overage"];
  const data = rows.map((r) => [
    r.category,
    r.file,
    String(r.loc),
    String(r.budget),
    "+" + r.overage,
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((row) => row[i].length)),
  );
  const fmt = (row) => row.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [fmt(headers), fmt(widths.map((w) => "-".repeat(w))), ...data.map(fmt)].join("\n");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const allRows = [];
  for (const cat of BUDGETS) allRows.push(...scanCategory(cat));
  const overBudget = allRows
    .filter((r) => r.overage > 0)
    .sort((a, b) => b.overage - a.overage);

  if (opts.json) {
    console.log(
      JSON.stringify(
        { budgets: BUDGETS, all: allRows, overBudget, strict: opts.strict },
        null,
        2,
      ),
    );
  } else {
    console.log("File length soft budget report");
    for (const b of BUDGETS) console.log(`  ${b.label.padEnd(12)} ${b.root.padEnd(20)} ${b.budget} LOC`);
    console.log("");
    if (overBudget.length === 0) {
      console.log("All files within budget.");
    } else {
      console.log(`${overBudget.length} file(s) over budget:\n`);
      console.log(formatTable(overBudget));
      console.log("");
      console.log(
        opts.strict
          ? "Strict mode: failing because files exceed their budget."
          : "Soft budget: informational only. Rerun with --strict to enforce locally.",
      );
    }
  }

  if (opts.strict && overBudget.length > 0) process.exit(1);
  process.exit(0);
}

main();
