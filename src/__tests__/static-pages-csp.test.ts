/**
 * Static pages in public/ are served as-is under the production CSP
 * (vercel.json): style-src 'self' https://api.mapbox.com and script-src with
 * no 'unsafe-inline'. An inline <style> block, a style="" attribute, an
 * inline <script> or an on*= handler is blocked by the browser, so the page
 * renders unstyled or broken. /support.html is the App Store Support URL, so
 * it must render.
 * Styles ship as files (public/support.css) instead.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const PUBLIC = join(ROOT, "public");

const htmlPages = [
  ...readdirSync(PUBLIC)
    .filter((n) => n.endsWith(".html"))
    .map((n) => join("public", n)),
  "index.html",
];

/** Inline <script> that executes (JSON data blocks like ld+json are not scripts). */
const inlineScript = /<script(?![^>]*\bsrc=)(?![^>]*type=["']application\/(?:ld\+)?json["'])[^>]*>\s*\S/i;

describe("static pages under the production CSP", () => {
  it("finds the support page", () => {
    expect(htmlPages).toContain(join("public", "support.html"));
  });

  it.each(htmlPages)("%s has no inline <style>, style= attribute or inline script", (page) => {
    const html = readFileSync(join(ROOT, page), "utf8");
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(inlineScript);
    // Inline event handlers (onclick= etc.) and javascript: URLs are blocked by script-src too.
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/(?:href|src|action)\s*=\s*["']?\s*javascript:/i);
  });

  it.each(htmlPages)("%s only links stylesheets that exist in public/", (page) => {
    const html = readFileSync(join(ROOT, page), "utf8");
    const hrefs = [...html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["'](\/[^"']+)["']/gi)].map((m) => m[1]);
    for (const href of hrefs) expect(existsSync(join(PUBLIC, href)), href).toBe(true);
  });

  it("support.html loads its styles from /support.css", () => {
    const html = readFileSync(join(PUBLIC, "support.html"), "utf8");
    expect(html).toMatch(/<link rel="stylesheet" href="\/support\.css">/);
  });
});

describe("vercel.json /support", () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
    redirects: { source: string; destination: string; permanent?: boolean; has?: unknown }[];
  };

  it.each(["/support", "/support/"])("redirects %s to the support page instead of the app's 404", (source) => {
    const r = vercel.redirects.find((x) => x.source === source && !x.has);
    expect(r).toEqual({ source, destination: "/support.html", permanent: true });
    expect(existsSync(join(PUBLIC, "support.html"))).toBe(true);
  });
});
