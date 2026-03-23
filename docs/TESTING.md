# Testing Guide

## Philosophy

The test suite operates at two levels:

1. **Unit tests** for services and hooks (`src/services/__tests__/`, `src/hooks/__tests__/`) — these verify every exported function with 100% coverage enforced by CI.
2. **Integration/smoke tests** (`src/__tests__/smoke-*.test.tsx`) — these render the full `App` component with mocked Firebase services and verify user-visible behavior across complete screen flows.

Coverage thresholds are enforced in `vite.config.ts`:

| Directory         | Requirement                                             |
| ----------------- | ------------------------------------------------------- |
| `src/services/**` | 100% lines, functions, branches, statements             |
| `src/hooks/**`    | 100% lines, functions, branches, statements             |
| `src/firebase.ts` | 93% lines, 100% functions, 80% branches, 93% statements |

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
│   ├── smoke-auth.test.tsx          — Auth flow smoke tests
│   ├── smoke-google.test.tsx        — Google OAuth smoke tests
│   ├── smoke-profile.test.tsx       — Profile setup smoke tests
│   ├── smoke-lobby.test.tsx         — Lobby smoke tests
│   ├── smoke-challenge.test.tsx     — Challenge flow smoke tests
│   ├── smoke-gameplay.test.tsx      — Gameplay smoke tests
│   ├── smoke-gameover.test.tsx      — Game over smoke tests
│   ├── smoke-account.test.tsx       — Account management smoke tests
│   ├── firebase.test.ts             — Firebase init tests
│   └── App-firebase-missing.test.tsx — Firebase missing edge case
├── services/__tests__/              — Unit tests for all service modules (100% coverage)
├── hooks/__tests__/                 — Unit tests for all custom hooks (100% coverage)
├── components/__tests__/            — Component-level tests
└── __mocks__/
    └── firebase.ts                  — Centralized Firebase module mock
```

---

## Mock Architecture

### Firebase module mock (`src/__mocks__/firebase.ts`)

Vitest automatically uses this file when any module imports from `"../firebase"`. It exports:

```ts
{
  firebaseReady: true,
  auth: { currentUser: null },
  db: {},
  storage: {},
  requireDb: () => ({}),
  requireAuth: () => ({}),
  requireStorage: () => ({}),
  default: {},
}
```

This prevents any real Firebase SDK calls from happening in tests.

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

`mockUseAuth.mockReturnValue({ loading, user, profile, refreshProfile })` controls which screen `App.tsx` renders. This is how tests jump directly to the lobby, profile setup, or any other auth-gated screen without going through a real sign-in flow.

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
npm test              # Single run — used in CI
npm run test:watch    # Watch mode for development
npm run test:coverage # Full coverage report with threshold enforcement
```

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

---

## CI Integration

GitHub Actions runs `npm test` on every push to `main` and on every pull request targeting `main`. A failing test blocks merge. See `.github/workflows/main.yml`.
