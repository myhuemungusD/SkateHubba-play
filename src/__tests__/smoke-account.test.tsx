import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp, createMockHelpers } from "./smoke-helpers";
import { makeAuthStateSetters } from "./harness/mockAuth";

/* ── Hoisted mocks ──────────────────────────── */
// The aggregate factory lives in ./harness/mockServices. Dynamic-importing it
// inside vi.hoisted() keeps the ref objects available before vi.mock() factory
// callbacks run.
const { auth, authSvc, users, userData, games, storage, fcm, firebase, analytics, blocking, onboarding, sentry } =
  await vi.hoisted(async () => (await import("./harness/mockServices")).createAllSmokeMocks());

vi.mock("../hooks/useAuth", () => auth.module);
vi.mock("../services/auth", () => authSvc.module);
vi.mock("../services/users", () => users.module);
vi.mock("../services/userData", () => userData.module);
vi.mock("../services/games", () => games.module);
vi.mock("../services/storage", () => storage.module);
vi.mock("../services/fcm", () => fcm.module);
vi.mock("../firebase", () => firebase.module);
vi.mock("../services/analytics", () => analytics.module);
vi.mock("@sentry/react", () => sentry.module);
vi.mock("../services/blocking", () => blocking.module);
vi.mock("../services/onboarding", () => onboarding.module);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

const { asUnverifiedUser, asSignedOut } = makeAuthStateSetters(auth.refs);

/** Build an auth/requires-recent-login error matching Firebase's shape. */
function requiresRecentLoginError(message = "auth/requires-recent-login"): Error & { code: string } {
  return Object.assign(new Error(message), { code: "auth/requires-recent-login" });
}
const { withGames, renderLobby } = createMockHelpers({
  mockUseAuth: auth.refs.useAuth,
  mockSubscribeToMyGames: games.refs.subscribeToMyGames,
  mockSubscribeToGame: games.refs.subscribeToGame,
});

describe("Smoke: Account & Sign Out", () => {
  it("sign out returns to landing", async () => {
    authSvc.refs.signOut.mockResolvedValueOnce(undefined);

    // After sign out, useAuth returns no user
    asUnverifiedUser();
    withGames([]);

    await renderApp();

    expect(await screen.findByText("Sign Out")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Sign Out"));

    expect(authSvc.refs.signOut).toHaveBeenCalled();
  });

  it("sign out scrubs the FCM token BEFORE revoking the auth session", async () => {
    fcm.refs.removeCurrentFcmToken.mockClear();
    authSvc.refs.signOut.mockResolvedValueOnce(undefined);
    asUnverifiedUser();
    withGames([]);
    await renderApp();

    await userEvent.click(await screen.findByText("Sign Out"));

    expect(fcm.refs.removeCurrentFcmToken).toHaveBeenCalledWith("u1");
    expect(authSvc.refs.signOut).toHaveBeenCalled();
    // The FCM scrub must fire before fbSignOut — once the ID token is
    // gone, the owner-only rule on the private-profile subcollection
    // denies the write and the token lingers.
    expect(fcm.refs.removeCurrentFcmToken.mock.invocationCallOrder[0]).toBeLessThan(
      authSvc.refs.signOut.mock.invocationCallOrder[0],
    );
  });

  it("sign out proceeds even when the FCM scrub write fails", async () => {
    fcm.refs.removeCurrentFcmToken.mockRejectedValueOnce(new Error("network fail"));
    authSvc.refs.signOut.mockResolvedValueOnce(undefined);
    asUnverifiedUser();
    withGames([]);
    await renderApp();

    // Post-signout useAuth snaps to null so the UI flips to landing
    asSignedOut();

    await userEvent.click(await screen.findByText("Sign Out"));

    // fbSignOut still runs — a failed scrub can't strand the user on a
    // "still signed in" screen.
    await waitFor(() => {
      expect(authSvc.refs.signOut).toHaveBeenCalled();
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
    expect(users.refs.deleteUserData).not.toHaveBeenCalled();
    expect(authSvc.refs.deleteAccount).not.toHaveBeenCalled();
  });

  it("successful delete calls deleteAccount with uid+username and navigates to landing", async () => {
    // Reverse-order invariant: deleteAccount (which internally runs Auth
    // deletion FIRST, then Firestore wipe) is the single call site from
    // AuthContext. If Auth deletion fails we never touch Firestore — the
    // profile is preserved for retry. deleteUserData is NOT called directly
    // from AuthContext anymore; it's called from inside deleteAccount.
    authSvc.refs.deleteAccount.mockImplementationOnce(async () => {
      // Simulate Firebase sign-out after auth account deletion
      asSignedOut();
    });

    asUnverifiedUser();
    withGames([]);
    await renderApp();

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(authSvc.refs.deleteAccount).toHaveBeenCalledWith("u1", "sk8r");
      // After deletion, app navigates to landing
      expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
    });
    // Firestore wipe is now internal to deleteAccount — AuthContext must
    // not call it directly (that's the old orphaning path).
    expect(users.refs.deleteUserData).not.toHaveBeenCalled();
  });

  it("shows error when deleteAccount fails (profile preserved for retry)", async () => {
    authSvc.refs.deleteAccount.mockRejectedValueOnce(new Error("Auth deletion failed"));
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Auth deletion failed")).toBeInTheDocument();
    });
    // Under reverse order, a deleteAccount throw means Auth deletion failed
    // BEFORE the Firestore wipe — so the caller never touches user data and
    // the profile stays intact for retry.
    expect(users.refs.deleteUserData).not.toHaveBeenCalled();
    // Modal stays open so user can retry
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();
  });

  it("shows friendly message when deleteAccount requires recent login", async () => {
    authSvc.refs.deleteAccount.mockRejectedValueOnce(requiresRecentLoginError());
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText(/sign out and sign back in/)).toBeInTheDocument();
    });
    // No Firestore touch on requires-recent-login — reverse order means the
    // user's profile is still intact for the retry after re-auth.
    expect(users.refs.deleteUserData).not.toHaveBeenCalled();
    // Modal stays open
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();
  });

  it("captures pending uid to sessionStorage on requires-recent-login", async () => {
    authSvc.refs.deleteAccount.mockRejectedValueOnce(requiresRecentLoginError());
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
    authSvc.refs.deleteAccount.mockResolvedValueOnce(undefined);
    asUnverifiedUser();
    withGames([]);
    await renderApp();

    const finishBtn = await screen.findByRole("button", { name: /finish deleting your account/i });
    await userEvent.click(finishBtn);

    await waitFor(() => {
      expect(authSvc.refs.deleteAccount).toHaveBeenCalledWith("u1", "sk8r");
    });
    // AuthContext no longer calls deleteUserData directly — it's inside deleteAccount.
    expect(users.refs.deleteUserData).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("skate.pendingDeleteUid")).toBeNull();
  });

  it("banner surfaces error message when retry fails", async () => {
    sessionStorage.setItem("skate.pendingDeleteUid", "u1");
    authSvc.refs.deleteAccount.mockRejectedValueOnce(requiresRecentLoginError("re-auth needed"));
    asUnverifiedUser();
    withGames([]);
    await renderApp();

    const finishBtn = await screen.findByRole("button", { name: /finish deleting your account/i });
    await userEvent.click(finishBtn);

    await waitFor(() => {
      expect(screen.getByText(/Finish deletion/i)).toBeInTheDocument();
    });
    // Retry path preserves the flag so the user can try again.
    expect(sessionStorage.getItem("skate.pendingDeleteUid")).toBe("u1");
  });

  it("banner is hidden when no pending delete is captured", async () => {
    asUnverifiedUser(null);
    withGames([]);
    await renderApp();

    // Give the app a tick to settle on whichever screen it routes to.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /finish deleting your account/i })).not.toBeInTheDocument();
    });
  });

  it("banner is hidden when pending uid does not match signed-in user", async () => {
    // Defensive: stale pending flag from a different account must not
    // surface the banner to the current user.
    sessionStorage.setItem("skate.pendingDeleteUid", "SOMEONE_ELSE");
    asUnverifiedUser();
    withGames([]);
    await renderApp();

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
    authSvc.refs.deleteAccount.mockRejectedValueOnce(requiresRecentLoginError()).mockImplementationOnce(async () => {
      asSignedOut();
    });

    asUnverifiedUser();
    withGames([]);
    await renderApp();

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText(/sign out and sign back in/)).toBeInTheDocument();
    });
    expect(authSvc.refs.deleteAccount).toHaveBeenCalledTimes(1);
    expect(users.refs.deleteUserData).not.toHaveBeenCalled();

    // Second attempt (simulating user re-auth + retry) succeeds end-to-end.
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
    });
    expect(authSvc.refs.deleteAccount).toHaveBeenCalledTimes(2);
    // deleteUserData is never called directly by AuthContext under the
    // reverse-order flow; it's called from inside deleteAccount.
    expect(users.refs.deleteUserData).not.toHaveBeenCalled();
  });

  it("shows generic error message for unknown firebase auth error", async () => {
    authSvc.refs.signIn.mockRejectedValueOnce({ code: "auth/some-unknown-error", message: "Unknown auth error" });
    asSignedOut();
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
    authSvc.refs.signOut.mockRejectedValueOnce(new Error("Sign out network error"));
    asUnverifiedUser();
    withGames([]);
    await renderApp();

    // After sign-out (even on error), the context clears state → useAuth returns no user
    asSignedOut();

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
    authSvc.refs.deleteAccount.mockRejectedValueOnce(new Error("Deletion failed"));
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
    authSvc.refs.deleteAccount.mockRejectedValueOnce("string error");
    await renderLobby([]);

    await userEvent.click(await screen.findByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Deletion failed — try again")).toBeInTheDocument();
    });
  });

  it("handles signOut non-Error rejection gracefully", async () => {
    authSvc.refs.signOut.mockRejectedValueOnce("string error");
    asUnverifiedUser();
    withGames([]);
    await renderApp();

    asSignedOut();
    await userEvent.click(await screen.findByText("Sign Out"));

    await waitFor(() => {
      expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
    });
  });
});
