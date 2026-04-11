# Technical Debt Assessment

**Date:** 2026-04-11 (refreshed)
**Scope:** Full codebase review of `skatehubba-play`
**Tech Stack:** React 19 + TypeScript 5.6 + Vite 8 + Firebase 12 (Auth/Firestore/Storage) + Tailwind CSS 4 + Capacitor 8 (iOS/Android)

---

## Executive Summary

SkateHubba-play is a well-structured mobile-first SKATE game app with strong foundations: strict TypeScript, 100% unit test coverage on services/hooks, robust Firestore security rules, and a clean CI pipeline. Several areas of technical debt remain — the most notable are the **monolithic GameContext (371 lines)** and **gaps in component/screen test coverage**. The long-standing "no client-side router" P0 is now **resolved** (see below).

---

## Severity Levels

| Level             | Definition                                       |
| ----------------- | ------------------------------------------------ |
| **P0 — Critical** | Blocks scaling or introduces user-facing risk    |
| **P1 — High**     | Significant maintainability or quality concern   |
| **P2 — Medium**   | Noticeable friction; address during related work |
| **P3 — Low**      | Nice-to-have improvements                        |

---

## Resolved since the last review

### ~~No Client-Side Router~~ — RESOLVED

The app now uses `react-router-dom` v7. `App.tsx` declares a `<Routes>` tree covering every screen (`/`, `/age-gate`, `/auth`, `/profile`, `/lobby`, `/challenge`, `/game`, `/gameover`, `/record`, `/player/:uid`, `/privacy`, `/terms`, `/data-deletion`, `/map`, `/spots/:id`, `/404`, plus a `*` catch-all). `NavigationContext.setScreen` bridges legacy screen-name callsites to `useNavigate()` so existing transitions keep working while the browser URL stays in sync. Browser back/forward works, public pages are deep-linkable, and push notifications can target a specific route.

### ~~Client-only turn timer (P0 from the 2026-03 security audit)~~ — RESOLVED

A scheduled Cloud Function (`checkExpiredTurns` in `functions/src/index.ts`) now runs every 15 minutes and auto-forfeits any active game whose `turnDeadline` has passed. Firestore rules still validate every forfeit write. The client also calls `forfeitExpiredTurn()` on game open as defense-in-depth.

---

## P0 — Critical

### 1. Firestore Pagination Cap Without User Warning (DEC-003)

**Location:** `src/services/games.ts` (lines 380–381)

Both `subscribeToMyGames` queries are hard-capped at `limit(50)`. Users with >50 games silently lose visibility of older games with no "load more" UX or warning.

**Impact:** Data loss perception for active users. Already documented in `docs/DECISIONS.md` as DEC-003 but unresolved.

**Recommendation:** Add cursor-based pagination with a "Load more" button. Add composite indexes on `(playerXUid, updatedAt)`.

---

## P1 — High

### 2. Monolithic GameContext (371 lines)

**Location:** `src/context/GameContext.tsx`

A single context provides auth, game state, navigation, profile management, and error handling. The `GameContextValue` interface exposes 25+ fields/methods.

**Impact:**

- Any state change triggers re-renders across the entire app
- Difficult to test in isolation (the context test file is 371+ lines itself)
- Mixing concerns makes refactoring risky

**Recommendation:** Split into focused contexts: `AuthContext`, `GameContext`, `NavigationContext`. Use `useSyncExternalStore` or Zustand for game state to avoid cascading re-renders.

### 3. Large Component/Screen Test Coverage Gap

**Files without tests:**

| Category   | Untested Files | Total Lines  |
| ---------- | -------------- | ------------ |
| Components | 15 files       | ~1,709 lines |
| Screens    | 7 files        | ~1,627 lines |
| Context    | 1 file         | 204 lines    |

Notable untested files:

- `GameNotificationWatcher.tsx` (316 lines) — push notification logic
- `MyRecordScreen.tsx` (439 lines) — stats/game history
- `Landing.tsx` (417 lines) — first user impression
- `FisheyeRenderer.tsx` (230 lines) — WebGL shader code
- `NotificationBell.tsx` (219 lines) — notification UI
- `AgeGate.tsx` (208 lines) — COPPA compliance gate
- `NotificationContext.tsx` (204 lines) — notification state

The vitest config enforces 100% coverage only on `src/services/**` and `src/hooks/**`. Components and screens have **no coverage thresholds**.

**Recommendation:** Add coverage thresholds for components (target 80%+). Prioritize testing `AgeGate` (compliance), `GameNotificationWatcher` (critical path), and `NotificationContext`.

### 4. No State Management Library

**Location:** Project-wide

All state flows through React Context + `useState`/`useEffect`. There's no state management library (Zustand, Jotai, Redux, etc.).

**Impact:**

- Context value changes cause full subtree re-renders
- Complex state transitions (game phases, auth flows) are handled with imperative `setState` calls
- No devtools for state inspection/time-travel debugging

**Recommendation:** Consider Zustand for game state (small API, built-in devtools, supports subscriptions without re-renders).

### 5. ~~Smoke E2E Test Is Monolithic (2,753 lines)~~ — RESOLVED

**Location (was):** `src/__tests__/smoke-e2e.test.tsx`

The monolithic smoke-e2e file has since been split into focused suites under `src/__tests__/`:

- `smoke-auth.test.tsx`
- `smoke-google.test.tsx`
- `smoke-profile.test.tsx`
- `smoke-lobby.test.tsx`
- `smoke-challenge.test.tsx`
- `smoke-gameplay.test.tsx`
- `smoke-gameover.test.tsx`
- `smoke-account.test.tsx`

plus `smoke-helpers.tsx` for shared fixtures. No remaining work on this item.

---

## P2 — Medium

### 6. Console.warn/error Used Instead of Logger Service

**Location:** Multiple files

Several production files use `console.warn`/`console.error` directly instead of the existing `logger` service:

- `src/firebase.ts` (lines 75, 98)
- `src/services/games.ts` (lines 384, 426)
- `src/services/fcm.ts` (lines 31, 45)
- `src/components/FisheyeRenderer.tsx` (lines 58, 79)
- `src/components/VideoRecorder.tsx` (lines 73, 102, 189)
- `src/components/ErrorBoundary.tsx` (line 22)
- `src/screens/GamePlayScreen.tsx` (line 51)

**Impact:** These logs bypass Sentry breadcrumbs, making production debugging harder.

**Recommendation:** Replace all `console.warn`/`console.error` in production code with `logger.warn`/`logger.error` to get Sentry breadcrumbs automatically.

### 7. Large Screen Components (400+ lines)

Several screens exceed 400 lines with mixed concerns:

- `Lobby.tsx` — 532 lines (player directory fetching, game list rendering, UI)
- `MyRecordScreen.tsx` — 439 lines (stats calculation, filtering, rendering)
- `ProfileSetup.tsx` — 421 lines (form validation, Firebase writes, COPPA logic)
- `Landing.tsx` — 417 lines (marketing content + auth entry points)
- `GamePlayScreen.tsx` — 402 lines (game logic + video recording + UI)

**Recommendation:** Extract data-fetching logic into custom hooks and break down UI into smaller sub-components.

### 8. Inline Tailwind Styles Are Verbose and Duplicated

**Location:** Throughout `src/components/` and `src/screens/`

Long Tailwind class strings are repeated across components (e.g., `"min-h-dvh flex flex-col items-center justify-center px-6 bg-[#0A0A0A]"`). Hardcoded hex colors (`#0A0A0A`, `#888`, `#1A1A1A`) appear alongside Tailwind theme tokens.

**Recommendation:** Define shared layout patterns as Tailwind `@apply` utilities or component abstractions. Move all colors into `tailwind.config` theme.

### 9. Cloud Functions Have Minimal Test Coverage

**Location:** `functions/`

The `functions/` directory contains the push-notification triggers (`onNudgeCreated`, `onGameCreated`, `onGameUpdated`), the `onBillingAlert` Pub/Sub handler, and the `checkExpiredTurns` scheduled forfeit enforcer. `functions/src/__tests__/` exists but coverage is thin relative to the client-side services.

**Recommendation:** Expand the existing test harness (firebase-functions-test or vitest) so every Cloud Function has at least happy-path + one failure test. This is especially important for `checkExpiredTurns`, which is the server-side turn-timer fix for the P0 security finding. The PR gate blocks changes under `functions/src/` without maintainer approval, so test coverage is the only safety net when a change does land.

### 10. Duplicate `TOAST_DURATION` Constant

**Location:** `src/components/Toast.tsx:5`, `src/context/NotificationContext.tsx:53`

Both files independently define `const TOAST_DURATION = 4000;`. Neither imports from the other, so a future change to one won't update the other.

**Recommendation:** Extract to a shared constant (e.g., `src/lib/constants.ts`) and import in both files.

### 11. Inline Chevron SVG Duplicated 4x

**Location:** `src/screens/Lobby.tsx` (lines 260–273, 325–338, 442–455), `src/screens/MyRecordScreen.tsx` (line ~400)

The same chevron-right `<svg>` with `<polyline points="9 18 15 12 9 6" />` is copy-pasted 4 times. The codebase already has `src/components/icons.tsx` with a `SvgIcon` wrapper and 17 icon components — but no `ChevronRightIcon`.

**Recommendation:** Add a `ChevronRightIcon` to `icons.tsx` and replace the 4 inline instances.

### 12. ESLint-Disable Comments

**Location:**

- `src/context/GameContext.tsx:256` — `eslint-disable-next-line react-hooks/exhaustive-deps`
- `src/components/VideoRecorder.tsx:196` — `eslint-disable-next-line react-hooks/set-state-in-effect`

**Impact:** Minor — both have explanatory comments and are justified. Track to ensure they don't proliferate.

---

## P3 — Low

### 13. No React.lazy / Code Splitting for Screens

**Location:** `src/App.tsx` (lines 13–25)

All screens are eagerly imported. The Vite build does manual chunking for `firebase` and `react`, but screen components are bundled together.

**Recommendation:** Use `React.lazy()` + `Suspense` for screens not needed at initial load (GamePlayScreen, MyRecordScreen, PrivacyPolicy, etc.).

### 14. No Typed Environment Variables

**Location:** `src/vite-env.d.ts`, `src/firebase.ts`

Firebase config reads from `import.meta.env.VITE_FIREBASE_*` without a typed schema. Missing variables fail silently at runtime.

**Recommendation:** Add a Zod/Valibot schema to validate env vars at build time or app startup.

### 15. `http-proxy-agent` Override in package.json

**Location:** `package.json` (line 41)

```json
"overrides": { "http-proxy-agent": "^7.0.2" }
```

This is a transitive dependency override likely for a security fix. If the upstream has been updated, this override is stale.

**Recommendation:** Check if the override is still needed. Remove if upstream dependency has been updated.

### 16. Firebase Messaging SW Version Hardcoded

**Location:** `public/firebase-messaging-sw.js`

The service worker imports a hardcoded Firebase CDN URL, but `package.json` specifies `^12.x.x` which resolves to a newer patch. This can cause version mismatch bugs between the SW and the app bundle.

**Recommendation:** Dynamically inject the Firebase version at build time, or pin the SW import to match the resolved lockfile version.

### 17. `.lighthouserc.json` Not Wired into CI

**Location:** `.lighthouserc.json`, `.github/workflows/main.yml`

A Lighthouse CI config exists (performance >=0.8, accessibility >=0.9) but the `main.yml` workflow's Lighthouse job may not be fully integrated.

**Recommendation:** Verify Lighthouse CI runs on every PR and fails the gate if thresholds regress.

### 18. No `.nvmrc` File

No `.nvmrc` exists at the project root. CI uses Node 22 and `package.json` specifies `>=22`, but local developer environments have no enforcement.

**Recommendation:** Add `.nvmrc` with `22` for consistency across developer machines.

### 19. STL Asset Storage Undocumented (DEC-002)

Already tracked in `docs/DECISIONS.md`. Needs resolution to prevent asset loss.

### 20. Deferred Landing Page Features (DEC-001)

Autoplay hero video and custom fonts. Already documented — revisit when design resources are available.

---

## Dependency Health

| Area                     | Status                                                                          |
| ------------------------ | ------------------------------------------------------------------------------- |
| TypeScript strict mode   | Enabled (`strict: true`, `noUnusedLocals`, `noUnusedParameters`)                |
| ESLint `no-explicit-any` | Enforced in production code, relaxed in tests                                   |
| Package manager          | npm (single lockfile, no competing managers)                                    |
| Node version             | Pinned to >=22                                                                  |
| React version            | 19.2.x                                                                          |
| Vite                     | 8 (Rolldown)                                                                    |
| Tailwind CSS             | 4 (`@tailwindcss/vite` plugin)                                                  |
| Firebase SDK             | 12                                                                              |
| Router                   | `react-router-dom` 7                                                            |
| Native                   | Capacitor 8 — `@capacitor/ios`, `@capacitor/android`, `@capacitor/camera`       |
| Husky + lint-staged      | Configured for pre-commit checks                                                |
| CI pipeline              | 4 workflows (main, PR gate, release, android-aab) — lint/typecheck/test/build/Lighthouse/E2E |

**Notable:** Dependencies are current with the latest major versions (React 19, Vite 8, Tailwind 4, Firebase 12, Capacitor 8). `npm audit` reports 0 vulnerabilities.

---

## Prioritized Action Plan

| Priority | Item                                       | Effort  | Impact                                      |
| -------- | ------------------------------------------ | ------- | ------------------------------------------- |
| P0       | Implement game list pagination             | Small   | High — prevents data loss for active users  |
| P1       | Split GameContext into focused contexts    | Medium  | High — performance + maintainability        |
| P1       | Add component/screen test coverage         | Large   | High — prevents regressions in UI           |
| P1       | Evaluate lightweight state management      | Small   | Medium — reduces re-renders                 |
| P1       | Split smoke-e2e test file                  | Medium  | Medium — improves test maintainability      |
| P2       | Route console.warn/error through logger    | Small   | Medium — improves production debugging      |
| P2       | Extract hooks from large screens           | Medium  | Medium — improves readability               |
| P2       | Extract shared `TOAST_DURATION` constant   | Trivial | Low — prevents silent divergence            |
| P2       | Add `ChevronRightIcon` to icons.tsx        | Trivial | Low — removes 4x inline SVG duplication     |
| P2       | Consolidate Tailwind theme tokens          | Small   | Low — reduces duplication                   |
| P2       | Add Cloud Functions tests                  | Medium  | Medium — prevents deploy regressions        |
| P3       | Add React.lazy code splitting              | Small   | Low — improves initial load time            |
| P3       | Type environment variables                 | Small   | Low — prevents runtime config errors        |
| P3       | Audit package.json overrides               | Small   | Low — removes stale workarounds             |
| P3       | Fix Firebase Messaging SW version mismatch | Small   | Low — prevents SW/app version drift         |
| P3       | Wire Lighthouse CI into PR gate            | Small   | Low — catches performance regressions       |
| P3       | Add `.nvmrc` file                          | Trivial | Low — developer environment consistency     |

---

## What's Working Well

- **TypeScript strict mode** is enforced everywhere with `noUnusedLocals`/`noUnusedParameters`
- **100% test coverage** on all services and hooks with enforced thresholds
- **Firestore security rules** are comprehensive with rate limiting, phase validation, and anti-cheat guards
- **ESLint `no-explicit-any`** is enforced in production code
- **CI pipeline** runs lint, typecheck, tests, and build on every PR
- **Error monitoring** via Sentry with proper error boundaries
- **Decision log** (`docs/DECISIONS.md`) tracks scope decisions and known debt
- **Pre-commit hooks** via Husky + lint-staged prevent lint violations from landing
