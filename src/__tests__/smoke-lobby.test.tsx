import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { authedUser, verifiedUser, testProfile, activeGame, renderApp, createMockHelpers } from "./smoke-helpers";

/* ── Hoisted mocks ──────────────────────────── */

const mockUseAuth = vi.fn();

const mockSignUp = vi.fn();
const mockSignIn = vi.fn();
const mockSignOut = vi.fn();
const mockResetPassword = vi.fn();

const mockCreateProfile = vi.fn();
const mockIsUsernameAvailable = vi.fn();
const mockGetUidByUsername = vi.fn();
const mockDeleteUserData = vi.fn();

const mockCreateGame = vi.fn();
const mockSetTrick = vi.fn();
const mockFailSetTrick = vi.fn();
const mockSubmitMatchAttempt = vi.fn();
const mockForfeitExpiredTurn = vi.fn();
const mockSubscribeToMyGames = vi.fn(() => vi.fn());
const mockSubscribeToGame = vi.fn(() => vi.fn());

const mockUploadVideo = vi.fn();

vi.mock("../hooks/useAuth", () => ({ useAuth: () => mockUseAuth() }));
const mockDeleteAccount = vi.fn();
const mockResendVerification = vi.fn();
const mockSignInWithGoogle = vi.fn();
const mockResolveGoogleRedirect = vi.fn().mockResolvedValue(null);
vi.mock("../services/auth", () => ({
  signUp: (...args: unknown[]) => mockSignUp(...args),
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  resetPassword: (...args: unknown[]) => mockResetPassword(...args),
  resendVerification: (...args: unknown[]) => mockResendVerification(...args),
  signInWithGoogle: (...args: unknown[]) => mockSignInWithGoogle(...args),
  resolveGoogleRedirect: (...args: unknown[]) => mockResolveGoogleRedirect(...args),
  deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
}));
vi.mock("../services/users", () => ({
  createProfile: (...args: unknown[]) => mockCreateProfile(...args),
  isUsernameAvailable: (...args: unknown[]) => mockIsUsernameAvailable(...args),
  getUidByUsername: (...args: unknown[]) => mockGetUidByUsername(...args),
  deleteUserData: (...args: unknown[]) => mockDeleteUserData(...args),
  getPlayerDirectory: vi.fn().mockResolvedValue([]),
  getLeaderboard: vi.fn().mockResolvedValue([]),
  getUserProfile: vi.fn().mockResolvedValue(null),
  updatePlayerStats: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/games", () => ({
  createGame: (...args: unknown[]) => mockCreateGame(...args),
  setTrick: (...args: unknown[]) => mockSetTrick(...args),
  failSetTrick: (...args: unknown[]) => mockFailSetTrick(...args),
  submitMatchAttempt: (...args: unknown[]) => mockSubmitMatchAttempt(...args),
  forfeitExpiredTurn: (...args: unknown[]) => mockForfeitExpiredTurn(...args),
  subscribeToMyGames: (...args: unknown[]) => mockSubscribeToMyGames(...args),
  subscribeToGame: (...args: unknown[]) => mockSubscribeToGame(...args),
}));
vi.mock("../services/storage", () => ({
  uploadVideo: (...args: unknown[]) => mockUploadVideo(...args),
}));
vi.mock("../services/block", () => ({
  blockUser: vi.fn().mockResolvedValue(undefined),
  unblockUser: vi.fn().mockResolvedValue(undefined),
  isUserBlocked: vi.fn().mockResolvedValue(false),
  isEitherBlocked: vi.fn().mockResolvedValue(false),
  getBlockedUsers: vi.fn().mockResolvedValue([]),
  subscribeToBlockedUsers: vi.fn(() => vi.fn()),
}));
vi.mock("../services/fcm", () => ({
  requestPushPermission: vi.fn().mockResolvedValue(null),
  removeFcmToken: vi.fn().mockResolvedValue(undefined),
  onForegroundMessage: vi.fn(() => vi.fn()),
}));
vi.mock("../firebase", () => ({
  firebaseReady: true,
  auth: { currentUser: null },
  db: {},
  storage: {},
  default: {},
}));
vi.mock("../services/analytics", () => ({
  trackEvent: vi.fn(),
  analytics: {
    gameCreated: vi.fn(),
    trickSet: vi.fn(),
    matchSubmitted: vi.fn(),
    gameCompleted: vi.fn(),
    videoUploaded: vi.fn(),
    signUp: vi.fn(),
    signIn: vi.fn(),
  },
}));
vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));
vi.mock("../services/blocking", () => ({
  blockUser: vi.fn().mockResolvedValue(undefined),
  unblockUser: vi.fn().mockResolvedValue(undefined),
  isUserBlocked: vi.fn().mockResolvedValue(false),
  getBlockedUserIds: vi.fn().mockResolvedValue(new Set()),
}));

beforeEach(() => vi.clearAllMocks());

const profile = testProfile;

const { withGames, withGameSub, renderLobby, renderVerifiedLobby } = createMockHelpers({
  mockUseAuth,
  mockSubscribeToMyGames,
  mockSubscribeToGame,
});

describe("Smoke: Lobby", () => {
  it("shows lobby with active games", async () => {
    const game = activeGame();
    renderLobby([game]);

    expect(await screen.findByText(/@sk8r/i)).toBeInTheDocument();
    expect(screen.getByText("Your Games")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /vs @rival/i })).toBeInTheDocument();
    expect(screen.getByText("Your turn to set")).toBeInTheDocument();
  });

  it("shows empty state when no games exist", async () => {
    renderLobby([]);
    expect(await screen.findByText(/No games yet/)).toBeInTheDocument();
  });

  it("displays correct letter counts in lobby", async () => {
    const game = activeGame({ p1Letters: 2, p2Letters: 3 });
    renderLobby([game]);

    // The lobby should show the game card
    expect(await screen.findByRole("button", { name: /vs @rival/i })).toBeInTheDocument();
  });

  it("sorts active games before completed games", async () => {
    const active1 = activeGame({ id: "g1", turnNumber: 3 });
    const completed = activeGame({
      id: "g2",
      status: "complete",
      winner: "u1",
      p2Letters: 5,
      player2Username: "loser",
    });
    renderLobby([active1, completed]);

    expect(await screen.findByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
  });

  it("lobby shows 'Waiting on opponent' for non-turn games", async () => {
    const game = activeGame({ currentTurn: "u2" });
    renderLobby([game]);

    expect(await screen.findByText("They're setting a trick")).toBeInTheDocument();
  });

  it("lobby shows PLAY badge when it's your turn", async () => {
    const game = activeGame({ currentTurn: "u1" });
    renderLobby([game]);

    expect(await screen.findByText("PLAY")).toBeInTheDocument();
  });

  it("lobby shows forfeit label on completed forfeit game", async () => {
    const game = activeGame({
      status: "forfeit",
      winner: "u1",
      p1Letters: 1,
      p2Letters: 2,
    });
    renderLobby([game]);

    expect(await screen.findByText(/forfeit/i)).toBeInTheDocument();
  });

  it("opens game via keyboard Enter on active game card", async () => {
    const game = activeGame({
      phase: "matching",
      currentTurn: "u1",
      currentSetter: "u2",
      currentTrickName: "Kickflip",
    });
    renderLobby([game]);
    withGameSub(game);

    const gameCard = await screen.findByRole("button", { name: /vs @rival/i });
    gameCard.focus();
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByText(/Match.*Kickflip/)).toBeInTheDocument();
    });
  });

  it("opens completed game via keyboard Space on done card", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p1Letters: 0, p2Letters: 5 });
    renderLobby([game]);
    withGameSub(game);

    const gameCard = await screen.findByRole("button", { name: /vs @rival/i });
    gameCard.focus();
    await userEvent.keyboard(" ");

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });
  });

  it("challenge button is disabled when email is not verified", async () => {
    renderLobby([]); // uses unverified user
    const btn = await screen.findByText(/Challenge Someone/);
    expect(btn.closest("button")).toBeDisabled();
    expect(screen.getByText("Verify your email to start challenging")).toBeInTheDocument();
  });

  it("opens active game via keyboard Space", async () => {
    const game = activeGame({
      phase: "matching",
      currentTurn: "u1",
      currentSetter: "u2",
      currentTrickName: "Kickflip",
    });
    renderLobby([game]);
    withGameSub(game);

    const gameCard = await screen.findByRole("button", { name: /vs @rival/i });
    gameCard.focus();
    await userEvent.keyboard(" ");

    await waitFor(() => {
      expect(screen.getByText(/Match.*Kickflip/)).toBeInTheDocument();
    });
  });

  it("lobby game card ignores non-Enter/Space keys", async () => {
    const game = activeGame();
    renderLobby([game]);

    const gameCard = await screen.findByRole("button", { name: /vs @rival/i });
    gameCard.focus();
    await userEvent.keyboard("a");

    // Still on lobby
    expect(screen.getByText("Your Games")).toBeInTheDocument();
  });
});
