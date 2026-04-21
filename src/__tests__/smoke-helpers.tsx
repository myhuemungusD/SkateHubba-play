/**
 * Shared test data, helpers, and mock-setup factory for smoke tests.
 *
 * Each smoke-*.test.tsx file declares its own `vi.mock()` calls (they must
 * be at file level), but reuses the data and helpers exported here.
 */
import { vi } from "vitest";
import { render, screen, waitFor, act, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import App from "../App";

/* ── Shared test data ─────────────────────────── */

export const authedUser = { uid: "u1", email: "sk8r@test.com", emailVerified: false };
export const verifiedUser = { uid: "u1", email: "sk8r@test.com", emailVerified: true };
export const testProfile = { uid: "u1", username: "sk8r", stance: "regular" };

export function activeGame(overrides: Record<string, unknown> = {}) {
  return {
    id: "game1",
    player1Uid: "u1",
    player2Uid: "u2",
    player1Username: "sk8r",
    player2Username: "rival",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: "u1",
    phase: "setting",
    currentSetter: "u1",
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: { toMillis: () => Date.now() + 86400000 },
    turnNumber: 1,
    winner: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

/* ── Pure UI helpers (no mock dependencies) ────── */

/** Wait for React.lazy() Suspense boundary to resolve after navigation. */
export async function flushLazy(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByRole("status", { name: "Loading" })).not.toBeInTheDocument();
  });
}

/**
 * Render App inside a MemoryRouter. By default, waits for React.lazy()
 * Suspense boundaries to resolve. Pass `{ waitForLazy: false }` to skip
 * the wait (e.g. when testing the auth loading spinner).
 */
export async function renderApp(opts?: { waitForLazy?: boolean }): Promise<RenderResult> {
  let result!: RenderResult;
  await act(async () => {
    result = render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
  });
  if (opts?.waitForLazy !== false) {
    await flushLazy();
  }
  return result;
}

/**
 * Fill the inline DOB fields on the AuthScreen signup form with a valid adult
 * DOB. The app no longer has a standalone age-gate screen — DOB is collected
 * alongside email + password on the same auth card.
 */
export async function passAgeGate() {
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Create Account" })).toBeInTheDocument();
  });
  await userEvent.type(screen.getByLabelText("Birth month"), "01");
  await userEvent.type(screen.getByLabelText("Birth day"), "15");
  await userEvent.type(screen.getByLabelText("Birth year"), "2000");
}

/* ── Mock-dependent helper factories ──────────── */

/**
 * Creates helpers that depend on mock functions.
 * Call once per test file with the file's mock references.
 */
export function createMockHelpers(mocks: {
  mockUseAuth: ReturnType<typeof vi.fn>;
  mockSubscribeToMyGames: ReturnType<typeof vi.fn>;
  mockSubscribeToGame: ReturnType<typeof vi.fn>;
}) {
  function withGames(games: ReturnType<typeof activeGame>[]) {
    mocks.mockSubscribeToMyGames.mockImplementation(
      (_uid: string, cb: (g: ReturnType<typeof activeGame>[]) => void) => {
        cb(games);
        return vi.fn();
      },
    );
  }

  function withGameSub(game: ReturnType<typeof activeGame>) {
    mocks.mockSubscribeToGame.mockImplementation((_id: string, cb: (g: ReturnType<typeof activeGame>) => void) => {
      cb(game);
      return vi.fn();
    });
  }

  async function renderLobby(games: ReturnType<typeof activeGame>[] = []) {
    mocks.mockUseAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile: testProfile,
      refreshProfile: vi.fn(),
    });
    withGames(games);
    return renderApp();
  }

  async function renderVerifiedLobby(games: ReturnType<typeof activeGame>[] = []) {
    mocks.mockUseAuth.mockReturnValue({
      loading: false,
      user: verifiedUser,
      profile: testProfile,
      refreshProfile: vi.fn(),
    });
    withGames(games);
    return renderApp();
  }

  return { withGames, withGameSub, renderLobby, renderVerifiedLobby };
}
