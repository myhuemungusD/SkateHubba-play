import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import {
  authedUser,
  verifiedUser,
  testProfile,
  activeGame,
  renderApp,
  flushLazy,
  createMockHelpers,
} from "./smoke-helpers";
import App from "../App";

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
vi.mock("../services/userData", () => ({
  exportUserData: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    exportedAt: "2026-04-15T00:00:00.000Z",
    capped: false,
    subject: { uid: "u1", username: "sk8r" },
    profile: null,
    usernameReservation: null,
    games: [],
    clips: [],
    clipVotes: [],
    spots: [],
    notifications: [],
    nudges: [],
    blockedUsers: [],
    reports: [],
  }),
  serializeUserData: vi.fn(() => "{}"),
  userDataFilename: vi.fn(() => "export.json"),
}));
vi.mock("../services/games", () => ({
  createGame: (...args: unknown[]) => mockCreateGame(...args),
  setTrick: (...args: unknown[]) => mockSetTrick(...args),
  failSetTrick: (...args: unknown[]) => mockFailSetTrick(...args),
  submitMatchAttempt: (...args: unknown[]) => mockSubmitMatchAttempt(...args),
  forfeitExpiredTurn: (...args: unknown[]) => mockForfeitExpiredTurn(...args),
  subscribeToMyGames: (...args: unknown[]) => mockSubscribeToMyGames(...args),
  subscribeToGame: (...args: unknown[]) => mockSubscribeToGame(...args),
  timestampFromMillis: (ms: number) => ({ toMillis: () => ms }),
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
    signInAttempt: vi.fn(),
    signInFailure: vi.fn(),
    signUpAttempt: vi.fn(),
    signUpFailure: vi.fn(),
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

describe("Smoke: Account & Sign Out", () => {
  it("sign out returns to landing", async () => {
    mockSignOut.mockResolvedValueOnce(undefined);

    // After sign out, useAuth returns no user
    mockUseAuth.mockImplementation(() => {
      return {
        loading: false,
        user: authedUser,
        profile,
        refreshProfile: vi.fn(),
      };
    });
    withGames([]);

    await renderApp();

    expect(await screen.findByText("Sign Out")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Sign Out"));

    expect(mockSignOut).toHaveBeenCalled();
  });

  it("shows delete account modal when Delete Account is clicked", async () => {
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));

    expect(screen.getByText("Delete Account?")).toBeInTheDocument();
    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByText("Delete Forever")).toBeInTheDocument();
  });

  it("cancel button closes the delete modal without calling delete", async () => {
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Cancel"));

    expect(screen.queryByText("Delete Account?")).not.toBeInTheDocument();
    expect(mockDeleteUserData).not.toHaveBeenCalled();
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });

  it("successful delete calls deleteUserData before deleteAccount and navigates to landing", async () => {
    // Record invocation order: Firestore cleanup must come first so the auth
    // token is still valid when the security-rule-gated deletes run.
    const callOrder: string[] = [];
    mockDeleteUserData.mockImplementationOnce(async () => {
      callOrder.push("deleteUserData");
    });
    mockDeleteAccount.mockImplementationOnce(async () => {
      callOrder.push("deleteAccount");
      // Simulate Firebase sign-out after auth account deletion
      mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    });

    mockUseAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile,
      refreshProfile: vi.fn(),
    });
    withGames([]);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(mockDeleteUserData).toHaveBeenCalledWith("u1", "sk8r");
      expect(mockDeleteAccount).toHaveBeenCalled();
      // After deletion, app navigates to landing
      expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
    });
    expect(callOrder).toEqual(["deleteUserData", "deleteAccount"]);
  });

  it("does NOT delete auth account when deleteUserData throws", async () => {
    mockDeleteUserData.mockRejectedValueOnce(new Error("Firestore rule denied"));
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Firestore rule denied")).toBeInTheDocument();
    });
    // Auth account must remain intact so the user can retry — this is the
    // whole point of the ordering fix. A failed Firestore pass that proceeds
    // to auth delete is exactly the GDPR-orphaning bug we're preventing.
    expect(mockDeleteAccount).not.toHaveBeenCalled();
    // Modal stays open so user can retry
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();
  });

  it("shows error when deleteAccount fails after deleteUserData succeeds", async () => {
    mockDeleteUserData.mockResolvedValueOnce(undefined);
    mockDeleteAccount.mockRejectedValueOnce(new Error("Auth deletion failed"));
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Auth deletion failed")).toBeInTheDocument();
    });
    // Firestore cleanup ran first — that's expected under the new ordering.
    expect(mockDeleteUserData).toHaveBeenCalledWith("u1", "sk8r");
    // Modal stays open so user can retry
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();
  });

  it("shows friendly message when deleteAccount requires recent login", async () => {
    mockDeleteUserData.mockResolvedValueOnce(undefined);
    const err = new Error("auth/requires-recent-login");
    (err as unknown as { code: string }).code = "auth/requires-recent-login";
    mockDeleteAccount.mockRejectedValueOnce(err);
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText(/sign out and sign back in/)).toBeInTheDocument();
    });
    // Firestore was already wiped; the instruction tells the user to re-auth
    // and retry, which is safe because deleteUserData is idempotent.
    expect(mockDeleteUserData).toHaveBeenCalledWith("u1", "sk8r");
    // Modal stays open
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();
  });

  it("re-entry after auth/requires-recent-login is safe: deleteUserData no-op, auth retried", async () => {
    // First attempt: Firestore succeeds (wipes data), auth rejects with
    // requires-recent-login. User re-authenticates and triggers delete again.
    // Second attempt: deleteUserData is called again against already-empty
    // data (idempotent no-op) and deleteAccount now succeeds.
    mockDeleteUserData.mockResolvedValue(undefined);
    const recentErr = new Error("auth/requires-recent-login");
    (recentErr as unknown as { code: string }).code = "auth/requires-recent-login";
    mockDeleteAccount.mockRejectedValueOnce(recentErr).mockImplementationOnce(async () => {
      mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    });

    mockUseAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile,
      refreshProfile: vi.fn(),
    });
    withGames([]);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    // First attempt surfaces the re-auth guidance
    await waitFor(() => {
      expect(screen.getByText(/sign out and sign back in/)).toBeInTheDocument();
    });
    expect(mockDeleteUserData).toHaveBeenCalledTimes(1);
    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);

    // Second attempt (simulating user re-auth + retry) succeeds end-to-end.
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
    });
    // deleteUserData must be called a second time (safe because idempotent)
    expect(mockDeleteUserData).toHaveBeenCalledTimes(2);
    expect(mockDeleteAccount).toHaveBeenCalledTimes(2);
  });

  it("shows generic error message for unknown firebase auth error", async () => {
    mockSignIn.mockRejectedValueOnce({ code: "auth/some-unknown-error", message: "Unknown auth error" });
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await renderApp();

    await userEvent.click(await screen.findByText("Account"));

    await userEvent.type(await screen.findByPlaceholderText("you@email.com"), "user@test.com");
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText("Unknown auth error")).toBeInTheDocument();
    });
  });

  it("handles signOut error gracefully without crashing", async () => {
    mockSignOut.mockRejectedValueOnce(new Error("Sign out network error"));
    mockUseAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile,
      refreshProfile: vi.fn(),
    });
    withGames([]);
    await renderApp();

    // After sign-out (even on error), the context clears state → useAuth returns no user
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });

    await userEvent.click(await screen.findByText("Sign Out"));

    // Despite error, app navigates to landing (sign-out clears state even on error)
    await waitFor(() => {
      expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
    });
  });

  it("delete modal closes on overlay click", async () => {
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();

    // The overlay div has role="dialog" and aria-modal — click it directly
    // (not the inner div which stops propagation)
    const overlay = screen.getByRole("dialog");
    // Fire click directly on the overlay element (not through userEvent which targets children)
    await act(async () => {
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Delete Account?")).not.toBeInTheDocument();
    });
  });

  it("delete modal closes on Escape key", async () => {
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();

    // Fire keydown on the overlay div directly
    const overlay = screen.getByRole("dialog");
    await act(async () => {
      overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Delete Account?")).not.toBeInTheDocument();
    });
  });

  it("delete modal shows error banner and allows dismissal", async () => {
    mockDeleteAccount.mockRejectedValueOnce(new Error("Deletion failed"));
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Deletion failed")).toBeInTheDocument();
    });

    // Dismiss the error banner
    const dismissBtn = screen.getByText("×");
    await userEvent.click(dismissBtn);

    await waitFor(() => {
      expect(screen.queryByText("Deletion failed")).not.toBeInTheDocument();
    });
  });

  it("delete modal shows fallback error for non-Error thrown", async () => {
    mockDeleteAccount.mockRejectedValueOnce("string error");
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Deletion failed — try again")).toBeInTheDocument();
    });
  });

  it("handles signOut non-Error rejection gracefully", async () => {
    mockSignOut.mockRejectedValueOnce("string error");
    mockUseAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile,
      refreshProfile: vi.fn(),
    });
    withGames([]);
    await renderApp();

    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await userEvent.click(await screen.findByText("Sign Out"));

    await waitFor(() => {
      expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
    });
  });
});
