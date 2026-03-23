# Dependency Audit Report

**Date:** 2026-03-23
**Project:** SkateHubba-play v1.0.0
**Package Manager:** npm (lock file v3)

---

## Summary

| Category            | Status                                                            |
| ------------------- | ----------------------------------------------------------------- |
| Vulnerabilities     | 0 found (clean)                                                   |
| Outdated (patch)    | 5 (`@sentry/react`, `@vitest/coverage-v8`, `vitest`, `firebase-tools`, `react-router-dom`) |
| Outdated (minor)    | 0                                                                 |
| Outdated (major)    | 0                                                                 |
| Unused dependencies | 0                                                                 |
| Miscategorized deps | 0                                                                 |
| License issues      | 1 (project itself is UNLICENSED)                                  |
| Dep tree errors     | 0 (optional peer deps only)                                      |

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

## 2. Major Upgrades Applied (2026-03-23)

All previously-pending major upgrades have been completed:

| Package                | From     | To       | Migration Notes                                                  |
| ---------------------- | -------- | -------- | ---------------------------------------------------------------- |
| `react` / `react-dom`  | ^18.3.1  | ^19.2.4  | No code changes needed — codebase already used modern patterns   |
| `@types/react`         | ^18.3.12 | ^19.2.14 | Type-compatible, no source changes                               |
| `@types/react-dom`     | ^18.3.1  | ^19.2.3  | Type-compatible, no source changes                               |
| `firebase`             | ^11.0.0  | ^12.11.0 | Modular SDK APIs unchanged; service worker CDN updated to 12.11.0 |
| `vite`                 | ^6.0.0   | ^8.0.2   | Rolldown engine; `manualChunks` converted from object to function |
| `@vitejs/plugin-react` | ^4.3.4   | ^6.0.1   | Upgraded alongside Vite 8                                        |
| `tailwindcss`          | ^3.4.15  | ^4.2.2   | CSS-first config; `tailwind.config.js` → `@theme` in index.css   |
| `eslint`               | ^9.0.0   | ^10.1.0  | Flat config compatible; no rule changes needed                   |
| `@eslint/js`           | ^9.0.0   | ^10.0.1  | Upgraded alongside ESLint 10                                     |
| `@vercel/analytics`    | ^1.6.1   | ^2.0.1   | API unchanged (`Analytics` component from `@vercel/analytics/react`) |
| `jsdom`                | ^28.1.0  | ^29.0.1  | Test-only dependency; no test changes needed                     |

### Infrastructure changes

- **Removed** `postcss.config.js` — Tailwind v4 uses `@tailwindcss/vite` plugin instead of PostCSS
- **Removed** `tailwind.config.js` — replaced by `@theme` block in `src/index.css`
- **Removed** `autoprefixer` and `postcss` devDependencies — handled internally by Tailwind v4
- **Added** `@tailwindcss/vite` devDependency — Vite-native Tailwind v4 integration
- **Updated** `vite.config.ts` — added `tailwindcss()` plugin, converted `manualChunks` to function syntax for Rolldown compatibility
- **Updated** `public/firebase-messaging-sw.js` — CDN version 11.10.0 → 12.11.0

### Patch/Minor Updates (safe to apply via `npm update`)

| Package              | Current  | Wanted   | Latest   | Notes                  |
| -------------------- | -------- | -------- | -------- | ---------------------- |
| `@sentry/react`      | 10.43.0  | 10.45.0  | 10.45.0  | Patch update available |
| `@vitest/coverage-v8` | 4.1.0   | 4.1.1    | 4.1.1    | Patch update available |
| `vitest`             | 4.1.0    | 4.1.1    | 4.1.1    | Patch update available |
| `firebase-tools`     | 15.10.1  | 15.11.0  | 15.11.0  | Patch update available |
| `react-router-dom`   | 7.13.1   | 7.13.2   | 7.13.2   | Patch update available |

---

## 3. Dependency Categorization

All dependencies are correctly categorized:

**Production (7):** All actively imported in source code.

- `@capacitor/android`, `@capacitor/camera`, `@capacitor/core`, `@capacitor/ios` — native mobile APIs
- `@sentry/react` — used in `main.tsx`, `ErrorBoundary.tsx`, `auth.ts`
- `@vercel/analytics` — used in `App.tsx`, `analytics.ts`
- `firebase` — used in `firebase.ts`, `games.ts`, `auth.ts`, `storage.ts`, `users.ts`, `useAuth.ts`
- `react` — used across 16+ source files
- `react-dom` — used in `main.tsx`
- `react-router-dom` — used in `main.tsx`, `App.tsx`

**Dev Dependencies (20):** All correctly scoped to development/testing. No dev dependency is imported in production source files.

---

## 4. Bundle Size Analysis

Production build output (Vite 8 + Rolldown):

| Chunk       | Size     | Gzip     | Notes                           |
| ----------- | -------- | -------- | ------------------------------- |
| `firebase`  | 491.8 kB | 147.8 kB | Firebase SDK (tree-shaken)      |
| `index`     | 254.2 kB | 70.5 kB  | App code + dependencies         |
| `react`     | 189.6 kB | 59.6 kB  | React 19 + ReactDOM             |
| `index.css` | 58.2 kB  | 10.8 kB  | Tailwind v4 CSS                 |
| `runtime`   | 0.6 kB   | 0.4 kB   | Rolldown runtime                |

**Key concern:** Firebase SDK remains the largest dependency. Tree-shaking is effective — modular imports (`firebase/auth`, not `firebase`) are used throughout.

---

## 5. Version Compatibility Matrix

| Pair                                      | Compatible | Notes                                       |
| ----------------------------------------- | ---------- | ------------------------------------------- |
| React 19 + @types/react 19               | Yes        | Matched                                     |
| React 19 + @testing-library/react 16     | Yes        | TL/React 16 supports React 18 and 19        |
| Vite 8 + @vitejs/plugin-react 6          | Yes        | Compatible (Rolldown engine)                 |
| Vite 8 + @tailwindcss/vite 4             | Yes        | Native Vite plugin for Tailwind v4           |
| Vitest 4 + @vitest/coverage-v8 4         | Yes        | Matched major versions                       |
| ESLint 10 + typescript-eslint 8           | Yes        | Flat config compatible                       |
| ESLint 10 + eslint-plugin-react-hooks 7  | Yes*       | Works but peer dep declares ESLint ≤9 only   |
| firebase-tools 15 + firebase 12          | Yes        | CLI and SDK are independently versioned      |

**Note:** `eslint-plugin-react-hooks@7.0.1` declares `eslint@^9.0.0` as a peer dependency but works correctly with ESLint 10. Installed with `--legacy-peer-deps`. Monitor for an updated release.

**Note:** `overrides.http-proxy-agent` is set to `^7.0.2` to resolve a transitive vulnerability in `firebase-tools`. This is safe because `http-proxy-agent@7` is a drop-in replacement for the proxy functionality used in the dependency chain.

---

## 6. Dependency Tree Health

- **No invalid or missing required dependencies**
- All unmet dependencies are **optional peer deps** (e.g., `@remix-run/react`, `vue`, `next`, `svelte`) — these are expected and harmless, as they are framework-specific optional integrations from Sentry

---

## 7. License Compliance

All dependencies use permissive open-source licenses (MIT, Apache-2.0, ISC, BSD).

**Note:** The project itself is marked as `UNLICENSED` in package.json. If this is intentional (proprietary), no action needed. If open-source is intended, a license should be specified.

---

## 8. Recommendations

### Immediate (no risk)

1. **Run `npm update`** to pull in patch updates within existing ranges.

### Short-term

2. **Monitor `eslint-plugin-react-hooks`** for a release that supports ESLint 10 in its peer dependencies.
3. **Pin Node.js version** — add an `.nvmrc` file to ensure consistent builds.

---

## 9. No Action Needed

- Vulnerability posture is clean
- All major dependency upgrades are complete
- Dependency categorization is correct
- No unused or phantom dependencies
- Tree-shaking patterns are correct (modular Firebase imports)
- All version combinations are compatible
