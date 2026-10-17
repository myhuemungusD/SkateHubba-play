/**
 * Zod's first parse probes `new Function("")` unless `jitless` is already set.
 * A strict CSP still reports that caught call in the DevTools Issues panel,
 * which fails Lighthouse best-practices (`inspector-issues`).
 *
 * Import this module before `zod`. Zod keeps an existing
 * `globalThis.__zod_globalConfig`, so the flag is on before the probe runs.
 */
const scope = globalThis as typeof globalThis & {
  __zod_globalConfig?: { jitless?: boolean };
};

scope.__zod_globalConfig ??= {};
scope.__zod_globalConfig.jitless = true;
