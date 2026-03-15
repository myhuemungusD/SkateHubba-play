# Testing Guide

## Philosophy

Tests operate at the integration/smoke level: they render the full `App` component with mocked Firebase services and verify user-visible behavior. There are no unit tests for individual service functions because those functions are thin wrappers over the Firebase SDK — the SDK itself is tested by Firebase.

The goal of the test suite is confidence that the full screen flow works as expected, not 100% line coverage.

---

## Test Stack

| Package | Role |
|---------|------|
| Vitest | Test runner (Vite-native, compatible with `vite.config.ts`) |
| `@testing-library/react` | `render`, `screen`, `waitFor`, `within`, `act` |
| `@testing-library/user-event` | Realistic user interactions (type, click, etc.) |
| `@testing-library/jest-dom` | DOM matchers (`toBeInTheDocument`, `toHaveValue`, etc.) |
| jsdom | Browser environment simulation |

---

## File Locations

```
src/
├── App.test.tsx                  — Basic App mount and auth routing (a few tests)
├── __tests__/
│   ├── setup.ts                  — Global setup: imports jest-dom matchers
│   └── smoke-e2e.test.tsx        — Full game flow smoke tests (45+ tests)
└── __mocks__/
    └── firebase.ts               — Centralized Firebase module mock
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

## Test Helpers (`smoke-e2e.test.tsx`)

### `activeGame(overrides?)`

Factory function that returns a default `GameDoc`-shaped object. Pass overrides to test specific game states:

```ts
// A game where player 1 has won
activeGame({ status: "complete", winner: "u1", p2Letters: 5 })

// Matching phase — player 1 is matcher, player 2 is setter
activeGame({ phase: "matching", currentTurn: "u1", currentSetter: "u2" })

// Forfeit — player 2's turn expired
activeGame({ status: "forfeit", winner: "u1" })
```

### `withGames(games[])`

Configures `mockSubscribeToMyGames` to synchronously call its callback with the given games array when the lobby mounts:

```ts
withGames([activeGame(), activeGame({ status: "complete", winner: "u1" })])
```

### `withGameSub(game)`

Configures `mockSubscribeToGame` to synchronously call its callback with the given game when a game card is clicked:

```ts
withGameSub(activeGame({ phase: "matching" }))
```

### `renderLobby(games?)`

Sets up `mockUseAuth` with an authenticated user and profile, calls `withGames(games)`, then renders `<App />`. Most gameplay tests start with this helper.

---

## Running Tests

```bash
npm test              # Single run — used in CI
npm run test:watch    # Watch mode for development
```

To see all test names:

```bash
npx vitest run --reporter=verbose
```

---

## Coverage Areas

The 45+ smoke tests in `smoke-e2e.test.tsx` cover:

**Authentication**
- Sign-up form validation and submission
- Sign-in errors mapped to user-friendly messages
- Google OAuth path (mock returns user immediately)
- Password reset flow
- Email verification banner shown when `emailVerified: false`
- Resend verification — 60-second cooldown enforced

**Profile setup**
- Username availability check (debounced)
- Username length and format validation
- Stance toggle (Regular / Goofy)
- Successful profile creation calls `createProfile` then `refreshProfile`

**Lobby**
- Game list rendered from `subscribeToMyGames`
- Empty state ("No games yet")
- Active games sorted before completed
- "PLAY" badge on games where it's your turn
- "Waiting" label on games where it's your opponent's turn
- Forfeit label on forfeited games

**Challenge**
- Self-challenge blocked
- Opponent not found
- Username too short
- Successful challenge creates a game and returns to lobby

**Gameplay**
- Setter UI: trick name input, record button
- Matcher UI: setter's video displayed, landed/missed buttons
- Waiting screen (two contexts: waiting for matcher, waiting for setter)
- Turn timer countdown displayed

**Game over**
- Winner screen
- Loser screen
- Forfeit win / forfeit loss
- Rematch creates a new game
- Back to lobby navigation

**Real-time updates**
- Active game transitions to game-over when `subscribeToGame` fires with a completed game

**Error handling**
- Firebase error codes (`auth/email-already-in-use`, etc.) shown as user-facing messages
- Error banner dismissal

---

## Adding New Tests

1. Add your test to `src/__tests__/smoke-e2e.test.tsx` inside the existing `describe` block.
2. Use the helpers (`renderLobby`, `activeGame`, `withGames`, `withGameSub`) to set up state.
3. For new service calls, add a `vi.fn()` at the top of the file following the existing pattern and add it to the corresponding `vi.mock()` factory.
4. Tests must not make real Firebase or network calls.
5. Run `npm test` — all existing tests must remain green.

---

## CI Integration

GitHub Actions runs `npm test` on every push to `main` and on every pull request targeting `main`. A failing test blocks merge. See `.github/workflows/main.yml`.
