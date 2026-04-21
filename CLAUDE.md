# CLAUDE.md — Senior Dev Workflow

This file establishes the production-level problem-solving mindset for working on SkateHubba. Every change follows a disciplined process: understand first, verify assumptions, make targeted changes, prove correctness.

---

## Golden Rules

1. **Read before you write.** Never modify code you haven't read. Understand the existing pattern before changing it.
2. **Diagnose before you fix.** Reproduce the problem. Trace the data flow. Find the root cause — not a symptom.
3. **Smallest diff that solves the problem.** No drive-by refactors. No "while I'm here" improvements. One concern per change.
4. **Prove it works.** Every change must pass type check, lint, tests, and build before it's considered done.
5. **Blast radius awareness.** Know what your change touches. A service function change can affect every screen that calls it. A Firestore rule change affects every user in production.
6. no type of sycophancy
7. always use opus agents for work

---

## Verification Commands

Run these before considering any work complete:

```bash
# The full gate — mirrors CI exactly
npx tsc -b && npm run lint && npm run test:coverage && npm run build

# Quick check during development
npx tsc -b && npm test

# E2E (requires Firebase emulators)
npm run test:e2e
```

Never skip the type check. `tsc -b` catches what ESLint can't.

---

## Problem-Solving Protocol

### Step 1: Reproduce & Understand

- Read the relevant code paths end-to-end before making assumptions
- For bugs: identify the exact state that triggers the issue
- For features: trace how similar features work in the existing codebase
- Check Firestore security rules if the change involves data writes — the rules are the real backend

### Step 2: Identify the Change Surface

- Which files need to change? List them explicitly
- What tests cover this code? Read them
- Are there Firestore rules implications? Check `firestore.rules`
- Will this affect the service layer contract? Check all callers

### Step 3: Make the Change

- Follow existing patterns. This codebase has clear conventions:
  - **Services layer** (`src/services/`): All Firebase SDK calls. Components never import Firebase directly
  - **Screens** (`src/screens/`): Full-page components. State managed via props from `App.tsx`
  - **Components** (`src/components/`): Reusable UI. Tailwind classes only — no CSS modules, no inline styles
  - **Hooks** (`src/hooks/`): Custom React hooks
  - **Routing via react-router-dom.** All routes live in `App.tsx`. Screen transitions go through `NavigationContext.setScreen`
- TypeScript strict mode is on. No `any`. Explicit return types on exported service functions
- Use `runTransaction` for all game state mutations — this is non-negotiable

### Step 4: Prove Correctness

- Run the full verification gate (see above)
- For service changes: 100% test coverage is required on `src/services/` and `src/hooks/`
- For UI changes: add or update smoke tests if behavior changed
- For Firestore rule changes: test against emulators before merge

### Step 5: Commit with Intent

```bash
# Conventional commit format — imperative mood, under 72 chars
feat: add rematch animation between games
fix: prevent double-tap on submit match button
refactor: extract video recorder into hook
test: add forfeit edge case coverage
```

Prefixes: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`

---

## Architecture Guardrails

These are load-bearing decisions. Do not violate them without explicit discussion:

| Guardrail                             | Why                                                                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No custom backend / API server        | Firebase security rules are the authorization layer. Adding a server creates a second source of truth                                                                                                                                       |
| No state management libraries         | Local state + hooks + context is sufficient for this app's complexity                                                                                                                                                                       |
| No UI component libraries             | Tailwind + custom components keeps the bundle lean and the design consistent                                                                                                                                                                |
| URL routing via react-router-dom only | `App.tsx` defines all `<Route>` elements. Screen transitions go through `NavigationContext.setScreen`. No nested routers or lazy routes without discussion                                                                                  |
| No NEW Cloud Functions in PRs         | The existing `functions/src/index.ts` is load-bearing (push notifications, billing alerts, expired-turn forfeit enforcement) and intentionally kept. CI gate (`pr-gate.yml`) rejects new additions beyond those. Discuss before adding more |
| Transactions for game writes          | Race conditions in multiplayer are silent data corruption. Always `runTransaction`                                                                                                                                                          |

---

## Debugging Checklist

When something breaks, work through this in order:

1. **Is it a type error?** Run `npx tsc -b`. TypeScript catches most contract violations
2. **Is it a test failure?** Run `npm test` and read the assertion that fails — not just the test name
3. **Is it a security rule rejection?** Check browser console for Firestore permission errors. Compare the write against `firestore.rules`
4. **Is it a race condition?** Look for missing `await`, non-transactional game writes, or stale closure state in `onSnapshot` callbacks
5. **Is it an emulator vs production mismatch?** Check `src/firebase.ts` — emulator connection is conditional on `VITE_USE_EMULATORS`
6. **Is it a build-only issue?** Vite dev mode is more permissive than production builds. Run `npm run build && npm run preview`

---

## File-Specific Knowledge

| File                      | What to Know                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/App.tsx`             | The entire app state machine. Intentionally large. Don't refactor without discussion                   |
| `src/firebase.ts`         | Firebase init + emulator conditional. Named database `"skatehubba"` (not default)                      |
| `src/services/games.ts`   | All game CRUD. Uses `runTransaction` for state changes. Dual `onSnapshot` for OR queries               |
| `src/services/auth.ts`    | Google OAuth uses popup with redirect fallback (Safari/mobile compatibility)                           |
| `src/services/storage.ts` | Video upload/download. WebM (web) and MP4 (native/Capacitor), 1KB–50MB. Retry with exponential backoff |
| `firestore.rules`         | The real backend. Enforces turn order, score increments, timer, rate limits                            |
| `storage.rules`           | `set` or `match` filenames with `.webm` (web) or `.mp4` (native). Content-type must match extension    |
| `vercel.json`             | CSP headers, HSTS, SPA rewrites, domain redirects. Touch carefully                                     |

---

## What NOT to Do

- Don't add `console.log` — use `console.warn` for expected error paths, Sentry for everything else
- Don't import Firebase SDK in components — go through `src/services/`
- Don't write CSS — use Tailwind utility classes
- Don't add dependencies without justification — keep the bundle lean and audit-clean
- Don't modify `.github/workflows/` without maintainer sign-off — CI gate flags it
- Don't guess at Firestore rule behavior — test against emulators
- Don't skip tests to "ship faster" — the coverage thresholds exist because a bug here means corrupted game state for real users
