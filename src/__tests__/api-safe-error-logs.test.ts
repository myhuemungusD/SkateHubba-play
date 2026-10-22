import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Vercel function logs and response bodies never carry a caught error's
 * message: it is free text that can quote its input (a uid in a Firestore doc
 * path, part of a secret in a JSON.parse failure). They log
 * `safeErrorCode(err)` / `safeErrorName(err)` from `api/_safeError.ts` instead.
 */
const apiDir = resolve(__dirname, "../../api");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("api/ error logging", () => {
  it("never stringifies a caught error's message into a log line or body", () => {
    const files = sourceFiles(apiDir);
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line, at: `${relative(apiDir, file)}:${i + 1}` }))
        .filter(({ line }) => /(\w+) instanceof Error \? \1\.message : String\(\1\)/.test(line))
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });
});
