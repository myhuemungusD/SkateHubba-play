#!/usr/bin/env node
/**
 * vercel-ignore-build.mjs — Vercel "Ignored Build Step" (vercel.json
 * `ignoreCommand`). Build minutes were ~83% of the Vercel bill because every
 * push to every branch (release-please, dependabot, docs-only PRs) did a full
 * build. GitHub Actions already tests those branches, so the Vercel build
 * added nothing.
 *
 * Vercel's contract: exit 0 = SKIP the build, exit 1 = BUILD.
 *
 * Rules, in order:
 *   1. Branches named release-please--* or dependabot/* always skip.
 *   2. Otherwise diff VERCEL_GIT_PREVIOUS_SHA (last successful deploy of
 *      this branch) against HEAD. A branch's first push has no previous
 *      deploy, so a non-main branch falls back to its merge-base with
 *      origin/main. If no base can be read, BUILD — never skip on a guess.
 *   3. Skip only when every changed file is known not to reach the web
 *      bundle or api/ (docs, CI, native shells, Cloud Functions, e2e, tests,
 *      markdown, Firebase rules...). Any other file, including ones nobody
 *      listed, means BUILD. Same rule on main, so production still deploys
 *      whenever app code changes.
 * Runs before `npm install`, so it may only use Node built-ins.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Branch prefixes that never need a Vercel deployment. */
export const SKIP_BRANCH_PREFIXES = ["release-please--", "dependabot/"];

/** scripts/ files the web build itself runs or imports — never skippable. */
const BUILD_SCRIPTS = new Set(["scripts/check-bundle-budget.mjs", "scripts/deferAppCss.ts"]);

/** Path patterns that cannot change the deployed site or api/. */
const NON_APP_PATTERNS = [
  /\.md$/i,
  /^docs\//,
  /^\.github\//,
  /^scripts\//,
  /^functions\//,
  /^e2e\//,
  /^rules-tests\//,
  /^ios\//,
  /^android\//,
  /^fastlane\//,
  /^resources\//,
  /^infra\//,
  /^\.husky\//,
  /^\.claude\//,
  /^\.skills\//,
  /^src\/.*\.test\.tsx?$/,
  /^src\/(.*\/)?__tests__\//,
  /^(firestore\.rules|storage\.rules|firestore\.indexes\.json)$/,
  /^firebase(\.[\w-]+)?\.json$/,
  /^\.firebaserc$/,
  /^(release-please-config\.json|\.release-please-manifest\.json)$/,
  /^(playwright\.config\.ts|tsconfig\.e2e\.json|capacitor\.config\.ts)$/,
  /^(Gemfile|Gemfile\.lock|LICENSE|\.lighthouserc\.json|\.editorconfig|\.lintstagedrc)$/,
  /^(\.gitignore|\.gitattributes|\.env\.example|\.prettierrc|eslint\.config\.js)$/,
];

/** True when this file cannot affect what Vercel deploys. */
export function isNonAppPath(file) {
  if (BUILD_SCRIPTS.has(file)) return false;
  return NON_APP_PATTERNS.some((re) => re.test(file));
}

/**
 * Decide whether to build. Pure: `changedFiles` is the diff list, or null
 * when the diff base was unavailable.
 * @returns {{ build: boolean, reason: string }}
 */
export function decide({ branch, changedFiles }) {
  const prefix = SKIP_BRANCH_PREFIXES.find((p) => (branch ?? "").startsWith(p));
  if (prefix) return { build: false, reason: `branch ${branch} matches ${prefix}*` };
  if (changedFiles === null) return { build: true, reason: "no diff base available, building to be safe" };
  if (changedFiles.length === 0) return { build: true, reason: "empty diff (redeploy), building" };
  const app = changedFiles.filter((f) => !isNonAppPath(f));
  if (app.length > 0) {
    const shown = app.slice(0, 5).join(", ");
    return { build: true, reason: `app files changed: ${shown}${app.length > 5 ? ", ..." : ""}` };
  }
  return { build: false, reason: `only non-app files changed (${changedFiles.length})` };
}

function git(args, run) {
  const r = run("git", args, { encoding: "utf-8" });
  return r.status === 0 ? r.stdout : null;
}

/** Changed files between `base` and HEAD, or null if the base can't be read. */
export function changedFilesSince(base, run = spawnSync) {
  if (!base || !/^[0-9a-f]{7,40}$/i.test(base)) return null;
  // Vercel clones shallowly; try to fetch the base commit if it's missing.
  if (git(["cat-file", "-e", `${base}^{commit}`], run) === null) {
    git(["fetch", "--quiet", "--depth=1", "origin", base], run);
  }
  const out = git(["diff", "--name-only", base, "HEAD"], run);
  if (out === null) return null;
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Where a branch with no previous deploy forked from main, or null. */
export function mainMergeBase(run = spawnSync) {
  if (git(["fetch", "--quiet", "--depth=200", "origin", "main"], run) === null) return null;
  const out = git(["merge-base", "HEAD", "FETCH_HEAD"], run);
  return out === null ? null : out.trim();
}

/** Entry point. Returns the exit code (0 = skip, 1 = build). */
export function main(env = process.env, run = spawnSync, log = console.log) {
  const branch = env.VERCEL_GIT_COMMIT_REF ?? "";
  const prefixSkip = SKIP_BRANCH_PREFIXES.some((p) => branch.startsWith(p));
  let base = env.VERCEL_GIT_PREVIOUS_SHA;
  if (!prefixSkip && !base && branch && branch !== "main") base = mainMergeBase(run);
  const changedFiles = prefixSkip ? [] : changedFilesSince(base, run);
  const { build, reason } = decide({ branch, changedFiles });
  log(`vercel-ignore-build: ${build ? "BUILD" : "SKIP"} (${reason})`);
  return build ? 1 : 0;
}

/* c8 ignore next 3 -- CLI entry guard; main() is unit-tested directly */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
