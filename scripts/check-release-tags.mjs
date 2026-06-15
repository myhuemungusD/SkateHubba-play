#!/usr/bin/env node
/**
 * check-release-tags.mjs
 *
 * Pre-merge integrity gate for the release-please pipeline.
 *
 * Why this exists:
 *   A real outage shipped because `.release-please-manifest.json` claimed
 *   `v1.1.0` was released but no `v1.1.0` git tag existed. Release-please's
 *   "skip if already released" logic then silently no-op'd subsequent runs.
 *   This script asserts every manifest entry maps to a real tag so the drift
 *   cannot survive a PR review.
 *
 * What it checks:
 *   - Reads `.release-please-manifest.json` at the repo root.
 *   - For every `<path>: <version>` entry, asserts `git ls-remote --tags origin`
 *     contains a `refs/tags/v<version>` ref.
 *   - Falls back to local `git tag -l` when the remote call fails (offline,
 *     missing remote, sandboxed runner). In non-strict mode a total git
 *     failure is a warning, not a failure.
 *
 * Failure modes (distinct error messages — grep-friendly):
 *   - MANIFEST_MISSING_TAG  manifest entry has no matching tag in the source list
 *   - MANIFEST_MALFORMED    file is missing, not JSON, or wrong shape
 *   - GIT_CALL_FAILED       both remote and local git calls failed
 *
 * Usage:
 *   node scripts/check-release-tags.mjs           # warn-only on git failure
 *   node scripts/check-release-tags.mjs --strict  # always exit 1 on any failure
 *   node scripts/check-release-tags.mjs --json    # machine-readable output
 *
 * CI behaviour:
 *   The verify chain wires this script with `--strict` only under CI so local
 *   developers can run `npm run verify` offline without hitting a hard fail on
 *   a transient `git ls-remote` outage.
 *
 * Test hook:
 *   When `RELEASE_TAGS_SOURCE_FILE` is set, the script reads its newline-
 *   delimited list of tag names instead of calling git. This is used by the
 *   unit test fixture; production usage never sets it.
 *
 * Exit codes:
 *   0 — every manifest entry has a matching tag (or, non-strict, git failed)
 *   1 — at least one mismatch, malformed manifest, or, in strict mode, git failure
 *   2 — misuse (unknown flag, etc.)
 */

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, relative, dirname } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = resolve(REPO_ROOT, ".release-please-manifest.json");

/**
 * @typedef {Object} CliOpts
 * @property {boolean} strict
 * @property {boolean} json
 */

/**
 * @param {string[]} argv
 * @returns {CliOpts}
 */
function parseArgs(argv) {
  /** @type {CliOpts} */
  const opts = { strict: false, json: false };
  for (const a of argv) {
    if (a === "--strict") opts.strict = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      printHelp();
      process.exit(2);
    }
  }
  return opts;
}

function printHelp() {
  console.log(
    "Usage: node scripts/check-release-tags.mjs [--strict] [--json]\n" +
      "  --strict  Always exit 1 on any failure (including git/network errors).\n" +
      "  --json    Emit a machine-readable JSON report on stdout.",
  );
}

/**
 * Read `.release-please-manifest.json` and return a list of (path, version)
 * entries. Throws an Error with a tagged MANIFEST_MALFORMED prefix so callers
 * can detect the failure mode by string match.
 *
 * @returns {{ path: string, version: string }[]}
 */
function readManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(
      `MANIFEST_MALFORMED: ${relative(REPO_ROOT, MANIFEST_PATH)} does not exist`,
    );
  }
  let raw;
  try {
    raw = readFileSync(MANIFEST_PATH, "utf-8");
  } catch (err) {
    throw new Error(
      `MANIFEST_MALFORMED: failed to read ${relative(REPO_ROOT, MANIFEST_PATH)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `MANIFEST_MALFORMED: invalid JSON in ${relative(REPO_ROOT, MANIFEST_PATH)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `MANIFEST_MALFORMED: expected a JSON object of {path: version}, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
    );
  }
  /** @type {{ path: string, version: string }[]} */
  const entries = [];
  for (const [path, version] of Object.entries(/** @type {Record<string, unknown>} */ (parsed))) {
    if (typeof version !== "string" || version.length === 0) {
      throw new Error(
        `MANIFEST_MALFORMED: entry "${path}" has non-string or empty version (${typeof version})`,
      );
    }
    entries.push({ path, version });
  }
  if (entries.length === 0) {
    throw new Error(
      `MANIFEST_MALFORMED: ${relative(REPO_ROOT, MANIFEST_PATH)} has no entries`,
    );
  }
  return entries;
}

/**
 * Parse newline-delimited git output (either `git ls-remote --tags origin`
 * lines like `<sha>\trefs/tags/v1.0.0` or `git tag -l` lines like `v1.0.0`)
 * into a Set of tag names without the `refs/tags/` prefix or `^{}` peeled-tag
 * suffix that ls-remote sometimes emits.
 *
 * @param {string} output
 * @returns {Set<string>}
 */
function parseTagList(output) {
  /** @type {Set<string>} */
  const tags = new Set();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // ls-remote format: "<sha>\trefs/tags/<tag>" (possibly with trailing ^{}).
    const tabIdx = trimmed.indexOf("\t");
    let candidate = tabIdx === -1 ? trimmed : trimmed.slice(tabIdx + 1);
    if (candidate.startsWith("refs/tags/")) {
      candidate = candidate.slice("refs/tags/".length);
    }
    if (candidate.endsWith("^{}")) {
      candidate = candidate.slice(0, -3);
    }
    if (candidate) tags.add(candidate);
  }
  return tags;
}

/**
 * Run a git command and return its stdout. Throws on non-zero exit so callers
 * can distinguish "the command failed" from "the command succeeded with no
 * output" (a legitimately empty tag list).
 *
 * @param {string[]} args
 * @returns {string}
 */
function runGit(args) {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf-8" });
  if (r.error) throw new Error(`git ${args.join(" ")}: ${r.error.message}`);
  if (typeof r.status !== "number" || r.status !== 0) {
    const stderr = (r.stderr || "").trim();
    throw new Error(
      `git ${args.join(" ")} exited with status ${r.status ?? "unknown"}${stderr ? `: ${stderr}` : ""}`,
    );
  }
  return r.stdout ?? "";
}

/**
 * Resolve the set of known tag names. Strategy:
 *   1. If RELEASE_TAGS_SOURCE_FILE is set, read it (test hook).
 *   2. Try `git ls-remote --tags origin` (authoritative on origin).
 *   3. Fall back to `git tag -l` (local, may be stale).
 *
 * @returns {{ tags: Set<string>, source: "file" | "remote" | "local", warning: string | null }}
 */
function loadTagSources() {
  const override = process.env.RELEASE_TAGS_SOURCE_FILE;
  if (override) {
    const contents = readFileSync(override, "utf-8");
    return { tags: parseTagList(contents), source: "file", warning: null };
  }
  let remoteErr = null;
  try {
    const out = runGit(["ls-remote", "--tags", "origin"]);
    return { tags: parseTagList(out), source: "remote", warning: null };
  } catch (err) {
    remoteErr = err instanceof Error ? err.message : String(err);
  }
  try {
    const out = runGit(["tag", "-l"]);
    return {
      tags: parseTagList(out),
      source: "local",
      warning: `git ls-remote failed (${remoteErr}); fell back to local tags`,
    };
  } catch (err) {
    const localErr = err instanceof Error ? err.message : String(err);
    throw new Error(
      `GIT_CALL_FAILED: ls-remote (${remoteErr}) and tag -l (${localErr}) both failed`,
    );
  }
}

/**
 * Compute missing tags for the manifest.
 *
 * @param {{ path: string, version: string }[]} entries
 * @param {Set<string>} tags
 * @returns {{ path: string, version: string, expectedTag: string }[]}
 */
function findMissing(entries, tags) {
  /** @type {{ path: string, version: string, expectedTag: string }[]} */
  const missing = [];
  for (const e of entries) {
    const expected = `v${e.version}`;
    if (!tags.has(expected)) {
      missing.push({ path: e.path, version: e.version, expectedTag: expected });
    }
  }
  return missing;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  /** @type {{ path: string, version: string }[]} */
  let entries;
  try {
    entries = readManifest();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, code: "MANIFEST_MALFORMED", error: msg }, null, 2));
    } else {
      console.error(`Release tag gate: ${msg}`);
    }
    process.exit(1);
  }

  /** @type {{ tags: Set<string>, source: "file" | "remote" | "local", warning: string | null }} */
  let loaded;
  try {
    loaded = loadTagSources();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const degrade = !opts.strict;
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            ok: degrade,
            code: "GIT_CALL_FAILED",
            error: msg,
            degraded: degrade,
            strict: opts.strict,
          },
          null,
          2,
        ),
      );
    } else if (degrade) {
      console.warn(
        `Release tag gate: ${msg}. Skipping check (no --strict). Pass --strict (or run in CI) to require enforcement.`,
      );
    } else {
      console.error(`Release tag gate: ${msg}`);
    }
    process.exit(degrade ? 0 : 1);
  }

  const missing = findMissing(entries, loaded.tags);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: missing.length === 0,
          code: missing.length === 0 ? "OK" : "MANIFEST_MISSING_TAG",
          source: loaded.source,
          warning: loaded.warning,
          entries,
          missing,
        },
        null,
        2,
      ),
    );
    process.exit(missing.length === 0 ? 0 : 1);
  }

  if (loaded.warning) console.warn(`Release tag gate: ${loaded.warning}`);

  if (missing.length === 0) {
    console.log(
      `Release tag gate: OK. ${entries.length} manifest entr${entries.length === 1 ? "y" : "ies"} matched against ${loaded.tags.size} ${loaded.source} tag${loaded.tags.size === 1 ? "" : "s"}.`,
    );
    process.exit(0);
  }

  console.error(
    `Release tag gate: MANIFEST_MISSING_TAG — ${missing.length} manifest entr${missing.length === 1 ? "y has" : "ies have"} no matching git tag.`,
  );
  for (const m of missing) {
    console.error(`  - ${m.path}: expected tag "${m.expectedTag}" for version ${m.version} (not found in ${loaded.source} tags)`);
  }
  console.error(
    `Hint: run \`git tag v<version> <sha> && git push origin v<version>\` for the release that should already exist, or correct the manifest entry.`,
  );
  process.exit(1);
}

main();
