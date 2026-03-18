# Dependency Audit Report

**Date:** 2026-03-18
**Project:** SkateHubba-play v1.0.0
**Package Manager:** npm (lock file v3)

---

## Summary

| Category            | Status                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| Vulnerabilities     | 0 found (clean)                                                                                       |
| Outdated (patch)    | 2 (`@sentry/react`, `typescript-eslint`)                                                              |
| Outdated (minor)    | 1 (`firebase` 11.0→11.10)                                                                             |
| Outdated (major)    | 7 (`react`, `firebase`, `@vercel/analytics`, `tailwindcss`, `vite`, `eslint`, `@vitejs/plugin-react`) |
| Unused dependencies | 0                                                                                                     |
| Miscategorized deps | 0                                                                                                     |
| License issues      | 1 (project itself is UNLICENSED)                                                                      |
| Dep tree errors     | 0 (optional peer deps only)                                                                           |

---

## 1. Vulnerability Scan

```
npm audit: 0 vulnerabilities found
```

No known security vulnerabilities in the current dependency tree.

### Vulnerabilities Resolved (2026-03-18)

8 vulnerabilities were found in the `firebase-tools@^13.0.0` transitive dependency tree (devDependency only — no production impact):

| Severity | Count | Package                    | Advisory                                                                                              |
| -------- | ----- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| High     | 2     | `tar` <=7.5.10             | Path traversal & symlink poisoning (GHSA-34x7, GHSA-8qq5, GHSA-83g3, GHSA-qffp, GHSA-9ppj, GHSA-r6q2) |
| Low      | 6     | `@tootallnate/once` <3.0.1 | Incorrect Control Flow Scoping (GHSA-vpq2)                                                            |

**Fixes applied:**

1. Upgraded `firebase-tools` from `^13.0.0` to `^15.10.1` — resolved all `tar` vulnerabilities
2. Added `overrides` in `package.json` to force `http-proxy-agent@^7.0.2` — v7 drops `@tootallnate/once` entirely, resolving the remaining 6 low-severity advisories

---

## 2. Outdated Packages

### Patch Updates (safe to apply)

| Package             | Current  | Wanted  | Latest  | Notes                  |
| ------------------- | -------- | ------- | ------- | ---------------------- |
| `@sentry/react`     | ^10.43.0 | 10.44.0 | 10.44.0 | Patch update available |
| `typescript-eslint` | ^8.57.0  | 8.57.1  | 8.57.1  | Patch update available |

### Minor Updates (safe to apply)

| Package    | Current | Wanted  | Latest  | Notes                    |
| ---------- | ------- | ------- | ------- | ------------------------ |
| `firebase` | ^11.0.0 | 11.10.0 | 12.10.0 | Minor updates within v11 |

### Major Version Upgrades Available

| Package                | Current | Latest  | Risk   | Notes                                                   |
| ---------------------- | ------- | ------- | ------ | ------------------------------------------------------- |
| `react` / `react-dom`  | ^18.3.1 | 19.2.4  | High   | Major rewrite; concurrent features, new hooks API       |
| `firebase`             | ^11.0.0 | 12.10.0 | Medium | Breaking changes in auth/firestore APIs                 |
| `vite`                 | ^6.0.0  | 8.0.0   | Medium | Two major versions behind; review migration guides      |
| `@vitejs/plugin-react` | ^4.3.4  | 6.0.1   | Medium | Tied to Vite major version; upgrade together with Vite  |
| `eslint`               | ^9.0.0  | 10.0.3  | Medium | Review breaking changes in rule configs                 |
| `tailwindcss`          | ^3.4.15 | 4.2.2   | High   | Complete rewrite; new config format, CSS-first approach |
| `@vercel/analytics`    | ^1.6.1  | 2.0.1   | Low    | API surface is small; likely straightforward upgrade    |
| `jsdom`                | ^28.1.0 | 29.0.0  | Low    | Test-only; review changelog before upgrading            |

---

## 3. Dependency Categorization

All dependencies are correctly categorized:

**Production (5):** All actively imported in source code.

- `@sentry/react` — used in `main.tsx`, `ErrorBoundary.tsx`, `auth.ts`
- `@vercel/analytics` — used in `App.tsx`, `analytics.ts`
- `firebase` — used in `firebase.ts`, `games.ts`, `auth.ts`, `storage.ts`, `users.ts`, `useAuth.ts`
- `react` — used across 16+ source files
- `react-dom` — used in `main.tsx`

**Dev Dependencies (24):** All correctly scoped to development/testing. No dev dependency is imported in production source files.

---

## 4. Bundle Size Analysis

Top contributors to `node_modules` disk usage:

| Package       | Size  | Type       | Notes                                  |
| ------------- | ----- | ---------- | -------------------------------------- |
| `@firebase/`  | 78 MB | Production | Largest dep by far; tree-shaking helps |
| `firebase/`   | 63 MB | Production | Firebase SDK wrapper                   |
| `typescript/` | 23 MB | Dev only   | Not in production bundle               |
| `@sentry/`    | 16 MB | Production | Error monitoring SDK                   |
| `@babel/`     | 12 MB | Dev only   | Used by Vite/React plugin              |
| `@esbuild/`   | 10 MB | Dev only   | Build tooling                          |

**Key concern:** Firebase SDK dominates disk and bundle size. Ensure tree-shaking is effective by using modular imports (e.g., `firebase/auth` not `firebase`). Current code already follows this pattern correctly.

---

## 5. Version Compatibility Matrix

| Pair                                     | Compatible | Notes                                   |
| ---------------------------------------- | ---------- | --------------------------------------- |
| React 18 + @types/react 18               | Yes        | Matched                                 |
| React 18 + @testing-library/react 16     | Yes        | TL/React 16 supports React 18           |
| Vite 6 + @vitejs/plugin-react 4          | Yes        | Compatible                              |
| Vitest 4 + @vitest/coverage-v8 4         | Yes        | Matched major versions                  |
| ESLint 9 + typescript-eslint 8           | Yes        | Flat config compatible                  |
| ESLint 9 + eslint-plugin-react-hooks 7   | Yes        | v7 supports ESLint 9 flat config        |
| Tailwind 3 + PostCSS 8 + Autoprefixer 10 | Yes        | Standard combination                    |
| firebase-tools 15 + firebase 11          | Yes        | CLI and SDK are independently versioned |

**Note:** `overrides.http-proxy-agent` is set to `^7.0.2` to resolve a transitive vulnerability in `firebase-tools`. This is safe because `http-proxy-agent@7` is a drop-in replacement for the proxy functionality used in the dependency chain.

No version incompatibilities detected.

---

## 6. Dependency Tree Health

- **893 deduped packages** out of 1106 total — normal deduplication, no bloat
- **No invalid or missing required dependencies**
- All unmet dependencies are **optional peer deps** (e.g., `@remix-run/react`, `vue`, `next`, `svelte`) — these are expected and harmless, as they are framework-specific optional integrations from Sentry

---

## 7. License Compliance

All dependencies use permissive open-source licenses (MIT, Apache-2.0, ISC, BSD).

**Note:** The project itself is marked as `UNLICENSED` in package.json. If this is intentional (proprietary), no action needed. If open-source is intended, a license should be specified.

---

## 8. Recommendations

### Immediate (no risk)

1. **Run `npm update`** to pull in patch/minor updates within existing ranges (`@sentry/react` 10.43→10.44, `typescript-eslint` 8.57.0→8.57.1, `firebase` 11.0→11.10).

### Short-term

2. **Upgrade `@vercel/analytics` to v2** — small API surface, low-risk major bump.
3. **Upgrade `jsdom` to v29** — test-only dependency, low risk.
4. **Pin Node.js version** — add an `engines` field to package.json or an `.nvmrc` file to ensure consistent builds.

### Medium-term (plan and test)

5. **Upgrade `firebase` to v12** — review breaking changes in auth/firestore APIs before upgrading.
6. **Upgrade `vite` to v8 + `@vitejs/plugin-react` to v6** — upgrade together; review migration guides for both major versions.
7. **Upgrade `eslint` to v10** — review breaking rule/config changes.

### Long-term

8. **Evaluate React 19 upgrade** — significant effort; review new APIs, test thoroughly. Not urgent since React 18 is fully supported.
9. **Evaluate Tailwind CSS v4** — major architectural change (CSS-first config). Plan migration when the ecosystem stabilizes.

---

## 9. No Action Needed

- Vulnerability posture is clean
- Dependency categorization is correct
- No unused or phantom dependencies
- Tree-shaking patterns are correct (modular Firebase imports)
- All version combinations are compatible
