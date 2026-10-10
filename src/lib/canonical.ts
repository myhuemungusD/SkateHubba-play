/**
 * Absolute canonicals for the public routes Lighthouse loads.
 * A canonical that points at the homepage from any other path fails the
 * SEO audit ("points to the domain's root"). Keep the path list in sync
 * with the map in public/lcp-shell.js — that script runs before React.
 */

export const SITE_ORIGIN = "https://skatehubba.com";

const CANONICAL_PATHS: ReadonlySet<string> = new Set(["/", "/auth", "/feed", "/privacy", "/terms", "/data-deletion"]);

export function normalizeCanonicalPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

/** Absolute canonical for a public route, or null when this path has none. */
export function canonicalHref(pathname: string): string | null {
  const path = normalizeCanonicalPath(pathname);
  if (!CANONICAL_PATHS.has(path)) return null;
  return `${SITE_ORIGIN}${path === "/" ? "/" : path}`;
}

/** Point the existing `<link rel="canonical">` at the current public route. */
export function applyCanonical(pathname: string): void {
  const href = canonicalHref(pathname);
  if (!href) return;
  const link = document.querySelector<HTMLLinkElement>('head link[rel="canonical"]');
  if (!link || link.href === href) return;
  link.href = href;
}
