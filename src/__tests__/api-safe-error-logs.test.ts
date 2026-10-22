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

/**
 * A raw caught error handed to a log or serializer: Node prints the full message
 * and stack for `console.error(err)`, and `JSON.stringify` keeps the enumerable
 * fields firebase-admin and gRPC errors carry (`errorInfo`, `details`). Matched
 * over the whole comment-stripped file, because api/ logs are Prettier's
 * multi-line `console.warn(\n JSON.stringify({\n … }),\n)` blocks.
 */
const N = "(?:err|error|e|reason|caught|cause)";
const ARGS = String.raw`(?:[^()]|\([^()]*\))*?`; // console args, one level of nested parens, may span lines
const RAW = new RegExp(
  String.raw`\bconsole\.\w+\(${ARGS},\s*${N}\s*[,)]|\bconsole\.\w+\(\s*${N}\s*[,)]` + // console.x(…, err)
    String.raw`|\(\s*console\.\w+\s*\)` + // .catch(console.error)
    String.raw`|\bJSON\.stringify\(\s*${N}\s*[,)]` + // JSON.stringify(err)
    String.raw`|[{,]\s*\w+\s*:\s*${N}\s*[,}]|\{\s*${N}\s*[,}]` + // { e: err } / { err }
    String.raw`|\.\.\.\s*${N}\b(?!\s*\()|\[\s*${N}\s*[,\]]` + // { ...err } / [err]
    String.raw`|\b${N}\s*\+\s*["'\x60]|["'\x60]\s*\+\s*${N}\b` + // err + ""
    String.raw`|\bObject\.assign\([^)]*,\s*${N}\s*\)` + // Object.assign({}, err)
    String.raw`|\{\s*message\b[^}]*\}\s*=\s*${N}\b`, // const { message } = err
  "g",
);

/** 1-based line numbers of every leak in this source, comments ignored. */
function leakLines(source: string, { bad = true } = {}): number[] {
  const lines = codeLines(source);
  const found = new Set(bad ? lines.flatMap((line, i) => (BAD.test(line) ? [i + 1] : [])) : []);
  const code = lines.join("\n");
  for (const m of code.matchAll(RAW)) found.add(code.slice(0, m.index).split("\n").length);
  return [...found].sort((a, b) => a - b);
}

const leaks = (snippet: string) => leakLines(snippet).length > 0;

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
    // The ALLOW files read a message on purpose (BAD), but even they may never
    // hand a raw error to a log (RAW).
    const offenders = files.flatMap((file) => {
      const rel = relative(apiDir, file);
      return leakLines(readFileSync(file, "utf8"), { bad: !ALLOW.has(rel) }).map((line) => `${rel}:${line}`);
    });
    expect(offenders).toEqual([]);
  });

  it.each([
    "(err as Error).message",
    "String(err)",
    'err instanceof Error ? err.message : "unknown"',
    "`failed: ${err}`",
    "(err as Error).stack",
    "error:\n  err instanceof Error\n    ? err.message\n    : String(err),",
    "console.error(err);",
    'console.warn("failed", err);',
    "JSON.stringify(err)",
    "JSON.stringify({ e: err })",
    "const { message } = err;",
    'console.error(\n  "x",\n  err,\n);',
    "JSON.stringify({\n  event,\n  error: err,\n})",
    'console.error("x", safeErrorCode(err), err);',
    "p.catch(console.error);",
    "console.error({ ...err });",
    'console.error("x", [err]);',
    'const text = err + "";',
    "Object.assign({}, err)",
    'console.error(new Error("w"), err);',
  ])("catches %j", (snippet) => {
    expect(leaks(snippet)).toBe(true);
  });

  it.each([
    'captureServerError("x", err, { gameId });',
    'console.error(JSON.stringify({ event: "x", code: safeErrorCode(err) }));',
    "...describeInitFailure(err),",
    "throw raced ? err.inner : err;",
    'captureServerError(\n  "x",\n  err,\n  { gameId },\n);',
    'console.warn(\n  JSON.stringify({\n    event: "x",\n    code: safeErrorCode(err),\n  }),\n);',
  ])("allows %j", (snippet) => {
    expect(leaks(snippet)).toBe(false);
  });

  it("ignores comments and URLs", () => {
    const source = '/* err.message */\n// String(err)\nconst url = "https://example.test/x"; // e.stack\n';
    expect(leaks(source)).toBe(false);
  });

  it("reports the line a multi-line leak starts on", () => {
    expect(leakLines('const a = 1;\nconsole.error(\n  "x",\n  err,\n);\n')).toEqual([2]);
  });
});
