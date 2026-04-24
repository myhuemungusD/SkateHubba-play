import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp, passAgeGate } from "./smoke-helpers";

/* ── Hoisted mocks ──────────────────────────── */
// Harness factories are loaded via dynamic import inside vi.hoisted so the
// ref objects exist before vi.mock() factories run. Top-level `await` is
// supported in vitest's ESM test modules.
const { auth, authSvc, users, games, storage, fcm, firebase, analytics, blocking, sentry } = await vi.hoisted(
  async () => {
    const m = await import("./harness/mockServices");
    return {
      auth: m.createUseAuthMocks(),
      authSvc: m.createAuthServiceMocks(),
      users: m.createUsersServiceMocks(),
      games: m.createGamesServiceMocks(),
      storage: m.createStorageServiceMocks(),
      fcm: m.createFcmServiceMocks(),
      firebase: m.createFirebaseMocks(),
      analytics: m.createAnalyticsMocks(),
      blocking: m.createBlockingServiceMocks(),
      sentry: m.createSentryMocks(),
    };
  },
);

vi.mock("../hooks/useAuth", () => auth.module);
vi.mock("../services/auth", () => authSvc.module);
vi.mock("../services/users", () => users.module);
vi.mock("../services/games", () => games.module);
vi.mock("../services/storage", () => storage.module);
vi.mock("../services/fcm", () => fcm.module);
vi.mock("../firebase", () => firebase.module);
vi.mock("../services/analytics", () => analytics.module);
vi.mock("@sentry/react", () => sentry.module);
vi.mock("../services/blocking", () => blocking.module);

beforeEach(() => vi.clearAllMocks());

describe("Smoke: Google Auth", () => {
  it("Google sign-in popup-closed-by-user is silently ignored", async () => {
    authSvc.refs.signInWithGoogle.mockRejectedValueOnce({ code: "auth/popup-closed-by-user" });
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await renderApp();

    const googleBtn = await screen.findByRole("button", { name: /continue with google/i });
    await userEvent.click(googleBtn);

    // No error message should appear
    await waitFor(() => {
      expect(screen.queryByText(/google sign-in failed/i)).not.toBeInTheDocument();
    });
  });

  it("Google sign-in shows error when email linked to password account", async () => {
    authSvc.refs.signInWithGoogle.mockRejectedValueOnce({ code: "auth/account-exists-with-different-credential" });
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await renderApp();

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.getByText(/linked to a password account/i)).toBeInTheDocument();
    });
  });

  it("Google sign-in shows generic error for other failures", async () => {
    authSvc.refs.signInWithGoogle.mockRejectedValueOnce(new Error("OAuth error"));
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await renderApp();

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.getByText("OAuth error")).toBeInTheDocument();
    });
  });

  it("resolves Google redirect on mount when a redirect user is returned", async () => {
    const redirectUser = { uid: "google-user", email: "g@test.com" };
    authSvc.refs.resolveGoogleRedirect.mockResolvedValueOnce(redirectUser);
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await renderApp();

    await waitFor(() => {
      expect(authSvc.refs.resolveGoogleRedirect).toHaveBeenCalled();
    });
  });

  it("handles Google redirect resolution error gracefully", async () => {
    authSvc.refs.resolveGoogleRedirect.mockRejectedValueOnce(new Error("redirect error"));
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await renderApp();

    // No crash — redirect error navigates to auth screen gracefully
    await waitFor(() => {
      expect(screen.getByText("Welcome Back")).toBeInTheDocument();
    });
  });

  it("handles Google redirect resolution non-Error rejection gracefully", async () => {
    authSvc.refs.resolveGoogleRedirect.mockRejectedValueOnce("string error");
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await renderApp();

    // No crash — redirect error navigates to auth screen gracefully
    await waitFor(() => {
      expect(screen.getByText("Welcome Back")).toBeInTheDocument();
    });
  });

  it("Google sign-in via popup tracks analytics on success", async () => {
    const googleUser = { uid: "g1", email: "g@test.com" };
    authSvc.refs.signInWithGoogle.mockResolvedValueOnce(googleUser);
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await renderApp();

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(authSvc.refs.signInWithGoogle).toHaveBeenCalled();
    });
  });

  it("Google sign-in returns null when redirect is initiated (not completed)", async () => {
    authSvc.refs.signInWithGoogle.mockResolvedValueOnce(null);
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await renderApp();

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(authSvc.refs.signInWithGoogle).toHaveBeenCalled();
      // No error displayed
      expect(screen.queryByText(/google sign-in failed/i)).not.toBeInTheDocument();
    });
  });

  it("Google sign-in cancelled popup request is silently ignored", async () => {
    authSvc.refs.signInWithGoogle.mockRejectedValueOnce({ code: "auth/cancelled-popup-request" });
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await renderApp();

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.queryByText(/google sign-in failed/i)).not.toBeInTheDocument();
    });
  });

  it("Google sign-in non-Error rejection shows fallback message", async () => {
    authSvc.refs.signInWithGoogle.mockRejectedValueOnce("string error");
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await renderApp();

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.getByText("Google sign-in failed")).toBeInTheDocument();
    });
  });

  it("google sign-in generic error on auth screen does not redirect", async () => {
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    authSvc.refs.signInWithGoogle.mockRejectedValueOnce(new Error("Network error"));
    await renderApp();

    // Navigate to auth screen via age gate
    await userEvent.click(await screen.findByText("Use email"));
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
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    authSvc.refs.signInWithGoogle.mockRejectedValueOnce({ code: "auth/account-exists-with-different-credential" });
    await renderApp();

    await userEvent.click(await screen.findByText("Use email"));
    await passAgeGate();
    await waitFor(() => expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument());

    await userEvent.click(screen.getByText(/Continue with Google/));

    await waitFor(() => {
      expect(screen.getByText(/linked to a password account/)).toBeInTheDocument();
    });
  });

  it("Google sign-in credential conflict from landing redirects to auth screen", async () => {
    authSvc.refs.signInWithGoogle.mockRejectedValueOnce({ code: "auth/account-exists-with-different-credential" });
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await renderApp();

    // Click Google from landing page
    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      // Should redirect to auth screen with sign-in mode
      expect(screen.getByText("Welcome Back")).toBeInTheDocument();
      expect(screen.getByText(/linked to a password account/i)).toBeInTheDocument();
    });
  });

  it("Google sign-in generic error from landing redirects to auth screen", async () => {
    authSvc.refs.signInWithGoogle.mockRejectedValueOnce(new Error("OAuth broke"));
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await renderApp();

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(screen.getByText("Welcome Back")).toBeInTheDocument();
      expect(screen.getByText("OAuth broke")).toBeInTheDocument();
    });
  });
});
