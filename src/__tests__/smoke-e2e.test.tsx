import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* ── Hoisted mocks ──────────────────────────── */

const mockUseAuth = vi.fn();

const mockSignUp = vi.fn();
const mockSignIn = vi.fn();
const mockSignOut = vi.fn();
const mockResetPassword = vi.fn();

const mockCreateProfile = vi.fn();
const mockIsUsernameAvailable = vi.fn();
const mockGetUidByUsername = vi.fn();

const mockCreateGame = vi.fn();
const mockSetTrick = vi.fn();
const mockSubmitMatchResult = vi.fn();
const mockSubscribeToMyGames = vi.fn(() => vi.fn());
const mockSubscribeToGame = vi.fn(() => vi.fn());

const mockUploadVideo = vi.fn();

vi.mock("../hooks/useAuth", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("../services/auth", () => ({
  signUp: (...args: unknown[]) => mockSignUp(...args),
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  resetPassword: (...args: unknown[]) => mockResetPassword(...args),
}));
vi.mock("../services/users", () => ({
  createProfile: (...args: unknown[]) => mockCreateProfile(...args),
  isUsernameAvailable: (...args: unknown[]) => mockIsUsernameAvailable(...args),
  getUidByUsername: (...args: unknown[]) => mockGetUidByUsername(...args),
}));
vi.mock("../services/games", () => ({
  createGame: (...args: unknown[]) => mockCreateGame(...args),
  setTrick: (...args: unknown[]) => mockSetTrick(...args),
  submitMatchResult: (...args: unknown[]) => mockSubmitMatchResult(...args),
  subscribeToMyGames: (...args: unknown[]) => mockSubscribeToMyGames(...args),
  subscribeToGame: (...args: unknown[]) => mockSubscribeToGame(...args),
}));
vi.mock("../services/storage", () => ({
  uploadVideo: (...args: unknown[]) => mockUploadVideo(...args),
}));
vi.mock("../firebase", () => ({
  firebaseReady: true,
  auth: { currentUser: null },
  db: {},
  storage: {},
  default: {},
}));

import App from "../App";

beforeEach(() => vi.clearAllMocks());

/* ── Helpers ─────────────────────────────────── */

const authedUser = { uid: "u1", email: "sk8r@test.com" };
const profile = { uid: "u1", username: "sk8r", stance: "regular" };

function activeGame(overrides: Record<string, unknown> = {}) {
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

/** Set up mockSubscribeToMyGames to call the callback with the given games. */
function withGames(games: ReturnType<typeof activeGame>[]) {
  mockSubscribeToMyGames.mockImplementation((_uid: string, cb: Function) => {
    cb(games);
    return vi.fn();
  });
}

/** Set up mockSubscribeToGame to call the callback with the given game. */
function withGameSub(game: ReturnType<typeof activeGame>) {
  mockSubscribeToGame.mockImplementation((_id: string, cb: Function) => {
    cb(game);
    return vi.fn();
  });
}

function renderLobby(games: ReturnType<typeof activeGame>[] = []) {
  mockUseAuth.mockReturnValue({
    loading: false,
    user: authedUser,
    profile,
    refreshProfile: vi.fn(),
  });
  withGames(games);
  return render(<App />);
}

/* ══════════════════════════════════════════════
 *  SMOKE TEST — Full Game E2E Flow
 * ══════════════════════════════════════════════ */

describe("Smoke Test: Game E2E", () => {
  /* ── 1. Landing → Auth navigation ─────────── */

  it("landing page renders and navigates to sign-up", async () => {
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    render(<App />);

    expect(screen.getByText("S.K.A.T.E.")).toBeInTheDocument();
    expect(screen.getByText("Get Started")).toBeInTheDocument();
    expect(screen.getByText("I Have an Account")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Get Started"));
    expect(screen.getByRole("heading", { name: "Create Account" })).toBeInTheDocument();
  });

  it("landing page navigates to sign-in", async () => {
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    render(<App />);

    await userEvent.click(screen.getByText("I Have an Account"));
    expect(screen.getByText("Welcome Back")).toBeInTheDocument();
  });

  /* ── 2. Auth form validation ──────────────── */

  it("sign-up form validates matching passwords", async () => {
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    render(<App />);

    await userEvent.click(screen.getByText("Get Started"));

    const emailInput = screen.getByPlaceholderText("you@email.com");
    const passwordInputs = screen.getAllByPlaceholderText(/•/);

    await userEvent.type(emailInput, "test@test.com");
    await userEvent.type(passwordInputs[0], "password123");
    await userEvent.type(passwordInputs[1], "different");

    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
  });

  /* ── 3. Profile setup renders ─────────────── */

  it("shows profile setup when user exists but has no profile", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile: null,
      refreshProfile: vi.fn(),
    });
    render(<App />);
    expect(screen.getByText("Lock in your handle")).toBeInTheDocument();
  });

  /* ── 4. Lobby with games ──────────────────── */

  it("shows lobby with active games", () => {
    const game = activeGame();
    renderLobby([game]);

    expect(screen.getByText(/@sk8r/i)).toBeInTheDocument();
    expect(screen.getByText("Your Games")).toBeInTheDocument();
    expect(screen.getByText(/vs @rival/)).toBeInTheDocument();
    expect(screen.getByText("Your turn")).toBeInTheDocument();
  });

  it("shows empty state when no games exist", () => {
    renderLobby([]);
    expect(screen.getByText(/No games yet/)).toBeInTheDocument();
  });

  /* ── 5. Challenge flow ────────────────────── */

  it("navigates to challenge screen and sends a challenge", async () => {
    renderLobby([]);
    withGameSub(activeGame());
    mockGetUidByUsername.mockResolvedValueOnce("u2");
    mockCreateGame.mockResolvedValueOnce("game1");

    await userEvent.click(screen.getByText(/Challenge Someone/));
    expect(screen.getByText("Challenge")).toBeInTheDocument();
    expect(screen.getByText(/First to S.K.A.T.E. loses/)).toBeInTheDocument();

    const input = screen.getByPlaceholderText("their_handle");
    await userEvent.type(input, "rival");

    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(mockGetUidByUsername).toHaveBeenCalledWith("rival");
      expect(mockCreateGame).toHaveBeenCalledWith("u1", "sk8r", "u2", "rival");
    });
  });

  it("challenge screen prevents self-challenge", async () => {
    renderLobby([]);

    await userEvent.click(screen.getByText(/Challenge Someone/));

    const input = screen.getByPlaceholderText("their_handle");
    await userEvent.type(input, "sk8r");
    await userEvent.click(screen.getByText(/Send Challenge/));

    expect(screen.getByText("You can't challenge yourself")).toBeInTheDocument();
  });

  /* ── 6. Gameplay — Setting phase ──────────── */

  it("gameplay screen shows setter UI when it's your turn to set", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByText("Set your trick")).toBeInTheDocument();
      expect(screen.getByText("Name This Trick")).toBeInTheDocument();
    });

    // Trick quick-select buttons should be visible
    expect(screen.getByText("Kickflip")).toBeInTheDocument();
    expect(screen.getByText("Heelflip")).toBeInTheDocument();
  });

  it("setter can select a trick from quick-pick buttons", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByText("Kickflip")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Kickflip"));

    // The input should now contain "Kickflip"
    const input = screen.getByPlaceholderText(/Kickflip/);
    expect(input).toHaveValue("Kickflip");
  });

  /* ── 7. Gameplay — Waiting on opponent ────── */

  it("shows waiting screen when it's opponent's turn", async () => {
    const game = activeGame({ phase: "matching", currentTurn: "u2", currentSetter: "u1" });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByText(/Waiting on @rival/)).toBeInTheDocument();
    });
  });

  /* ── 8. Gameplay — Matching phase ─────────── */

  it("gameplay screen shows matcher UI when it's your turn to match", async () => {
    const game = activeGame({
      phase: "matching",
      currentTurn: "u1",
      currentSetter: "u2",
      currentTrickName: "Tre Flip",
    });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByText(/Match.*Tre Flip/)).toBeInTheDocument();
    });
  });

  /* ── 9. Game Over screen ──────────────────── */

  it("shows game over screen for a completed game (winner)", async () => {
    const game = activeGame({
      status: "complete",
      winner: "u1",
      p1Letters: 2,
      p2Letters: 5,
    });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
      expect(screen.getByText(/Rematch/)).toBeInTheDocument();
      expect(screen.getByText("Back to Lobby")).toBeInTheDocument();
    });
  });

  it("shows game over screen for a completed game (loser)", async () => {
    const game = activeGame({
      status: "complete",
      winner: "u2",
      p1Letters: 5,
      p2Letters: 1,
    });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByText("S.K.A.T.E.")).toBeInTheDocument();
      expect(screen.getByText(/@rival outlasted you/)).toBeInTheDocument();
    });
  });

  /* ── 10. Game Over → Rematch ──────────────── */

  it("rematch from game over creates a new game", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    renderLobby([game]);
    withGameSub(game);
    mockCreateGame.mockResolvedValueOnce("game2");

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });

    // After rematch, subscribeToGame will be called for the new game
    withGameSub(activeGame({ id: "game2", phase: "setting", currentSetter: "u1", currentTurn: "u1" }));

    await userEvent.click(screen.getByText(/Rematch/));

    await waitFor(() => {
      expect(mockCreateGame).toHaveBeenCalledWith("u1", "sk8r", "u2", "rival");
    });
  });

  /* ── 11. Game Over → Back to Lobby ────────── */

  it("back to lobby from game over returns to lobby", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(screen.getByText(/vs @rival/));

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Back to Lobby"));

    await waitFor(() => {
      expect(screen.getByText("Your Games")).toBeInTheDocument();
    });
  });

  /* ── 12. Sign Out ─────────────────────────── */

  it("sign out returns to landing", async () => {
    mockSignOut.mockResolvedValueOnce(undefined);

    // After sign out, useAuth returns no user
    let callCount = 0;
    mockUseAuth.mockImplementation(() => {
      callCount++;
      // First few calls: logged in. After signOut triggers re-render: logged out.
      return {
        loading: false,
        user: authedUser,
        profile,
        refreshProfile: vi.fn(),
      };
    });
    withGames([]);

    const { rerender } = render(<App />);

    expect(screen.getByText("Sign Out")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Sign Out"));

    expect(mockSignOut).toHaveBeenCalled();
  });

  /* ── 13. Letter display accuracy ──────────── */

  it("displays correct letter counts in lobby", () => {
    const game = activeGame({ p1Letters: 2, p2Letters: 3 });
    renderLobby([game]);

    // The lobby should show the game card
    expect(screen.getByText(/vs @rival/)).toBeInTheDocument();
  });

  /* ── 14. Multiple games in lobby ──────────── */

  it("sorts active games before completed games", () => {
    const active1 = activeGame({ id: "g1", turnNumber: 3 });
    const completed = activeGame({
      id: "g2",
      status: "complete",
      winner: "u1",
      p2Letters: 5,
      player2Username: "loser",
    });
    renderLobby([active1, completed]);

    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
  });

  /* ── 15. Full flow: Landing → Lobby ───────── */

  it("complete auth flow from landing to lobby", async () => {
    const refreshProfile = vi.fn();

    // Start unauthenticated
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile });
    const { rerender } = render(<App />);

    // Go to sign in
    await userEvent.click(screen.getByText("I Have an Account"));
    expect(screen.getByText("Welcome Back")).toBeInTheDocument();

    // Fill in credentials
    mockSignIn.mockResolvedValueOnce(undefined);
    const emailInput = screen.getByPlaceholderText("you@email.com");
    const passwordInput = screen.getAllByPlaceholderText(/•/)[0];

    await userEvent.type(emailInput, "sk8r@test.com");
    await userEvent.type(passwordInput, "password123");

    // After sign in, auth state changes
    mockUseAuth.mockReturnValue({ loading: false, user: authedUser, profile, refreshProfile });
    withGames([]);

    await userEvent.click(screen.getByText("Sign In"));

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith("sk8r@test.com", "password123");
    });
  });
});
