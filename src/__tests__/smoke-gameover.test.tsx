import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
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
  subscribeToBlockedUsers: vi.fn(() => vi.fn()),
}));

beforeEach(() => vi.clearAllMocks());

const profile = testProfile;

const { withGames, withGameSub, renderLobby, renderVerifiedLobby } = createMockHelpers({
  mockUseAuth,
  mockSubscribeToMyGames,
  mockSubscribeToGame,
});

describe("Smoke: Game Over", () => {
  it("shows game over screen for a completed game (winner)", async () => {
    const game = activeGame({
      status: "complete",
      winner: "u1",
      p1Letters: 2,
      p2Letters: 5,
    });
    renderVerifiedLobby([game]);
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

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

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByText("S.K.A.T.E.")).toBeInTheDocument();
      expect(screen.getByText(/@rival outlasted you/)).toBeInTheDocument();
    });
  });

  it("rematch from game over creates a new game", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    renderVerifiedLobby([game]);
    withGameSub(game);
    mockCreateGame.mockResolvedValueOnce("game2");

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });

    // After rematch, subscribeToGame will be called for the new game
    withGameSub(activeGame({ id: "game2", phase: "setting", currentSetter: "u1", currentTurn: "u1" }));

    await userEvent.click(screen.getByText(/Rematch/));

    await waitFor(() => {
      expect(mockCreateGame).toHaveBeenCalledWith("u1", "sk8r", "u2", "rival", undefined, undefined);
    });
  });

  it("back to lobby from game over returns to lobby", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Back to Lobby"));

    await waitFor(() => {
      expect(screen.getByText("Your Games")).toBeInTheDocument();
    });
  });

  it("shows forfeit result on game over screen", async () => {
    const game = activeGame({
      status: "forfeit",
      winner: "u1",
      p1Letters: 1,
      p2Letters: 2,
    });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
      expect(screen.getByText(/@rival ran out of time/)).toBeInTheDocument();
    });
  });

  it("shows forfeit loss on game over screen", async () => {
    const game = activeGame({
      status: "forfeit",
      winner: "u2",
      p1Letters: 1,
      p2Letters: 2,
    });
    renderLobby([game]);
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByText("Forfeit")).toBeInTheDocument();
      expect(screen.getByText("You ran out of time.")).toBeInTheDocument();
    });
  });

  it("transitions to game over when realtime update shows game complete", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    renderLobby([game]);

    // First subscription returns active game, then sends a completed update
    let gameUpdateCb: (g: ReturnType<typeof activeGame>) => void;
    mockSubscribeToGame.mockImplementation((_id: string, cb: (g: ReturnType<typeof activeGame>) => void) => {
      gameUpdateCb = cb;
      cb(game); // initial active state
      return vi.fn();
    });

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Name your trick")).toBeInTheDocument();
    });

    // Simulate realtime update: game completed
    const completedGame = activeGame({
      status: "complete",
      winner: "u1",
      p1Letters: 2,
      p2Letters: 5,
    });
    act(() => {
      gameUpdateCb!(completedGame);
    });

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });
  });

  it("game over rematch button shows Starting... while loading", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    // Make createGame hang to show loading state
    mockCreateGame.mockImplementation(() => new Promise(() => {}));
    renderVerifiedLobby([game]);
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => expect(screen.getByText("You Win")).toBeInTheDocument());

    await userEvent.click(screen.getByText(/Rematch/));

    await waitFor(() => {
      expect(screen.getByText("Starting...")).toBeInTheDocument();
    });
  });

  it("game over shows disabled rematch button when email not verified", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    renderLobby([game]); // renderLobby uses unverified user
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
      expect(screen.getByText("Verify email to rematch")).toBeInTheDocument();
    });
  });

  it("game over rematch completes full flow", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    const newGame = activeGame({ id: "game2" });
    mockCreateGame.mockResolvedValueOnce("game2");
    renderVerifiedLobby([game]);
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));
    await waitFor(() => expect(screen.getByText("You Win")).toBeInTheDocument());

    withGameSub(newGame);
    await userEvent.click(screen.getByText(/Rematch/));

    await waitFor(() => {
      expect(mockCreateGame).toHaveBeenCalledWith("u1", "sk8r", "u2", "rival", undefined, undefined);
    });
  });

  it("rematch computes opponent from player2 perspective", async () => {
    const game = activeGame({
      status: "complete",
      winner: "u2",
      player1Uid: "u2",
      player2Uid: "u1",
      player1Username: "rival",
      player2Username: "sk8r",
    });
    mockCreateGame.mockResolvedValueOnce("rematch1");
    mockSubscribeToGame.mockImplementation((_id: string, cb: (g: any) => void) => {
      cb(game);
      return vi.fn();
    });
    renderVerifiedLobby([game]);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));
    await waitFor(() => expect(screen.getByText(/Rematch/)).toBeInTheDocument());

    await userEvent.click(screen.getByText(/Rematch/));
    await waitFor(() => {
      // Should call createGame with the opponent's uid and username
      expect(mockCreateGame).toHaveBeenCalledWith("u1", "sk8r", "u2", "rival", undefined, undefined);
    });
  });

  it("game transitions to gameover on forfeit real-time update", async () => {
    const game = activeGame({
      phase: "matching",
      currentTurn: "u1",
      currentSetter: "u2",
      currentTrickName: "Pop Shove",
    });
    renderLobby([game]);

    let gameUpdateCb: (g: ReturnType<typeof activeGame>) => void;
    mockSubscribeToGame.mockImplementation((_id: string, cb: (g: ReturnType<typeof activeGame>) => void) => {
      gameUpdateCb = cb;
      cb(game);
      return vi.fn();
    });

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => expect(screen.getByText(/Match.*Pop Shove/)).toBeInTheDocument());

    const forfeitGame = activeGame({ status: "forfeit", winner: "u1" });
    act(() => {
      gameUpdateCb!(forfeitGame);
    });

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });
  });
});
