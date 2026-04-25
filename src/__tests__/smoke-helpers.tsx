/**
 * Shared test data, helpers, and mock-setup factory for smoke tests.
 *
 * Each smoke-*.test.tsx file declares its own `vi.mock()` calls (they must
 * be hoisted), but reuses the data and helpers exported here.
 *
 * Fixtures (`authedUser`, `verifiedUser`, `testProfile`, `activeGame`) now
 * live in `./harness/mockFactories` — they're re-exported here so legacy
 * imports from `./smoke-helpers` keep working during the gradual migration
 * to the shared harness (see `./harness/mockServices.ts`).
 */
import { vi } from "vitest";
import { render, screen, waitFor, act, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import App from "../App";
import * as fixtures from "./harness/mockFactories";
import type { GameDoc } from "../services/games";
import type { UserProfile } from "../services/users";

// Re-declare as local consts so re-exports survive vitest's vi.hoisted +
// `import { authedUser } from "./smoke-helpers"` transform. Bare re-exports
// (`export { ... } from`) ended up undefined in tests that also call
// `vi.hoisted(async () => ...)`.
export const authedUser = fixtures.authedUser;
export const verifiedUser = fixtures.verifiedUser;
export const testProfile = fixtures.testProfile;
export const activeGame = fixtures.activeGame;
export type MockAuthUser = fixtures.MockAuthUser;

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

/**
 * Mount the app, navigate from landing to the inline signup form, and pass the
 * DOB age gate. Returns the email + password inputs the caller will type into.
 *
 * Caller is responsible for setting up the auth-state mock (e.g. `asSignedOut()`)
 * before calling — this helper assumes the app boots into the unauthenticated
 * landing screen.
 */
export async function openSignupForm(): Promise<{ emailInput: HTMLElement; passwordInputs: HTMLElement[] }> {
  await renderApp();
  await userEvent.click(await screen.findByText("Use email"));
  await passAgeGate();
  return {
    emailInput: screen.getByPlaceholderText("you@email.com"),
    passwordInputs: screen.getAllByPlaceholderText(/•/),
  };
}

/**
 * Mount the app, navigate to the sign-in card, type the supplied credentials,
 * and submit. Wraps the recurring "open Account → fill form → click Sign In"
 * choreography that ~every error-path sign-in test needs.
 *
 * Caller is responsible for setting up the auth-state mock (e.g. `asSignedOut()`)
 * and the relevant `signIn.mockRejectedValueOnce(...)` before calling.
 */
export async function attemptSignIn(email = "user@test.com", password = "password123"): Promise<void> {
  await renderApp();
  await userEvent.click(await screen.findByText("Account"));
  await userEvent.type(await screen.findByPlaceholderText("you@email.com"), email);
  await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], password);
  await userEvent.click(screen.getByRole("button", { name: "Sign In" }));
}

/* ── Mock-dependent helper factories ──────────── */

/**
 * Creates helpers that depend on mock functions.
 * Call once per test file with the file's mock references.
 *
 * NOTE: legacy shim. New tests should build their auth/subscription mocks
 * via the shared `./harness/mockServices` and `./harness/mockAuth` helpers
 * and compose these render helpers themselves.
 */
export function createMockHelpers(mocks: {
  mockUseAuth: ReturnType<typeof vi.fn>;
  mockSubscribeToMyGames: ReturnType<typeof vi.fn>;
  mockSubscribeToGame: ReturnType<typeof vi.fn>;
}) {
  function withGames(games: GameDoc[]) {
    mocks.mockSubscribeToMyGames.mockImplementation((_uid: string, cb: (g: GameDoc[]) => void) => {
      cb(games);
      return vi.fn();
    });
  }

  function withGameSub(game: GameDoc) {
    mocks.mockSubscribeToGame.mockImplementation((_id: string, cb: (g: GameDoc) => void) => {
      cb(game);
      return vi.fn();
    });
  }

  async function renderLobby(games: GameDoc[] = []) {
    mocks.mockUseAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile: testProfile as UserProfile,
      refreshProfile: vi.fn(),
    });
    withGames(games);
    return renderApp();
  }

  async function renderVerifiedLobby(games: GameDoc[] = []) {
    mocks.mockUseAuth.mockReturnValue({
      loading: false,
      user: verifiedUser,
      profile: testProfile as UserProfile,
      refreshProfile: vi.fn(),
    });
    withGames(games);
    return renderApp();
  }

  return { withGames, withGameSub, renderLobby, renderVerifiedLobby };
}
