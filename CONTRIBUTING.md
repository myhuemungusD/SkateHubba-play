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

We don't use a linter or formatter config in this repo, but follow these conventions:

- **TypeScript strict mode** is enabled (`"strict": true` in `tsconfig.app.json`). All new code must type-check cleanly. Run `npx tsc -b` before submitting.
- **No `any`** — use proper types or generics.
- **Tailwind classes** for all styling. Don't add inline styles or CSS modules.
- **Service layer pattern** — UI talks to `src/services/*`, not to Firebase directly. New Firebase operations belong in the relevant service file.
- **No unused imports or variables** — TypeScript strict mode will catch these.
- Keep functions small and focused. The existing `App.tsx` is intentionally large (it's the state machine); new screen logic should follow existing patterns rather than introducing new abstractions.

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
- **CI status checks must pass** before merging (lint, type check, tests, build)
- **Cloud Functions are not allowed** — a CI guard rejects PRs adding code to `functions/src/`
- **Workflow changes are flagged** — modifications to `.github/workflows/` require explicit maintainer review

See [`.github/BRANCH_PROTECTION.md`](.github/BRANCH_PROTECTION.md) for the full ruleset and setup checklist.

---

## Pull Request Checklist

Before opening a PR, confirm:

- [ ] `npx tsc -b` passes with no errors
- [ ] `npm test` passes with no failures
- [ ] `npm run build` completes successfully
- [ ] New features have tests (unit or smoke E2E)
- [ ] No console.log statements left in code (use `console.warn` for expected error paths only)
- [ ] Firebase security rules updated if new collections or fields are added
- [ ] `.env.example` updated if new environment variables are introduced
- [ ] PR description explains what changed and why

---

## Writing Tests

We use Vitest with jsdom. Firebase is mocked via `src/__mocks__/firebase.ts`.

- **Unit tests** go in `src/services/__tests__/` (one file per service)
- **E2E smoke tests** go in `src/__tests__/smoke-e2e.test.tsx`

See [docs/TESTING.md](docs/TESTING.md) for patterns and examples.

---

## What We're Not Looking For

To keep this repo focused:

- No backend / API servers — this is a serverless Firebase app by design
- No new database engines (PostgreSQL, Redis, etc.)
- No state management libraries (Redux, Zustand, etc.) — local state + hooks are sufficient
- No UI component libraries — we use Tailwind with custom components
- No major refactors of `App.tsx` without prior discussion — it's intentionally a monolithic state machine

If you're unsure whether a contribution fits, open an issue first.

---

## Reporting Bugs

Open a GitHub issue with:

- Steps to reproduce
- Expected vs actual behavior
- Browser and OS
- Console errors (if any)

For security issues, see [SECURITY.md](SECURITY.md).
