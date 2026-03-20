# Technical Debt Assessment

**Date:** 2026-03-20
**Scope:** Full codebase review of `skatehubba-play`
**Tech Stack:** React 18 + TypeScript + Vite + Firebase (Auth/Firestore/Storage) + Tailwind CSS + Capacitor

---

## Executive Summary

SkateHubba-play is a well-structured mobile-first SKATE game app with strong foundations: strict TypeScript, 100% unit test coverage on services/hooks, robust Firestore security rules, and a clean CI pipeline. However, several areas of technical debt exist that will become increasingly costly as the app scales. The most critical items are the **lack of a client-side router**, a **monolithic GameContext (371 lines)**, and **large gaps in component/screen test coverage**.

---

## Severity Levels

| Level | Definition |
|-------|-----------|
| **P0 — Critical** | Blocks scaling or introduces user-facing risk |
| **P1 — High** | Significant maintainability or quality concern |
| **P2 — Medium** | Noticeable friction; address during related work |
| **P3 — Low** | Nice-to-have improvements |

---

## P0 — Critical

### 1. No Client-Side Router

**Location:** `src/App.tsx` (lines 75–295), `src/context/GameContext.tsx` (Screen type)

The app uses a manual `screen` state string (`"lobby" | "game" | "auth" | ...`) with conditional rendering instead of a proper router (React Router, TanStack Router, etc.).

**Impact:**
- No URL-based navigation — users cannot bookmark, share, or deep-link to specific screens
- Browser back/forward buttons don't work
- Push notification deep-links require a custom event workaround (`skatehubba:open-game`)
- SEO is impossible for public pages (landing, privacy policy, terms)
- Analytics page tracking requires manual instrumentation

**Recommendation:** Adopt React Router v7+ or TanStack Router. Map each `Screen` variant to a route path. This is the single highest-impact improvement.

### 2. Firestore Pagination Cap Without User Warning (DEC-003)

**Location:** `src/services/games.ts` (lines 380–381)

Both `subscribeToMyGames` queries are hard-capped at `limit(50)`. Users with >50 games silently lose visibility of older games with no "load more" UX or warning.

**Impact:** Data loss perception for active users. Already documented in `docs/DECISIONS.md` as DEC-003 but unresolved.

**Recommendation:** Add cursor-based pagination with a "Load more" button. Add composite indexes on `(playerXUid, updatedAt)`.

---

## P1 — High

### 3. Monolithic GameContext (371 lines)

**Location:** `src/context/GameContext.tsx`

A single context provides auth, game state, navigation, profile management, and error handling. The `GameContextValue` interface exposes 25+ fields/methods.

**Impact:**
- Any state change triggers re-renders across the entire app
- Difficult to test in isolation (the context test file is 371+ lines itself)
- Mixing concerns makes refactoring risky

**Recommendation:** Split into focused contexts: `AuthContext`, `GameContext`, `NavigationContext`. Use `useSyncExternalStore` or Zustand for game state to avoid cascading re-renders.

### 4. Large Component/Screen Test Coverage Gap

**Files without tests:**

| Category | Untested Files | Total Lines |
|----------|---------------|-------------|
| Components | 15 files | ~1,709 lines |
| Screens | 7 files | ~1,627 lines |
| Context | 1 file | 204 lines |

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

### 5. No State Management Library

**Location:** Project-wide

All state flows through React Context + `useState`/`useEffect`. There's no state management library (Zustand, Jotai, Redux, etc.).

**Impact:**
- Context value changes cause full subtree re-renders
- Complex state transitions (game phases, auth flows) are handled with imperative `setState` calls
- No devtools for state inspection/time-travel debugging

**Recommendation:** Consider Zustand for game state (small API, built-in devtools, supports subscriptions without re-renders).

### 6. Smoke E2E Test Is Monolithic (2,753 lines)

**Location:** `src/__tests__/smoke-e2e.test.tsx`

A single test file with 2,753 lines covers most integration scenarios. This is fragile and difficult to maintain.

**Recommendation:** Split into focused test suites per feature (auth flow, game flow, notifications, etc.).

---

## P2 — Medium

### 7. Console.warn/error Used Instead of Logger Service

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

### 8. Large Screen Components (400+ lines)

Several screens exceed 400 lines with mixed concerns:
- `Lobby.tsx` — 532 lines (player directory fetching, game list rendering, UI)
- `MyRecordScreen.tsx` — 439 lines (stats calculation, filtering, rendering)
- `ProfileSetup.tsx` — 421 lines (form validation, Firebase writes, COPPA logic)
- `Landing.tsx` — 417 lines (marketing content + auth entry points)
- `GamePlayScreen.tsx` — 402 lines (game logic + video recording + UI)

**Recommendation:** Extract data-fetching logic into custom hooks and break down UI into smaller sub-components.

### 9. Inline Tailwind Styles Are Verbose and Duplicated

**Location:** Throughout `src/components/` and `src/screens/`

Long Tailwind class strings are repeated across components (e.g., `"min-h-dvh flex flex-col items-center justify-center px-6 bg-[#0A0A0A]"`). Hardcoded hex colors (`#0A0A0A`, `#888`, `#1A1A1A`) appear alongside Tailwind theme tokens.

**Recommendation:** Define shared layout patterns as Tailwind `@apply` utilities or component abstractions. Move all colors into `tailwind.config` theme.

### 10. Cloud Functions Have No Tests

**Location:** `functions/`

The `functions/` directory contains Cloud Functions (billing alerts, nudge delivery) with zero test files and no test script in `functions/package.json`.

**Recommendation:** Add a test framework for Cloud Functions (firebase-functions-test or vitest). Critical since the PR gate blocks new functions in `functions/src/`.

### 11. ESLint-Disable Comments

**Location:**
- `src/context/GameContext.tsx:256` — `eslint-disable-next-line react-hooks/exhaustive-deps`
- `src/components/VideoRecorder.tsx:196` — `eslint-disable-next-line react-hooks/set-state-in-effect`

**Impact:** Minor — both have explanatory comments and are justified. Track to ensure they don't proliferate.

---

## P3 — Low

### 12. No React.lazy / Code Splitting for Screens

**Location:** `src/App.tsx` (lines 13–25)

All screens are eagerly imported. The Vite build does manual chunking for `firebase` and `react`, but screen components are bundled together.

**Recommendation:** Use `React.lazy()` + `Suspense` for screens not needed at initial load (GamePlayScreen, MyRecordScreen, PrivacyPolicy, etc.).

### 13. No Typed Environment Variables

**Location:** `src/vite-env.d.ts`, `src/firebase.ts`

Firebase config reads from `import.meta.env.VITE_FIREBASE_*` without a typed schema. Missing variables fail silently at runtime.

**Recommendation:** Add a Zod/Valibot schema to validate env vars at build time or app startup.

### 14. `http-proxy-agent` Override in package.json

**Location:** `package.json` (line 41)

```json
"overrides": { "http-proxy-agent": "^7.0.2" }
```

This is a transitive dependency override likely for a security fix. If the upstream has been updated, this override is stale.

**Recommendation:** Check if the override is still needed. Remove if upstream dependency has been updated.

### 15. STL Asset Storage Undocumented (DEC-002)

Already tracked in `docs/DECISIONS.md`. Needs resolution to prevent asset loss.

### 16. Deferred Landing Page Features (DEC-001)

Autoplay hero video and custom fonts. Already documented — revisit when design resources are available.

---

## Dependency Health

| Area | Status |
|------|--------|
| TypeScript strict mode | Enabled (`strict: true`, `noUnusedLocals`, `noUnusedParameters`) |
| ESLint `no-explicit-any` | Enforced in production code, relaxed in tests |
| Package manager | npm (single lockfile, no competing managers) |
| Node version | Pinned to >=22 |
| React version | 18.3.x (stable, not yet React 19) |
| Firebase SDK | v11 (current) |
| Husky + lint-staged | Configured for pre-commit checks |
| CI pipeline | 3 workflows (main, PR gate, release) with lint/typecheck/test/build |

**Notable:** Dependencies are reasonably up-to-date. No known critical vulnerabilities detected in the direct dependency list.

---

## Prioritized Action Plan

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| P0 | Add client-side router | Medium | High — enables deep links, back button, SEO |
| P0 | Implement game list pagination | Small | High — prevents data loss for active users |
| P1 | Split GameContext into focused contexts | Medium | High — performance + maintainability |
| P1 | Add component/screen test coverage | Large | High — prevents regressions in UI |
| P1 | Evaluate lightweight state management | Small | Medium — reduces re-renders |
| P1 | Split smoke-e2e test file | Medium | Medium — improves test maintainability |
| P2 | Route console.warn/error through logger | Small | Medium — improves production debugging |
| P2 | Extract hooks from large screens | Medium | Medium — improves readability |
| P2 | Consolidate Tailwind theme tokens | Small | Low — reduces duplication |
| P2 | Add Cloud Functions tests | Medium | Medium — prevents deploy regressions |
| P3 | Add React.lazy code splitting | Small | Low — improves initial load time |
| P3 | Type environment variables | Small | Low — prevents runtime config errors |
| P3 | Audit package.json overrides | Small | Low — removes stale workarounds |

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
