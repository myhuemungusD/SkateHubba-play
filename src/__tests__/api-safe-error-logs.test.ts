import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Vercel function logs and response bodies never carry a caught error's
 * message or stack: it is free text that can quote its input (a uid in a
 * Firestore doc path, part of a secret in a JSON.parse failure). They log
 * `safeErrorCode(err)` / `safeErrorName(err)` from `api/_safeError.ts` instead.
 *
 * The scan is deliberately broad: any `.message` / `.stack` access and any
 * stringified error variable fails, whatever the formatting. Only the files
 * that read a message on purpose without logging it are allowed.
 */
const apiDir = resolve(__dirname, "../../api");

/** Read a message on purpose, never log it: the helpers, Sentry's scrubbed capture, init-failure classification. */
const ALLOW = new Set(["_safeError.ts", "_sentry.ts", "cron/_serviceAccount.ts"]);

/** `.message` / `.stack` access, `String(err)`, and `${err}` for the usual catch names. */
const BAD = /\.(message|stack)\b|\bString\(\s*(err|error|e|reason)\s*\)|\$\{\s*(err|error|e|reason)\s*\}/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

/** Lines of code with comments blanked, line numbers kept. */
function codeLines(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"));
}

describe("api/ error logging", () => {
  it("never puts a caught error's message or stack into a log line or body", () => {
    const files = sourceFiles(apiDir);
    expect(files.length).toBeGreaterThan(10);
    const offenders = files
      .filter((file) => !ALLOW.has(relative(apiDir, file)))
      .flatMap((file) =>
        codeLines(readFileSync(file, "utf8"))
          .map((line, i) => ({ line, at: `${relative(apiDir, file)}:${i + 1}` }))
          .filter(({ line }) => BAD.test(line))
          .map(({ at }) => at),
      );
    expect(offenders).toEqual([]);
  });

  it.each([
    "(err as Error).message",
    "String(err)",
    'err instanceof Error ? err.message : "unknown"',
    "`failed: ${err}`",
    "(err as Error).stack",
    "error:\n  err instanceof Error\n    ? err.message\n    : String(err),",
  ])("catches %j", (snippet) => {
    expect(codeLines(snippet).some((line) => BAD.test(line))).toBe(true);
  });

  it("ignores comments and URLs", () => {
    const source = '/* err.message */\n// String(err)\nconst url = "https://example.test/x"; // e.stack\n';
    expect(codeLines(source).some((line) => BAD.test(line))).toBe(false);
  });
});
