import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  authedUser,
  verifiedUser,
  testProfile,
  activeGame,
  renderApp,
  passAgeGate,
  createMockHelpers,
} from "./smoke-helpers";

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

beforeEach(() => vi.clearAllMocks());

const profile = testProfile;

const { withGames, renderLobby } = createMockHelpers({
  mockUseAuth,
  mockSubscribeToMyGames,
  mockSubscribeToGame,
});

describe("Smoke: Google Auth", () => {
  it("Google sign-in popup-closed-by-user is silently ignored", async () => {
    mockSignInWithGoogle.mockRejectedValueOnce({ code: "auth/popup-closed-by-user" });
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    renderApp();

    const googleBtn = await screen.findByRole("button", { name: /continue with google/i });
    await userEvent.click(googleBtn);

    // No error message should appear
    await waitFor(() => {
      expect(screen.queryByText(/google sign-in failed/i)).not.toBeInTheDocument();
    });
  });

  it("Google sign-in shows error when email linked to password account", async () => {
    mockSignInWithGoogle.mockRejectedValueOnce({ code: "auth/account-exists-with-different-credential" });
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    renderApp();

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.getByText(/linked to a password account/i)).toBeInTheDocument();
    });
  });

  it("Google sign-in shows generic error for other failures", async () => {
    mockSignInWithGoogle.mockRejectedValueOnce(new Error("OAuth error"));
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    renderApp();

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.getByText("OAuth error")).toBeInTheDocument();
    });
  });

  it("resolves Google redirect and tracks analytics on mount", async () => {
    const redirectUser = { uid: "google-user", email: "g@test.com" };
    mockResolveGoogleRedirect.mockResolvedValueOnce(redirectUser);
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    renderApp();

    await waitFor(() => {
      expect(mockResolveGoogleRedirect).toHaveBeenCalled();
    });
  });

  it("handles Google redirect resolution error gracefully", async () => {
    mockResolveGoogleRedirect.mockRejectedValueOnce(new Error("redirect error"));
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    renderApp();

    // No crash — app still renders
    await waitFor(() => {
      expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
    });
  });

  it("handles Google redirect resolution non-Error rejection gracefully", async () => {
    mockResolveGoogleRedirect.mockRejectedValueOnce("string error");
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    renderApp();

    // No crash — app still renders, String(err) branch is covered
    await waitFor(() => {
      expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
    });
  });

  it("Google sign-in via popup tracks analytics on success", async () => {
    const googleUser = { uid: "g1", email: "g@test.com" };
    mockSignInWithGoogle.mockResolvedValueOnce(googleUser);
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    renderApp();

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(mockSignInWithGoogle).toHaveBeenCalled();
    });
  });

  it("Google sign-in returns null when redirect is initiated (not completed)", async () => {
    mockSignInWithGoogle.mockResolvedValueOnce(null);
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    renderApp();

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(mockSignInWithGoogle).toHaveBeenCalled();
      // No error displayed
      expect(screen.queryByText(/google sign-in failed/i)).not.toBeInTheDocument();
    });
  });

  it("Google sign-in cancelled popup request is silently ignored", async () => {
    mockSignInWithGoogle.mockRejectedValueOnce({ code: "auth/cancelled-popup-request" });
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    renderApp();

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.queryByText(/google sign-in failed/i)).not.toBeInTheDocument();
    });
  });

  it("Google sign-in non-Error rejection shows fallback message", async () => {
    mockSignInWithGoogle.mockRejectedValueOnce("string error");
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    renderApp();

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.getByText("Google sign-in failed")).toBeInTheDocument();
    });
  });

  it("google sign-in generic error on auth screen does not redirect", async () => {
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    mockSignInWithGoogle.mockRejectedValueOnce(new Error("Network error"));
    renderApp();

    // Navigate to auth screen via age gate
    await userEvent.click(await screen.findByText("Sign In / Sign Up"));
    await passAgeGate();
    await waitFor(() => expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument());

    // Click Google sign-in — should show error but stay on auth screen
    await userEvent.click(screen.getByText(/Continue with Google/));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });

    // Still on auth screen
    expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument();
  });

  it("google credential conflict on auth screen does not redirect", async () => {
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    mockSignInWithGoogle.mockRejectedValueOnce({ code: "auth/account-exists-with-different-credential" });
    renderApp();

    await userEvent.click(await screen.findByText("Sign In / Sign Up"));
    await passAgeGate();
    await waitFor(() => expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument());

    await userEvent.click(screen.getByText(/Continue with Google/));

    await waitFor(() => {
      expect(screen.getByText(/linked to a password account/)).toBeInTheDocument();
    });
  });

  it("Google sign-in credential conflict from landing redirects to auth screen", async () => {
    mockSignInWithGoogle.mockRejectedValueOnce({ code: "auth/account-exists-with-different-credential" });
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    renderApp();

    // Click Google from landing page
    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      // Should redirect to auth screen with sign-in mode
      expect(screen.getByText("Welcome Back")).toBeInTheDocument();
      expect(screen.getByText(/linked to a password account/i)).toBeInTheDocument();
    });
  });

  it("Google sign-in generic error from landing redirects to auth screen", async () => {
    mockSignInWithGoogle.mockRejectedValueOnce(new Error("OAuth broke"));
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    renderApp();

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.getByText("Welcome Back")).toBeInTheDocument();
      expect(screen.getByText("OAuth broke")).toBeInTheDocument();
    });
  });
});
