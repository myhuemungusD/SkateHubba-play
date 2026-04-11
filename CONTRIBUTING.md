# Contributing to SkateHubba S.K.A.T.E.

Thanks for your interest in contributing. This document covers how to get set up, how we work, and what we expect from pull requests.

---

## Prerequisites

- **Node.js 22+** — matches the CI environment
- **npm** — comes with Node; we use `npm ci` (not yarn or pnpm)
- **Git**
- **Firebase CLI** (optional, for emulator-based development)

```bash
npm install -g firebase-tools
```

---

## Fork & Clone

1. Fork the repo on GitHub
2. Clone your fork:

```bash
git clone https://github.com/<your-username>/skatehubba-play.git
cd skatehubba-play
npm install
```

3. Add the upstream remote:

```bash
git remote add upstream https://github.com/myhuemungusD/skatehubba-play.git
```

---

## Local Environment Setup

```bash
cp .env.example .env.local
```

Fill in your Firebase project values. If you don't have a Firebase project yet, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for how to use the local emulators instead of a real project.

---

## Development Workflow

```bash
npm run dev        # Start Vite dev server at http://localhost:5173
npm run build      # Type check + production build
npm test           # Run full test suite (Vitest)
npm run test:watch # Tests in watch mode while editing
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for full local setup including Firebase emulators.

---

## Code Style

This repo ships with a full lint + format toolchain. Run it before you push:

```bash
npm run lint     # ESLint 9 (flat config in eslint.config.js)
npm run format   # Prettier 3.8 over src/**/*.{ts,tsx}
```

Husky + lint-staged run ESLint + Prettier on staged files at pre-commit, so most formatting issues are fixed automatically.

Conventions on top of the tooling:

- **TypeScript strict mode** is enabled (`"strict": true` in `tsconfig.app.json`). All new code must type-check cleanly. Run `npx tsc -b` before submitting.
- **No `any`** in production code — the `guard-as-any-casts` CI job fails the build if it finds any.
- **Tailwind v4 classes** for all styling. Don't add inline styles or CSS modules.
- **Service layer pattern** — UI talks to `src/services/*`, not to Firebase directly. New Firebase operations belong in the relevant service file.
- **No unused imports or variables** — TypeScript strict mode (`noUnusedLocals` / `noUnusedParameters`) catches these.
- Keep functions small and focused. The existing `App.tsx` is intentionally large (it owns the `<Routes>` tree, auth guard, and `NavigationContext`); new screen logic should follow existing patterns rather than introducing new abstractions.
- **No `TODO`/`FIXME`/`HACK`** — the `guard-todo-fixme-hack` CI job rejects these. Resolve them before opening a PR.

---

## Branch Naming

```
feature/<short-description>
fix/<short-description>
docs/<short-description>
```

Examples: `feature/rematch-animation`, `fix/turn-timer-edge-case`, `docs/api-reference`

---

## Commit Messages

Use the imperative mood and keep the first line under 72 characters:

```
feat: add rematch animation between games
fix: prevent double-tap on submit match button
docs: add emulator setup instructions
refactor: extract video recorder into hook
test: add forfeit edge case to smoke tests
```

Prefixes: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`

---

## Branch Protection

The `main` branch has protection rules that apply to all contributors, including AI agents:

- **Direct pushes to `main` are blocked** — all changes must go through a pull request
- **At least 1 approving review** from a CODEOWNER is required
- **CI status checks must pass** before merging (lint → type check → `test:coverage` → build → Lighthouse CI, plus Playwright E2E against Firebase emulators)
- **Cloud Functions changes are gated** — a small set of Cloud Functions already exists (push notifications, billing alerts, and the `checkExpiredTurns` scheduled turn-forfeit). The `verify-no-cloud-functions` CI guard rejects any PR that modifies or adds files under `functions/src/` without explicit maintainer approval
- **Workflow changes are flagged** — modifications to `.github/workflows/` require explicit maintainer review

See [`.github/BRANCH_PROTECTION.md`](.github/BRANCH_PROTECTION.md) for the full ruleset and setup checklist.

---

## Pull Request Checklist

Before opening a PR, confirm:

- [ ] `npm run lint` passes with no errors
- [ ] `npx tsc -b` passes with no errors
- [ ] `npm run test:coverage` passes with no failures (thresholds are enforced)
- [ ] `npm run build` completes successfully
- [ ] For changes that affect rules or gameplay: `npm run test:rules` and/or `npm run test:e2e` pass locally (both require the Firebase emulators)
- [ ] New features have tests (unit + smoke)
- [ ] No `console.log` statements left in code (use `console.warn` for expected error paths only)
- [ ] Firebase security rules updated if new collections or fields are added
- [ ] `.env.example` updated if new environment variables are introduced
- [ ] PR description explains what changed and why

---

## Writing Tests

We use Vitest 4 with jsdom. Firebase is mocked via `src/__mocks__/firebase.ts`.

- **Unit tests** go in `src/services/__tests__/` and `src/hooks/__tests__/` (one file per module, 100% coverage enforced)
- **Smoke tests** are split by area under `src/__tests__/smoke-*.test.tsx` (auth, lobby, challenge, gameplay, gameover, profile, google, account). Extend the existing file for the relevant area or create a new `smoke-<area>.test.tsx`.
- **Firestore rule tests** live in `rules-tests/` and run via `npm run test:rules` against the emulator.
- **Playwright E2E tests** live in `e2e/` and run via `npm run test:e2e` against the emulator.

See [docs/TESTING.md](docs/TESTING.md) for patterns and examples.

---

## What We're Not Looking For

To keep this repo focused:

- No backend / API servers — this is a Firebase-backed app by design. Cloud Functions exist only for push notifications, billing alerts, and the scheduled `checkExpiredTurns` turn-forfeit; new functions need explicit maintainer approval.
- No new database engines (PostgreSQL, Redis, etc.)
- No state management libraries (Redux, Zustand, etc.) — local state + hooks + `NavigationContext` are sufficient
- No UI component libraries — we use Tailwind v4 with custom components
- No major refactors of `App.tsx` (which owns the `<Routes>` tree + auth guard) without prior discussion

If you're unsure whether a contribution fits, open an issue first.

---

## Reporting Bugs

Open a GitHub issue with:

- Steps to reproduce
- Expected vs actual behavior
- Browser and OS
- Console errors (if any)

For security issues, see [SECURITY.md](SECURITY.md).
