# Dependency Audit Report

**Date:** 2026-04-05
**Previous audit:** 2026-03-23
**Project:** SkateHubba-play v1.0.0
**Package Manager:** npm (lock file v3)
**Node requirement:** >=22

---

## Summary

| Category            | Status                                                                           |
| ------------------- | -------------------------------------------------------------------------------- |
| Vulnerabilities     | 0 found (6 fixed in this audit)                                                  |
| Outdated (patch)    | 9 (see Section 3)                                                                |
| Outdated (minor)    | 4 (`@capacitor/*`, `react-router-dom`)                                           |
| Outdated (major)    | 2 (`eslint`/`@eslint/js` 9→10, `typescript` 5→6)                                 |
| Unused dependencies | 0                                                                                |
| Miscategorized deps | 0                                                                                |
| License issues      | 1 (project itself is UNLICENSED — intentional, proprietary)                      |
| Dep tree errors     | 0 (optional peer deps only)                                                      |
| Duplicate versions  | 106 transitive packages have multiple versions (firebase-tools is primary cause) |
| Total packages      | 826 unique packages in tree                                                      |
| Disk usage          | 767 MB                                                                           |

---

## 1. Vulnerability Scan & Remediation

### Current status

```
npm audit: 0 vulnerabilities found
```

### Vulnerabilities fixed (2026-04-05)

6 vulnerabilities were discovered since the last audit (2026-03-23). All were in **transitive dev dependencies only** — zero production impact. All resolved via `npm audit fix`:

| Severity | Package           | Version (was)        | Version (fixed)      | Advisory                                                                               | Source Package                                    |
| -------- | ----------------- | -------------------- | -------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| High     | `@xmldom/xmldom`  | 0.8.11               | 0.8.12               | XML injection via unsafe CDATA serialization (GHSA-wh4c-j3r5-mjhp)                     | `@capacitor/cli`                                  |
| High     | `lodash`          | 4.17.23              | 4.18.1               | Code injection via `_.template` + prototype pollution (GHSA-r5fr, GHSA-f23m)           | `firebase-tools`                                  |
| High     | `path-to-regexp`  | 0.1.12, 8.3.0        | 0.1.13, 8.4.2        | ReDoS via route parameters/wildcards/optional groups (GHSA-37ch, GHSA-j3q9, GHSA-27v5) | `firebase-tools`                                  |
| High     | `picomatch`       | 2.3.1, 4.0.3         | 2.3.2, 4.0.4         | Method injection in POSIX char classes + ReDoS (GHSA-3v7f, GHSA-c2c7)                  | `firebase-tools`, `lint-staged`, `vite`, `vitest` |
| Moderate | `brace-expansion` | 1.1.12, 2.0.2, 5.0.4 | 1.1.13, 2.0.3, 5.0.5 | Zero-step sequence causes hang & memory exhaustion (GHSA-f886)                         | Multiple                                          |
| Moderate | `yaml`            | 2.8.2                | 2.8.3                | Stack overflow via deeply nested YAML collections (GHSA-48c2)                          | `firebase-tools`, `lint-staged`, `vite`           |

**Key observation:** All 6 vulnerabilities originated from transitive dependencies of dev-only packages (`firebase-tools`, `@capacitor/cli`, `lint-staged`, `vite`, `vitest`). None affect the production bundle shipped to users.

### Historical fixes (2026-03-18)

- Upgraded `firebase-tools` from `^13.0.0` to `^15.10.1` — resolved 2 high (`tar`) + 6 low (`@tootallnate/once`) vulnerabilities
- Added `overrides.http-proxy-agent` → `^7.0.2` to eliminate `@tootallnate/once` entirely

---

## 2. Production Bundle Analysis

Build output (Vite 8 + Rolldown):

| Chunk       | Size         | Gzip       | Change vs last audit  |
| ----------- | ------------ | ---------- | --------------------- |
| `firebase`  | 491.8 kB     | 147.8 kB   | unchanged             |
| `index`     | 282.6 kB     | 77.2 kB    | +28.4 kB (+6.7 kB gz) |
| `react`     | 189.6 kB     | 59.6 kB    | unchanged             |
| `index.css` | 75.9 kB      | 13.0 kB    | +17.7 kB (+2.2 kB gz) |
| `runtime`   | 0.6 kB       | 0.4 kB     | unchanged             |
| **Total**   | **1,040 kB** | **298 kB** | —                     |

**Key concern:** Firebase SDK remains the largest dependency at 491.8 kB (147.8 kB gzipped). Tree-shaking is effective — modular imports are used throughout.

**Production dependency count:** 7 direct packages. None of the 6 fixed vulnerabilities exist in the production dependency tree (verified via `npm ls --omit=dev`).

---

## 3. Outdated Packages

### Patch/Minor updates (safe — within semver range)

| Package               | Current | Wanted  | Risk | Notes                       |
| --------------------- | ------- | ------- | ---- | --------------------------- |
| `@capacitor/android`  | 8.2.0   | 8.3.0   | Low  | Minor release               |
| `@capacitor/cli`      | 8.2.0   | 8.3.0   | Low  | Minor release               |
| `@capacitor/core`     | 8.2.0   | 8.3.0   | Low  | Minor release               |
| `@capacitor/ios`      | 8.2.0   | 8.3.0   | Low  | Minor release               |
| `@playwright/test`    | 1.58.2  | 1.59.1  | Low  | Test-only, minor release    |
| `@sentry/react`       | 10.43.0 | 10.47.0 | Low  | Patch updates               |
| `@vitest/coverage-v8` | 4.1.0   | 4.1.2   | Low  | Patch update                |
| `firebase-tools`      | 15.10.1 | 15.13.0 | Low  | Dev-only CLI, minor release |
| `react-router-dom`    | 7.13.1  | 7.14.0  | Low  | Minor release               |
| `typescript-eslint`   | 8.57.1  | 8.58.0  | Low  | Patch update                |
| `vite`                | 8.0.2   | 8.0.3   | Low  | Patch update                |
| `vitest`              | 4.1.0   | 4.1.2   | Low  | Patch update                |

### Major updates available (require migration — do not auto-apply)

| Package      | Current | Latest | Migration Notes                                                                                                                                                    |
| ------------ | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `eslint`     | 9.39.4  | 10.2.0 | Already upgraded in last audit to ^10, but `eslint-plugin-react-hooks@7` still declares `eslint@^9` peer dep. Pinned at 9 until ecosystem catches up. **Monitor.** |
| `@eslint/js` | 9.39.4  | 10.0.1 | Tied to ESLint major. Upgrade together.                                                                                                                            |
| `typescript` | 5.9.3   | 6.0.2  | **New major.** Requires compatibility testing with `typescript-eslint`, `vite`, and all type definitions. Schedule dedicated migration.                            |

---

## 4. Dependency Categorization

All dependencies correctly categorized:

**Production (7):** All actively imported in source code.

- `@capacitor/android`, `@capacitor/camera`, `@capacitor/core`, `@capacitor/ios` — native mobile APIs
- `@sentry/react` — error monitoring (`main.tsx`, `ErrorBoundary.tsx`, `auth.ts`)
- `@vercel/analytics` — web analytics (`App.tsx`, `analytics.ts`)
- `firebase` — backend (`firebase.ts`, `games.ts`, `auth.ts`, `storage.ts`, `users.ts`, `useAuth.ts`)
- `react` — UI framework (16+ source files)
- `react-dom` — DOM renderer (`main.tsx`)
- `react-router-dom` — routing (`main.tsx`, `App.tsx`)

**Dev Dependencies (20):** All correctly scoped. No dev dependency is imported in production source files.

---

## 5. Dependency Tree Health

### Duplicate versions (106 packages)

Top contributors to version duplication:

| Package     | Versions in tree                              | Root cause                            |
| ----------- | --------------------------------------------- | ------------------------------------- |
| `commander` | 2.20.3, 5.1.0, 10.0.1, 11.1.0, 12.1.0, 14.0.3 | `firebase-tools` deep transitive tree |
| `debug`     | 2.6.9, 4.3.1, 4.4.3                           | Legacy Express 4 in `firebase-tools`  |
| `express`   | 4.22.1, 5.2.1                                 | `firebase-tools` bundles Express 4    |
| `ini`       | 1.3.8, 2.0.0, 4.1.3                           | Mixed transitive versions             |
| `chalk`     | 4.1.2, 5.6.2                                  | CJS/ESM split across ecosystem        |
| `fs-extra`  | 9.1.0, 10.1.0, 11.3.4                         | `firebase-tools` transitive tree      |

**Root cause:** `firebase-tools` (15.10.1) pulls in a massive transitive tree including legacy packages (Express 4, old lodash, etc.). This is dev-only and does not affect production bundle size.

### Deprecated packages in tree

| Package             | Status                          | Impact   |
| ------------------- | ------------------------------- | -------- |
| `node-domexception` | Use native DOMException instead | Dev-only |
| `json-ptr`          | No longer supported             | Dev-only |
| `glob@10.5.0`       | Old version, security issues    | Dev-only |

All deprecated packages are transitive dev dependencies with no production impact.

---

## 6. Version Compatibility Matrix

| Pair                                   | Compatible | Notes                                     |
| -------------------------------------- | ---------- | ----------------------------------------- |
| React 19 + @types/react 19             | Yes        | Matched                                   |
| React 19 + @testing-library/react 16   | Yes        | TL/React 16 supports React 18 and 19      |
| Vite 8 + @vitejs/plugin-react 6        | Yes        | Compatible (Rolldown engine)              |
| Vite 8 + @tailwindcss/vite 4           | Yes        | Native Vite plugin for Tailwind v4        |
| Vitest 4 + @vitest/coverage-v8 4       | Yes        | Matched major versions                    |
| ESLint 9 + typescript-eslint 8         | Yes        | Flat config compatible                    |
| ESLint 9 + eslint-plugin-react-hooks 7 | Yes        | Works correctly despite peer dep mismatch |
| firebase-tools 15 + firebase 12        | Yes        | CLI and SDK are independently versioned   |
| TypeScript 5.9 + typescript-eslint 8   | Yes        | Compatible                                |

**Note:** `eslint-plugin-react-hooks@7.0.1` declares `eslint@^9.0.0` as peer dep — currently matched. When upgrading ESLint to 10, monitor for updated release.

**Note:** `overrides.http-proxy-agent` → `^7.0.2` remains in place to prevent transitive vulnerability regression from `firebase-tools`.

---

## 7. License Compliance

All dependencies use permissive open-source licenses (MIT, Apache-2.0, ISC, BSD).

**Note:** The project itself is `UNLICENSED` (proprietary). No action needed.

---

## 8. Disk Usage & Bloat Analysis

| Category                     | Size   | Notes                                              |
| ---------------------------- | ------ | -------------------------------------------------- |
| **Total node_modules**       | 767 MB |                                                    |
| `@firebase` + `firebase`     | 157 MB | Largest — Firebase SDK + tools                     |
| `re2`                        | 89 MB  | Native regex engine (firebase-tools dep)           |
| `@rolldown`                  | 45 MB  | Vite 8 bundler engine (native binaries)            |
| `typescript`                 | 23 MB  | Compiler                                           |
| `pglite-2` + `@electric-sql` | 46 MB  | Transitive from firebase-tools (unused at runtime) |
| `@opentelemetry`             | 23 MB  | Transitive from firebase-tools                     |

**Optimization opportunity:** `firebase-tools` alone is responsible for ~300+ MB of dev dependencies. If CI build times are a concern, consider running Firebase emulators via a global install or Docker image rather than a project-local devDependency.

---

## 9. Verification Gate

Full CI-equivalent gate passed after audit fix:

```
✓ npx tsc -b              — 0 errors
✓ npm run lint             — 0 warnings
✓ npm run test:coverage    — all tests pass, 100% coverage on src/services/ and src/hooks/
✓ npm run build            — production build succeeds (1,040 kB total, 298 kB gzipped)
```

---

## 10. Recommendations

### Immediate (completed in this audit)

1. ~~**Run `npm audit fix`** — resolved 6 vulnerabilities (4 high, 2 moderate)~~ **Done**

### Short-term (low risk)

2. **Run `npm update`** to pull in the 12 patch/minor updates listed in Section 3
3. **Upgrade Capacitor** from 8.2 to 8.3 across all `@capacitor/*` packages
4. **Monitor `eslint-plugin-react-hooks`** for ESLint 10 peer dep support

### Medium-term (requires dedicated migration)

5. **TypeScript 6.0** — new major release available (5.9.3 → 6.0.2). Requires compatibility testing with `typescript-eslint`, Vite, and all `@types/*` packages. Schedule a dedicated migration sprint.
6. **ESLint 10** — already tested in last audit cycle. Blocked on `eslint-plugin-react-hooks` peer dep. Re-evaluate when hooks plugin ships ESLint 10 support.

### Long-term (optimization)

7. **Consider extracting `firebase-tools` from devDependencies** — it contributes ~300 MB to `node_modules` and is the root cause of 90%+ of version duplication and deprecated package warnings. Alternatives: global install, Docker-based emulators, or CI-only dependency.
8. **Pin Node.js version** — add an `.nvmrc` file (`22`) to ensure consistent builds across environments.

---

## 11. Audit History

| Date       | Vulns Found | Vulns Fixed | Major Upgrades | Notes                                              |
| ---------- | ----------- | ----------- | -------------- | -------------------------------------------------- |
| 2026-03-18 | 8           | 8           | 0              | firebase-tools 13→15, http-proxy-agent override    |
| 2026-03-23 | 0           | 0           | 11             | React 19, Vite 8, Tailwind 4, Firebase 12, etc.    |
| 2026-04-05 | 6           | 6           | 0              | Transitive dev dep fixes (lodash, picomatch, etc.) |
