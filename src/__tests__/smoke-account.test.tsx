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
  getUserProfileOnAuth: vi.fn().mockResolvedValue(null),
  updatePlayerStats: vi.fn().mockResolvedValue(undefined),
  // ProfileSetup imports these constants and the AgeVerificationRequiredError
  // class. Add minimal stand-ins so a signed-in-but-profile-null user being
  // routed to /profile during recovery-banner tests doesn't crash the mount.
  USERNAME_MIN: 3,
  USERNAME_MAX: 20,
  USERNAME_RE: /^[a-z0-9_]+$/,
  AgeVerificationRequiredError: class AgeVerificationRequiredError extends Error {},
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
const mockRemoveCurrentFcmToken = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/fcm", () => ({
  requestPushPermission: vi.fn().mockResolvedValue(null),
  removeFcmToken: vi.fn().mockResolvedValue(undefined),
  removeCurrentFcmToken: (...args: unknown[]) => mockRemoveCurrentFcmToken(...args),
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

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

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

  it("sign out scrubs the FCM token BEFORE revoking the auth session", async () => {
    mockRemoveCurrentFcmToken.mockClear();
    mockSignOut.mockResolvedValueOnce(undefined);
    mockUseAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile,
      refreshProfile: vi.fn(),
    });
    withGames([]);
    await renderApp();

    await userEvent.click(await screen.findByText("Sign Out"));

    expect(mockRemoveCurrentFcmToken).toHaveBeenCalledWith("u1");
    expect(mockSignOut).toHaveBeenCalled();
    // The FCM scrub must fire before fbSignOut — once the ID token is
    // gone, the owner-only rule on the private-profile subcollection
    // denies the write and the token lingers.
    expect(mockRemoveCurrentFcmToken.mock.invocationCallOrder[0]).toBeLessThan(mockSignOut.mock.invocationCallOrder[0]);
  });

  it("sign out proceeds even when the FCM scrub write fails", async () => {
    mockRemoveCurrentFcmToken.mockRejectedValueOnce(new Error("network fail"));
    mockSignOut.mockResolvedValueOnce(undefined);
    mockUseAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile,
      refreshProfile: vi.fn(),
    });
    withGames([]);
    await renderApp();

    // Post-signout useAuth snaps to null so the UI flips to landing
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });

    await userEvent.click(await screen.findByText("Sign Out"));

    // fbSignOut still runs — a failed scrub can't strand the user on a
    // "still signed in" screen.
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
      expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
    });
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

  it("successful delete calls deleteAccount with uid+username and navigates to landing", async () => {
    // Reverse-order invariant: deleteAccount (which internally runs Auth
    // deletion FIRST, then Firestore wipe) is the single call site from
    // AuthContext. If Auth deletion fails we never touch Firestore — the
    // profile is preserved for retry. deleteUserData is NOT called directly
    // from AuthContext anymore; it's called from inside deleteAccount.
    mockDeleteAccount.mockImplementationOnce(async () => {
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
      expect(mockDeleteAccount).toHaveBeenCalledWith("u1", "sk8r");
      // After deletion, app navigates to landing
      expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
    });
    // Firestore wipe is now internal to deleteAccount — AuthContext must
    // not call it directly (that's the old orphaning path).
    expect(mockDeleteUserData).not.toHaveBeenCalled();
  });

  it("shows error when deleteAccount fails (profile preserved for retry)", async () => {
    mockDeleteAccount.mockRejectedValueOnce(new Error("Auth deletion failed"));
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Auth deletion failed")).toBeInTheDocument();
    });
    // Under reverse order, a deleteAccount throw means Auth deletion failed
    // BEFORE the Firestore wipe — so the caller never touches user data and
    // the profile stays intact for retry.
    expect(mockDeleteUserData).not.toHaveBeenCalled();
    // Modal stays open so user can retry
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();
  });

  it("shows friendly message when deleteAccount requires recent login", async () => {
    const err = new Error("auth/requires-recent-login");
    (err as unknown as { code: string }).code = "auth/requires-recent-login";
    mockDeleteAccount.mockRejectedValueOnce(err);
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText(/sign out and sign back in/)).toBeInTheDocument();
    });
    // No Firestore touch on requires-recent-login — reverse order means the
    // user's profile is still intact for the retry after re-auth.
    expect(mockDeleteUserData).not.toHaveBeenCalled();
    // Modal stays open
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();
  });

  it("captures pending uid to sessionStorage on requires-recent-login", async () => {
    const err = new Error("auth/requires-recent-login");
    (err as unknown as { code: string }).code = "auth/requires-recent-login";
    mockDeleteAccount.mockRejectedValueOnce(err);
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(sessionStorage.getItem("skate.pendingDeleteUid")).toBe("u1");
    });
  });

  it("banner surfaces after sign-back-in and finishes deletion", async () => {
    // Reproduces the full recovery-gap scenario end-to-end through the
    // real UI surface under the reverse-order flow:
    //   1. First delete attempt bounces on auth/requires-recent-login.
    //      No Firestore data was touched — profile still intact. Pending
    //      uid is captured in sessionStorage.
    //   2. User signs out and signs back in with the SAME uid; their
    //      profile reloads (it was never deleted).
    //   3. DeleteAccountRetryBanner matches sessionStorage to the user and
    //      exposes a "Finish" affordance; tapping it re-runs the full
    //      reverse-order deleteAccount and the flag is cleared.
    sessionStorage.setItem("skate.pendingDeleteUid", "u1");
    mockDeleteAccount.mockResolvedValueOnce(undefined);
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

    const finishBtn = await screen.findByRole("button", { name: /finish deleting your account/i });
    await userEvent.click(finishBtn);

    await waitFor(() => {
      expect(mockDeleteAccount).toHaveBeenCalledWith("u1", "sk8r");
    });
    // AuthContext no longer calls deleteUserData directly — it's inside deleteAccount.
    expect(mockDeleteUserData).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("skate.pendingDeleteUid")).toBeNull();
  });

  it("banner surfaces error message when retry fails", async () => {
    sessionStorage.setItem("skate.pendingDeleteUid", "u1");
    const stillRecentErr = Object.assign(new Error("re-auth needed"), { code: "auth/requires-recent-login" });
    mockDeleteAccount.mockRejectedValueOnce(stillRecentErr);
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

    const finishBtn = await screen.findByRole("button", { name: /finish deleting your account/i });
    await userEvent.click(finishBtn);

    await waitFor(() => {
      expect(screen.getByText(/Finish deletion/i)).toBeInTheDocument();
    });
    // Retry path preserves the flag so the user can try again.
    expect(sessionStorage.getItem("skate.pendingDeleteUid")).toBe("u1");
  });

  it("banner is hidden when no pending delete is captured", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: authedUser,
      profile: null,
      refreshProfile: vi.fn(),
    });
    withGames([]);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    // Give the app a tick to settle on whichever screen it routes to.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /finish deleting your account/i })).not.toBeInTheDocument();
    });
  });

  it("banner is hidden when pending uid does not match signed-in user", async () => {
    // Defensive: stale pending flag from a different account must not
    // surface the banner to the current user.
    sessionStorage.setItem("skate.pendingDeleteUid", "SOMEONE_ELSE");
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

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /finish deleting your account/i })).not.toBeInTheDocument();
    });
    // And the effect clears the stale flag.
    await waitFor(() => {
      expect(sessionStorage.getItem("skate.pendingDeleteUid")).toBeNull();
    });
  });

  it("re-entry after auth/requires-recent-login is safe: no data touched first attempt, second attempt succeeds", async () => {
    // Reverse-order flow. First attempt: deleteAccount throws
    // auth/requires-recent-login BEFORE any Firestore write (profile
    // preserved). User re-auths and re-triggers; second attempt succeeds.
    // deleteUserData is never called from AuthContext — it lives inside
    // deleteAccount now.
    const recentErr = Object.assign(new Error("auth/requires-recent-login"), {
      code: "auth/requires-recent-login",
    });
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

    await waitFor(() => {
      expect(screen.getByText(/sign out and sign back in/)).toBeInTheDocument();
    });
    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    expect(mockDeleteUserData).not.toHaveBeenCalled();

    // Second attempt (simulating user re-auth + retry) succeeds end-to-end.
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
    });
    expect(mockDeleteAccount).toHaveBeenCalledTimes(2);
    // deleteUserData is never called directly by AuthContext under the
    // reverse-order flow; it's called from inside deleteAccount.
    expect(mockDeleteUserData).not.toHaveBeenCalled();
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
