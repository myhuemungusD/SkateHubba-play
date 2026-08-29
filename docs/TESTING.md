# Testing Guide

## Philosophy

The test suite operates at four levels:

1. **Unit tests** for services and hooks (`src/services/__tests__/`, `src/hooks/__tests__/`) — these verify every exported function with 100% coverage enforced by CI.
2. **Integration/smoke tests** (`src/__tests__/smoke-*.test.tsx`) — these render the full `App` component with mocked Firebase services and verify user-visible behavior across complete screen flows.
3. **Security-rules tests** (`rules-tests/`) — `@firebase/rules-unit-testing` against the Firestore and Storage emulators. The rules _are_ the backend, so this layer is where authorization is actually proven. Run with `npm run test:rules`.
4. **End-to-end tests** (`e2e/`) — Playwright against a real build wired to the Auth/Firestore/Storage emulators. Run with `npm run test:e2e`.

Coverage thresholds are enforced in `vite.config.ts`:

| Directory           | Requirement                                             |
| ------------------- | ------------------------------------------------------- |
| `src/services/**`   | 100% lines, functions, branches, statements             |
| `src/hooks/**`      | 100% lines, functions, branches, statements             |
| `src/firebase.ts`   | 93% lines, 100% functions, 80% branches, 93% statements |
| `src/components/**` | 80% lines, 80% functions, 75% branches, 80% statements  |
| `src/screens/**`    | 80% lines, 80% functions, 75% branches, 80% statements  |

The `src/components/**` and `src/screens/**` floors mean a UI-only change can
fail the coverage gate even when no service was touched. `src/main.tsx`,
`src/vite-env.d.ts`, test files, and `__tests__/**/*test-helpers*.ts` are
excluded from coverage entirely.

---

## Test Stack

| Package                       | Role                                                        |
| ----------------------------- | ----------------------------------------------------------- |
| Vitest                        | Test runner (Vite-native, compatible with `vite.config.ts`) |
| `@testing-library/react`      | `render`, `screen`, `waitFor`, `within`, `act`              |
| `@testing-library/user-event` | Realistic user interactions (type, click, etc.)             |
| `@testing-library/jest-dom`   | DOM matchers (`toBeInTheDocument`, `toHaveValue`, etc.)     |
| jsdom                         | Browser environment simulation                              |

---

## File Locations

```
src/
├── App.test.tsx                     — Basic App mount and auth routing
├── __tests__/
│   ├── setup.ts                     — Global setup: imports jest-dom matchers
│   ├── smoke-helpers.tsx            — Shared test helpers (activeGame, withGames, etc.)
│   ├── harness/                     — Shared mock factories (mockAuth, mockServices,
│   │                                  mockFactories, firestoreNotifMock, deferred)
│   ├── smoke-auth.test.tsx          — Auth flow smoke tests
│   ├── smoke-google.test.tsx        — Google OAuth smoke tests
│   ├── smoke-profile.test.tsx       — Profile setup smoke tests
│   ├── smoke-lobby.test.tsx         — Lobby smoke tests
│   ├── smoke-challenge.test.tsx     — Challenge flow smoke tests
│   ├── smoke-gameplay.test.tsx      — Gameplay smoke tests
│   ├── smoke-gameover.test.tsx      — Game over smoke tests
│   ├── smoke-account.test.tsx       — Account management smoke tests
│   ├── smoke-deeplink.test.tsx      — Notification / invite deep-link routing
│   ├── smoke-onboarding.test.tsx    — Tutorial + mascot onboarding flow
│   ├── main.test.tsx                — React entry point (Sentry init, root mount)
│   ├── firebase.test.ts             — Firebase init tests
│   ├── App-firebase-missing.test.tsx — Firebase missing edge case
│   ├── scripts-duplication-gate.test.ts — Tests for scripts/check-test-duplication.mjs
│   └── scripts-file-length.test.ts  — Tests for scripts/check-file-length.mjs
├── services/__tests__/              — Unit tests for all service modules (100% coverage)
├── hooks/__tests__/                 — Unit tests for all custom hooks (100% coverage)
├── components/__tests__/            — Component-level tests
├── screens/**/__tests__/            — Screen-level tests
└── __mocks__/
    └── firebase.ts                  — Centralized Firebase module mock

rules-tests/                         — Firestore + Storage rules tests (emulator)
├── vitest.config.ts                 — Separate Vitest config (own include glob)
├── _fixtures.ts                     — Shared test-env + seed helpers
└── *.rules.test.ts                  — One file per collection / attack surface

e2e/                                 — Playwright specs (emulator-backed)
├── global-setup.ts
├── helpers/
└── *.spec.ts                        — auth, game, forfeit, map, invite, onboarding,
                                       clip-upload, clip-voting, notification-deeplink,
                                       offline-resilience, signup-back-end-state
```

---

## Mock Architecture

### Firebase module mock (`src/__mocks__/firebase.ts`)

Vitest automatically uses this file when any module imports from `"../firebase"`. It exports:

```ts
{
  firebaseReady: true,
  FIRESTORE_DB_NAME: "skatehubba",
  firestoreCacheMode: "persistent",
  isEmulatorMode: false,        // mutable — some tests flip it
  auth: { currentUser: null },
  db: {},
  storage: {},
  requireAuth: vi.fn(),
  requireDb: vi.fn(),
  requireStorage: vi.fn(),
  isAppCheckInitialized: vi.fn(() => false),
  resetFirebaseMock(),          // resets every spy + mutable export
  default: app,
}
```

This prevents any real Firebase SDK calls from happening in tests.

> **The mock surface MUST mirror `src/firebase.ts`.** Vitest does not type-check
> a manual mock against the real module's exports, so drift is silent — a new
> export in `src/firebase.ts` that is missing here surfaces as `undefined` at
> test time, not as a compile error. Call `resetFirebaseMock()` in `beforeEach`
> when a test mutates `isEmulatorMode` or a `require*` spy.

### Service mocks (per test file)

Each test file mocks service modules individually using `vi.mock()`:

```ts
vi.mock("../services/auth");
vi.mock("../services/users");
vi.mock("../services/games");
vi.mock("../services/storage");
```

Individual mock functions are created with `vi.fn()` and configured per-test with `mockResolvedValueOnce` / `mockRejectedValueOnce`. All mocks are reset in `beforeEach(() => vi.clearAllMocks())`.

### `useAuth` mock

```ts
vi.mock("../hooks/useAuth", () => ({ useAuth: () => mockUseAuth() }));
```

`mockUseAuth.mockReturnValue({ loading, user, profile, refreshProfile, reloadAuthUser })` controls which screen `App.tsx` renders. This is how tests jump directly to the lobby, profile setup, or any other auth-gated screen without going through a real sign-in flow.

---

## Test Helpers (`smoke-helpers.tsx`)

### `activeGame(overrides?)`

Factory function that returns a default `GameDoc`-shaped object. Pass overrides to test specific game states:

```ts
// A game where player 1 has won
activeGame({ status: "complete", winner: "u1", p2Letters: 5 });

// Matching phase — player 1 is matcher, player 2 is setter
activeGame({ phase: "matching", currentTurn: "u1", currentSetter: "u2" });

// Forfeit — player 2's turn expired
activeGame({ status: "forfeit", winner: "u1" });
```

### `withGames(games[])`

Configures `mockSubscribeToMyGames` to synchronously call its callback with the given games array when the lobby mounts:

```ts
withGames([activeGame(), activeGame({ status: "complete", winner: "u1" })]);
```

### `withGameSub(game)`

Configures `mockSubscribeToGame` to synchronously call its callback with the given game when a game card is clicked:

```ts
withGameSub(activeGame({ phase: "matching" }));
```

### `renderLobby(games?)`

Sets up `mockUseAuth` with an authenticated user and profile, calls `withGames(games)`, then renders `<App />`. Most gameplay tests start with this helper.

---

## Running Tests

```bash
npm test              # Unit + component suite, single run
npm run test:watch    # Watch mode for development
npm run test:coverage # Full coverage report with threshold enforcement (the CI gate)
npm run test:rules    # Firestore + Storage rules tests (starts the emulators)
npm run test:e2e      # Playwright E2E (starts the auth/firestore/storage emulators)
npm run test:e2e:ui   # Same, in the Playwright UI runner
```

`test:rules` and `test:e2e` both wrap `firebase emulators:exec`, so they start
and tear down the emulators themselves — you do **not** need `npm run emulators`
running in another shell. They do need the Firebase CLI on your PATH
(`firebase-tools` is a devDependency, so `npx` resolves it).

To see all test names:

```bash
npx vitest run --reporter=verbose
```

---

## Coverage Areas

### Smoke tests (`src/__tests__/smoke-*.test.tsx`)

**Authentication** (`smoke-auth.test.tsx`)

- Sign-up form validation and submission
- Sign-in errors mapped to user-friendly messages
- Password reset flow
- Email verification banner shown when `emailVerified: false`
- Resend verification — 60-second cooldown enforced

**Google OAuth** (`smoke-google.test.tsx`)

- Google OAuth path (mock returns user immediately)
- Redirect resolution error handling

**Profile setup** (`smoke-profile.test.tsx`)

- Username availability check (debounced)
- Username length and format validation
- Stance toggle (Regular / Goofy)
- Successful profile creation calls `createProfile` then `refreshProfile`

**Lobby** (`smoke-lobby.test.tsx`)

- Game list rendered from `subscribeToMyGames`
- Empty state ("No games yet")
- Active games sorted before completed
- "PLAY" badge on games where it's your turn
- "Waiting" label on games where it's your opponent's turn
- Forfeit label on forfeited games

**Challenge** (`smoke-challenge.test.tsx`)

- Self-challenge blocked
- Opponent not found
- Username too short
- Successful challenge creates a game and returns to lobby

**Gameplay** (`smoke-gameplay.test.tsx`)

- Setter UI: trick name input, record button
- Matcher UI: setter's video displayed, landed/missed buttons
- Waiting screen (two contexts: waiting for matcher, waiting for setter)
- Turn timer countdown displayed

**Game over** (`smoke-gameover.test.tsx`)

- Winner screen
- Loser screen
- Forfeit win / forfeit loss
- Rematch creates a new game
- Back to lobby navigation

**Account** (`smoke-account.test.tsx`)

- Account management and deletion flows

### Unit tests (`src/services/__tests__/`, `src/hooks/__tests__/`)

Every exported service function and custom hook has dedicated unit tests with 100% coverage. These verify argument handling, error paths, transaction logic, and edge cases independently of the UI.

---

## Adding New Tests

### Smoke tests (screen flows)

1. Add your test to the appropriate `src/__tests__/smoke-*.test.tsx` file, or create a new `smoke-<area>.test.tsx` if testing a new screen area.
2. Use the helpers from `smoke-helpers.tsx` (`renderLobby`, `activeGame`, `withGames`, `withGameSub`) to set up state.
3. For new service calls, add a `vi.fn()` at the top of the file following the existing pattern and add it to the corresponding `vi.mock()` factory.
4. Tests must not make real Firebase or network calls.
5. Run `npm test` — all existing tests must remain green.

### Service / hook unit tests

1. Add tests to `src/services/__tests__/<module>.test.ts` or `src/hooks/__tests__/<hook>.test.ts`.
2. 100% coverage is mandatory — CI will fail if any line, branch, function, or statement is uncovered.
3. Run `npm run test:coverage` to verify thresholds before pushing.

### Rules tests

1. Add to the existing `rules-tests/<collection>.rules.test.ts`, or create one for a new collection.
2. If your change tightens a rule, add the matching `-redteam` case proving the attack it blocks now fails.
3. Run `npm run test:rules` — it starts the emulators for you.

### E2E tests

1. Add a spec under `e2e/`, reusing the page helpers in `e2e/helpers/`.
2. Seed any required emulator state in `e2e/global-setup.ts` rather than inside the spec.
3. Run `npm run test:e2e:ui` while iterating, then `npm run test:e2e` to confirm it passes headless as CI runs it.

---

## Security-Rules Tests (`rules-tests/`)

`firestore.rules` and `storage.rules` are the real backend, so they get their own
suite — currently 53 files — run against the emulators with
`@firebase/rules-unit-testing`:

```bash
npm run test:rules
```

It uses a **separate Vitest config** (`rules-tests/vitest.config.ts`) with its own
include glob, so these tests never run as part of `npm test` and never count
toward the `src/**` coverage thresholds.

Two naming conventions:

- `<collection>.rules.test.ts` — the happy path plus the documented constraints
  for that collection (`users.rules.test.ts`, `clips.rules.test.ts`,
  `spots.rules.test.ts`, `disputes.rules.test.ts`, …).
- `<area>-redteam.rules.test.ts` — adversarial tests. Each one encodes a specific
  attack that a rule is supposed to stop: turn-order seizure, letter-direction
  tampering, self-upvoting, vote stuffing, rate-limit bypass, privileged-field
  writes, storage path squatting. **When you change a rule, the red-team file is
  the one that proves you didn't widen it.**

Shared setup lives in `rules-tests/_fixtures.ts` (test env construction and seed
helpers). Any new collection or new write path needs a rules test in the same
PR — see the `rules-guardian` guidance in [CLAUDE.md](../CLAUDE.md).

---

## End-to-End Tests (`e2e/`)

Playwright specs drive a real browser against a real build wired to the Auth,
Firestore, and Storage emulators:

```bash
npm run test:e2e       # headless, as CI runs it
npm run test:e2e:ui    # interactive runner for debugging
```

Current coverage: `auth`, `game`, `forfeit`, `map`, `invite`, `onboarding`,
`clip-upload`, `clip-voting`, `notification-deeplink`, `offline-resilience`, and
`signup-back-end-state`. Shared page helpers live in `e2e/helpers/`; emulator
seeding happens in `e2e/global-setup.ts`.

---

## CI Integration

`.github/workflows/main.yml` runs on every push to `main`, every pull request
targeting `main`, and on a nightly schedule. The relevant jobs:

| Job              | What it runs                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `build-and-test` | dependency audit → `as any` guard → `npm run lint` → `npx tsc -b` → `npm run test:coverage` → `check-test-duplication.mjs` → `npm run build` |
| `e2e`            | `npx playwright install --with-deps chromium` → `npm run test:e2e`, with the Playwright report uploaded                                      |
| `lighthouse`     | `npx @lhci/cli autorun` against the built artifact                                                                                           |
| `audit-nightly`  | Blocking dependency audit against the `main` lockfile                                                                                        |

A failing test blocks merge. Note that CI runs `npm run test:coverage`, not bare
`npm test` — a change that keeps every test green but drops a directory below its
coverage floor still fails the gate.

Rules tests (`npm run test:rules`) are **not** part of `main.yml`; run them
locally whenever you touch `firestore.rules`, `storage.rules`, or
`firestore.indexes.json`. Rules deployment has its own workflow
(`.github/workflows/firebase-rules-deploy.yml`).
