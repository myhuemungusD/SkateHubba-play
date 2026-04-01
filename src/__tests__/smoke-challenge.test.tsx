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

beforeEach(() => vi.clearAllMocks());

const profile = testProfile;

const { withGames, withGameSub, renderLobby, renderVerifiedLobby } = createMockHelpers({
  mockUseAuth,
  mockSubscribeToMyGames,
  mockSubscribeToGame,
});

describe("Smoke: Challenge", () => {
  it("navigates to challenge screen and sends a challenge", async () => {
    await renderVerifiedLobby([]);
    withGameSub(activeGame());
    mockGetUidByUsername.mockResolvedValueOnce("u2");
    mockCreateGame.mockResolvedValueOnce("game1");

    await userEvent.click(screen.getByText(/Challenge Someone/));
    await waitFor(() => {
      expect(screen.getByText("Challenge")).toBeInTheDocument();
    });
    expect(screen.getByText(/First to S.K.A.T.E. loses/)).toBeInTheDocument();

    const input = screen.getByPlaceholderText("their_handle");
    await userEvent.type(input, "rival");

    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(mockGetUidByUsername).toHaveBeenCalledWith("rival");
      expect(mockCreateGame).toHaveBeenCalledWith("u1", "sk8r", "u2", "rival", undefined, undefined);
    });
  });

  it("challenge screen prevents self-challenge", async () => {
    await renderVerifiedLobby([]);

    await userEvent.click(screen.getByText(/Challenge Someone/));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("their_handle")).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText("their_handle");
    await userEvent.type(input, "sk8r");
    await userEvent.click(screen.getByText(/Send Challenge/));

    expect(screen.getByText("You can't challenge yourself")).toBeInTheDocument();
  });

  it("challenge shows error when opponent not found", async () => {
    mockGetUidByUsername.mockResolvedValueOnce(null);
    await renderVerifiedLobby([]);

    await userEvent.click(screen.getByText(/Challenge Someone/));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("their_handle")).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText("their_handle");
    await userEvent.type(input, "ghost");

    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText(/@ghost doesn't exist yet/)).toBeInTheDocument();
    });
  });

  it("challenge disables send button with short username", async () => {
    await renderVerifiedLobby([]);

    await userEvent.click(screen.getByText(/Challenge Someone/));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("their_handle")).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText("their_handle");
    await userEvent.type(input, "ab");

    const sendBtn = screen.getByText(/Send Challenge/);
    expect(sendBtn.closest("button")).toBeDisabled();
  });

  it("challenge back button returns to lobby", async () => {
    await renderVerifiedLobby([]);

    await userEvent.click(screen.getByText(/Challenge Someone/));
    await waitFor(() => {
      expect(screen.getByText("Challenge")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("← Back"));

    await waitFor(() => {
      expect(screen.getByText("Your Games")).toBeInTheDocument();
    });
  });

  it("challenge screen shows error when createGame fails", async () => {
    mockGetUidByUsername.mockResolvedValueOnce("u2");
    mockCreateGame.mockRejectedValueOnce(new Error("Network error"));
    await renderVerifiedLobby([]);

    await userEvent.click(screen.getByText(/Challenge Someone/));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("their_handle")).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText("their_handle");
    await userEvent.type(input, "rival");
    await userEvent.click(screen.getByRole("button", { name: /send challenge/i }));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("challenge shows validation error for short username on submit", async () => {
    await renderVerifiedLobby([]);
    await userEvent.click(screen.getByText(/Challenge Someone/));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("their_handle")).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText("their_handle");
    await userEvent.type(input, "ab");

    // Submit via form to bypass button disabled state
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await waitFor(() => {
      expect(screen.getByText("Enter a valid username")).toBeInTheDocument();
    });
  });

  it("challenge shows fallback error when onSend throws non-Error", async () => {
    mockGetUidByUsername.mockResolvedValueOnce("u2");
    mockCreateGame.mockRejectedValueOnce("string error");
    await renderVerifiedLobby([]);

    await userEvent.click(screen.getByText(/Challenge Someone/));
    await waitFor(() => {
      expect(screen.getByPlaceholderText("their_handle")).toBeInTheDocument();
    });
    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText("Could not start game")).toBeInTheDocument();
    });
  });

  it("challenge error banner can be dismissed", async () => {
    await renderVerifiedLobby([]);
    await userEvent.click(screen.getByText(/Challenge Someone/));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("their_handle")).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText("their_handle");
    await userEvent.type(input, "sk8r");
    await userEvent.click(screen.getByText(/Send Challenge/));

    expect(screen.getByText("You can't challenge yourself")).toBeInTheDocument();

    await userEvent.click(screen.getByText("×"));
    expect(screen.queryByText("You can't challenge yourself")).not.toBeInTheDocument();
  });

  it("challenge input is locked during loading", async () => {
    mockGetUidByUsername.mockImplementation(() => new Promise(() => {})); // hang
    await renderVerifiedLobby([]);

    await userEvent.click(screen.getByText(/Challenge Someone/));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("their_handle")).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText("their_handle");
    await userEvent.type(input, "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    // Loading state — button shows "Finding..."
    await waitFor(() => {
      expect(screen.getByText("Finding...")).toBeInTheDocument();
    });
  });
});
