/**
 * Regression guard for the Vercel ESM cold-start crash fixed in PR #419.
 *
 * The sweep cron (`api/cron/sweep-expired-turns.ts`) runs on Vercel Node ESM,
 * which — unlike tsc or vitest under `moduleResolution: bundler` — does NOT
 * extension-resolve relative specifiers. Any extensionless relative import in
 * the traced runtime graph crashes cold start with ERR_MODULE_NOT_FOUND, and
 * the bug is silent locally: it only surfaces in production.
 *
 * This test walks the relative-import closure from the cron entrypoint and
 * asserts every relative specifier ends in a Node-resolvable extension
 * (`.js` / `.mjs` / `.cjs`), so a dropped extension fails in CI instead of at
 * 2am on a cold start. Bare specifiers (`firebase-admin/*`, `node:crypto`)
 * are skipped — those go through Node's package resolution.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const ENTRYPOINT = resolve(REPO_ROOT, "api/cron/sweep-expired-turns.ts");

/** Extensions Node's ESM loader resolves without help. */
const NODE_RESOLVABLE_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

/** Source extensions to try when resolving a `.js` specifier to its TS sibling. */
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

/**
 * Collect every static and dynamic import/export specifier in a TS source
 * file, using the TypeScript compiler's AST so comments, template literals,
 * and string-valued expressions can never masquerade as imports. Covers:
 *   • `import x from "…"` / `import "…"` / `import type { … } from "…"`
 *   • `export { … } from "…"` / `export * from "…"` / `export type { … } from "…"`
 *   • `import("…")` (dynamic — Vercel ESM enforces the same rule)
 */
function collectSpecifiers(file: string): string[] {
  const src = readFileSync(file, "utf-8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, /*setParentNodes*/ false, ts.ScriptKind.TS);
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * Resolve a relative `.js`-flavored specifier to the on-disk TS source file
 * it points to. Vercel's build reads the TS source, so we walk sources — not
 * `.js` artifacts. Tries `.ts`, `.tsx`, then `<bare>/index.{ts,tsx}` so a
 * legitimate future refactor to a directory-with-index or a `.tsx` module
 * doesn't crash the walker with an opaque ENOENT.
 *
 * Returns `null` when nothing resolves — the caller records the specifier as
 * unresolvable so the failure is actionable instead of a stack trace.
 */
function resolveToSource(fromFile: string, specifier: string): string | null {
  const bare = specifier.replace(/\.(?:js|mjs|cjs)$/, "");
  const base = resolve(dirname(fromFile), bare);
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = resolve(base, `index${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface WalkResult {
  /** Absolute source path → outgoing relative specifiers (only). */
  graph: Map<string, string[]>;
  /** Relative specifiers whose target source file could not be located. */
  unresolvable: Array<{ file: string; specifier: string }>;
}

/**
 * Walk the relative-import closure from `entry`. Bare specifiers are ignored
 * because they resolve via node_modules and don't need an extension.
 */
function walkRelativeGraph(entry: string): WalkResult {
  const graph = new Map<string, string[]>();
  const unresolvable: WalkResult["unresolvable"] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (graph.has(file)) continue;
    const specifiers = collectSpecifiers(file);
    const relative = specifiers.filter((s) => s.startsWith("./") || s.startsWith("../"));
    graph.set(file, relative);
    for (const spec of relative) {
      const resolved = resolveToSource(file, spec);
      if (resolved) {
        queue.push(resolved);
      } else {
        unresolvable.push({ file: file.replace(`${REPO_ROOT}/`, ""), specifier: spec });
      }
    }
  }
  return { graph, unresolvable };
}

describe("sweep cron ESM cold-start guard", () => {
  it("every relative import in the traced runtime graph ends in a Node-resolvable extension", () => {
    const { graph, unresolvable } = walkRelativeGraph(ENTRYPOINT);

    // Sanity: the walker actually recursed through the transitive graph. The
    // current closure is 5 files (entry + turnForfeit.shared + turnDuration +
    // games.mappers + trickCategories); we assert ≥4 to leave one file of
    // headroom for legitimate contraction while still catching a walker that
    // stops after one hop — a shallower walk would let the offender assertion
    // below trivially pass on the subgraph the fix already covers.
    expect(graph.size).toBeGreaterThanOrEqual(4);

    // Fail loudly on a specifier whose target source couldn't be located —
    // otherwise a bad refactor would show up as an opaque ENOENT in CI.
    expect(unresolvable).toEqual([]);

    const offenders: Array<{ file: string; specifier: string }> = [];
    for (const [file, specifiers] of graph) {
      for (const spec of specifiers) {
        if (!NODE_RESOLVABLE_EXTENSIONS.has(extname(spec))) {
          offenders.push({ file: file.replace(`${REPO_ROOT}/`, ""), specifier: spec });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
