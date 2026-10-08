/**
 * Build-time feature flags.
 *
 * Feature freeze (2026-10): the core S.K.A.T.E. Challenge loop
 * (lobby → challenge → record → game → result → rematch) is the only
 * surface we ship. The "extras" — the spot Map (/map, /spots/:id), the
 * Clips feed (/feed) and Verified Pro (badge + admin grant panel) — stay in
 * the codebase but are hidden behind ONE switch:
 *
 *   VITE_FEATURE_EXTRAS_ENABLED=true   → extras visible (pre-freeze behaviour)
 *   unset / anything else              → extras hidden (DEFAULT)
 *
 * Defaults to OFF so a missing Vercel env var can never resurface a frozen
 * feature. Re-enable by setting the var to the literal string "true" in the
 * Vercel project and redeploying (VITE_* values are inlined at build time).
 *
 * Read through a function rather than a module-level constant so tests can
 * flip it with `vi.stubEnv` without re-importing modules. In a production
 * build Vite statically replaces the `import.meta.env.*` access, so the
 * call is effectively a constant.
 *
 * Schema mirror lives in src/lib/env.ts + src/vite-env.d.ts — keep in sync.
 */

/** Strict "true"-only parse, matching VITE_APPCHECK_ENABLED's convention. */
export function parseFlag(raw: unknown): boolean {
  return raw === "true";
}

/** True when the frozen Map / Clips feed / Verified Pro surfaces should render. */
export function isExtrasEnabled(): boolean {
  return parseFlag(import.meta.env.VITE_FEATURE_EXTRAS_ENABLED);
}

/**
 * Roll Dice (street dice / C-Lo). Separate from the extras freeze: it ships
 * off, and turning extras on must not surface it. Literal "true" only.
 */
export function isDiceEnabled(): boolean {
  return parseFlag(import.meta.env.VITE_FEATURE_DICE_ENABLED);
}
