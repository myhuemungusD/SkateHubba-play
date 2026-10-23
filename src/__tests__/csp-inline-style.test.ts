/**
 * Guard for the production CSP's style-src (vercel.json): `'self'
 * https://api.mapbox.com`, with no 'unsafe-inline'. Under that policy the
 * browser blocks any <style> element or style="" attribute created at
 * runtime. The map's pulse ring used to inject one, and every map load logged
 * "Applying inline style violates ... style-src" while the ring rendered
 * unstyled. Styles ship as stylesheet files instead (see
 * src/components/map/spotMap.css). React `style={{}}` props are fine: they go
 * through CSSOM, which CSP does not block.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "__mocks__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Runtime inline-style sinks that style-src without 'unsafe-inline' blocks. */
const INLINE_STYLE_SINKS: ReadonlyArray<[string, RegExp]> = [
  ['createElement("style")', /createElement\(\s*["'`]style["'`]\s*\)/],
  ['setAttribute("style", ...)', /setAttribute\(\s*["'`]style["'`]/],
  ["style= inside an HTML string", /innerHTML[^;]*\sstyle=/],
];

describe("CSP style-src", () => {
  it("vercel.json keeps style-src free of 'unsafe-inline'", () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
      headers: { headers: { key: string; value: string }[] }[];
    };
    const csp = vercel.headers
      .flatMap((h) => h.headers)
      .find((h) => h.key.toLowerCase() === "content-security-policy")?.value;
    const styleSrc = csp?.split(";").find((d) => d.trim().startsWith("style-src"));
    expect(styleSrc).toBeDefined();
    expect(styleSrc).not.toContain("'unsafe-inline'");
  });

  it("no app code creates a runtime <style> element or style attribute", () => {
    const hits = sourceFiles(join(ROOT, "src")).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return INLINE_STYLE_SINKS.filter(([, re]) => re.test(text)).map(([what]) => `${relative(ROOT, file)}: ${what}`);
    });
    expect(hits).toEqual([]);
  });
});
