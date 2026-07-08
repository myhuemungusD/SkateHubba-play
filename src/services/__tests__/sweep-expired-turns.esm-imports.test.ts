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

/** Strip the repo-root prefix so failure output is short and copy-pastable. */
const rel = (file: string): string => {
  const prefix = `${REPO_ROOT}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
};

/** Extensions Node's ESM loader resolves without help — the single source of truth. */
const NODE_RESOLVABLE_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

/** Source extensions the walker tries when mapping a runtime specifier back to its TS source. */
const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;

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
  // Pick ScriptKind by extension so a `.tsx` module reached via `resolveToSource`'s
  // fallback still parses correctly (JSX in `.ts` mode leans on parser recovery).
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, false, scriptKind);
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
 * Map a relative runtime specifier (`./foo.js`) to the on-disk TS source file
 * the walker needs to descend into. The walker follows sources — the compiled
 * `.js` artifacts don't exist until Vercel builds. Tries `<bare>.{ts,tsx}`
 * then `<bare>/index.{ts,tsx}` so a legitimate future refactor to a
 * directory-with-index doesn't crash the walker with an opaque ENOENT.
 *
 * Returns `null` when nothing resolves — the caller records the specifier as
 * unresolvable so the failure is actionable instead of a stack trace.
 */
function resolveToSource(fromFile: string, specifier: string): string | null {
  const runtimeExt = extname(specifier);
  const bare = NODE_RESOLVABLE_EXTENSIONS.has(runtimeExt) ? specifier.slice(0, -runtimeExt.length) : specifier;
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
  /** Specifiers whose target source file could not be located; `file` is repo-relative. */
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
        unresolvable.push({ file: rel(file), specifier: spec });
      }
    }
  }
  return { graph, unresolvable };
}

describe("sweep cron ESM cold-start guard", () => {
  it("every relative import in the traced runtime graph ends in a Node-resolvable extension", () => {
    // Guard against a silent entrypoint rename: readFileSync would otherwise
    // surface as a raw ENOENT with no context.
    expect(
      existsSync(ENTRYPOINT),
      `Cron entrypoint not found at ${rel(ENTRYPOINT)} — update ENTRYPOINT if it was moved.`,
    ).toBe(true);

    const { graph, unresolvable } = walkRelativeGraph(ENTRYPOINT);

    // Sanity: the walker actually recursed through the transitive graph. A
    // shallower walk would let the offender assertion below trivially pass on
    // the subgraph the fix already covers. The floor is deliberately loose so
    // legitimate graph contractions don't force a churn edit here — tighten it
    // only if the walker regresses in a way this doesn't catch.
    expect(graph.size).toBeGreaterThanOrEqual(4);

    // Fail loudly on a specifier whose target source couldn't be located —
    // otherwise a bad refactor would show up as an opaque ENOENT in CI.
    expect(unresolvable).toEqual([]);

    const offenders: Array<{ file: string; specifier: string }> = [];
    for (const [file, specifiers] of graph) {
      for (const spec of specifiers) {
        if (!NODE_RESOLVABLE_EXTENSIONS.has(extname(spec))) {
          offenders.push({ file: rel(file), specifier: spec });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
