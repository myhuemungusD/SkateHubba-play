/**
 * Regression guard for the Vercel ESM cold-start crash the `.js`-extension
 * fix was landed for (commit e29c087).
 *
 * The sweep cron (`api/cron/sweep-expired-turns.ts`) runs on Vercel Node ESM,
 * which — unlike Vite or Vitest — does NOT extension-resolve relative
 * specifiers. Any extensionless relative import in the traced runtime graph
 * crashes the function at cold start with ERR_MODULE_NOT_FOUND. The bug is
 * silent locally (tsc + vitest both accept extensionless via
 * `moduleResolution: bundler`) and only surfaces in production.
 *
 * This test walks the entire relative-import graph reachable from the cron
 * entrypoint and asserts every relative specifier ends in a Node-resolvable
 * extension (`.js` / `.mjs` / `.cjs`). Adding a new relative import without an
 * extension here (or introducing a new source file into the graph that lacks
 * one) fails at CI time instead of at 2am on a production cold start.
 *
 * Bare specifiers (`firebase-admin/*`, `node:crypto`, `firebase/firestore`)
 * are skipped — those go through Node's package resolution and don't need the
 * extension.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const ENTRYPOINT = resolve(REPO_ROOT, "api/cron/sweep-expired-turns.ts");

/** Extensions Node's ESM loader resolves without help. */
const NODE_RESOLVABLE_EXTENSIONS = [".js", ".mjs", ".cjs"];

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

    // Sanity: we actually walked past the entrypoint. If the walker regressed
    // and only inspected the entry file, the assertion below would trivially
    // pass on a graph the fix already covers.
    expect(graph.size).toBeGreaterThanOrEqual(2);

    // Fail loudly on a specifier whose target source couldn't be located —
    // otherwise a bad refactor would show up as an opaque ENOENT in CI.
    expect(unresolvable).toEqual([]);

    const offenders: Array<{ file: string; specifier: string }> = [];
    for (const [file, specifiers] of graph) {
      for (const spec of specifiers) {
        if (!NODE_RESOLVABLE_EXTENSIONS.some((ext) => spec.endsWith(ext))) {
          offenders.push({ file: file.replace(`${REPO_ROOT}/`, ""), specifier: spec });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
