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
 * entrypoint and asserts every relative specifier ends in `.js`. Adding a new
 * relative import without `.js` here (or introducing a new source file into
 * the graph that doesn't) will fail this test at CI time instead of at 2am
 * on a production cold start.
 *
 * Bare specifiers (firebase-admin/*, node:crypto, firebase/firestore) are
 * skipped — those go through Node's package-resolution and don't need the
 * extension.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const ENTRYPOINT = resolve(REPO_ROOT, "api/cron/sweep-expired-turns.ts");

/**
 * Match every static import/export specifier in a TS source file. Handles
 * value, `import type`, and multi-line forms — a runtime edit could easily
 * convert one to the other without noticing the extension is missing.
 *
 * Both patterns anchor on `import`/`export` at statement start ( (?:^|[;\n])
 * then whitespace only ) so `from "…"` inside JSDoc prose or backticked code
 * examples does not produce false hits. The middle uses `[\s\S]*?` (lazy) so
 * `import {\n  X,\n} from "…"` is captured — plain `[^…\n]*?` would stop at
 * the newline and silently miss the specifier.
 *   • IMPORT_FROM — every `import … from "…"` / `export … from "…"` form.
 *   • BARE_IMPORT — side-effect imports (`import "specifier";`) that have no
 *     `from`.
 */
const IMPORT_FROM = /(?:^|[;\n])\s*(?:import|export)\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
const BARE_IMPORT = /(?:^|[;\n])\s*import\s+["']([^"']+)["']/g;

/** Read a source file and collect every specifier it imports/re-exports. */
function collectSpecifiers(file: string): string[] {
  const src = readFileSync(file, "utf-8");
  const found: string[] = [];
  for (const match of src.matchAll(IMPORT_FROM)) found.push(match[1]);
  for (const match of src.matchAll(BARE_IMPORT)) found.push(match[1]);
  return found;
}

/**
 * Walk the relative-import closure from `entry`. Returns a map of visited
 * absolute source paths → their outgoing relative specifiers (only). Bare
 * specifiers are ignored because they resolve via node_modules and don't need
 * `.js`.
 */
function walkRelativeGraph(entry: string): Map<string, string[]> {
  const visited = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    const specifiers = collectSpecifiers(file);
    const relative = specifiers.filter((s) => s.startsWith("./") || s.startsWith("../"));
    visited.set(file, relative);
    for (const spec of relative) {
      // Strip .js to find the sibling .ts source file. Every relative
      // specifier here targets a first-party TS source under src/.
      const bare = spec.replace(/\.js$/, "");
      const resolved = resolve(dirname(file), `${bare}.ts`);
      queue.push(resolved);
    }
  }
  return visited;
}

describe("sweep cron ESM cold-start guard", () => {
  it("every relative import in the traced runtime graph ends in .js", () => {
    const graph = walkRelativeGraph(ENTRYPOINT);

    // Sanity: we actually walked past the entrypoint. If the walker regressed
    // and only inspected the entry file, the assertion below would trivially
    // pass on a graph the fix already covers.
    expect(graph.size).toBeGreaterThanOrEqual(4);

    const offenders: Array<{ file: string; specifier: string }> = [];
    for (const [file, specifiers] of graph) {
      for (const spec of specifiers) {
        if (!spec.endsWith(".js")) {
          offenders.push({ file: file.replace(`${REPO_ROOT}/`, ""), specifier: spec });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
