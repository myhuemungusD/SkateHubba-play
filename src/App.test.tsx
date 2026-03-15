import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* ── mock hooks/services ────────────────────── */
const mockUseAuth = vi.fn();
vi.mock("./hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("./services/auth", () => ({
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  resendVerification: vi.fn(),
  signInWithGoogle: vi.fn(),
  resolveGoogleRedirect: vi.fn().mockResolvedValue(null),
}));

vi.mock("./services/users", () => ({
  createProfile: vi.fn(),
  isUsernameAvailable: vi.fn(),
  getUidByUsername: vi.fn(),
}));

vi.mock("./services/games", () => ({
  createGame: vi.fn(),
  setTrick: vi.fn(),
  submitMatchResult: vi.fn(),
  forfeitExpiredTurn: vi.fn(),
  subscribeToMyGames: vi.fn(() => vi.fn()),
  subscribeToGame: vi.fn(() => vi.fn()),
}));

vi.mock("./services/storage", () => ({
  uploadVideo: vi.fn(),
}));

vi.mock("./services/analytics", () => ({
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

vi.mock("./firebase", () => ({
  firebaseReady: true,
  auth: { currentUser: null },
  db: {},
  storage: {},
  default: {},
}));

vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

import App from "./App";

beforeEach(() => vi.clearAllMocks());

function renderApp() {
  return render(<App />);
}

/* ── Tests ──────────────────────────────────── */

describe("App", () => {
  it("shows spinner while loading", () => {
    mockUseAuth.mockReturnValue({
      loading: true,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    renderApp();
    expect(screen.getByText("SKATEHUBBA™")).toBeInTheDocument();
  });

  it("shows the landing page when not authenticated", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    renderApp();
    await waitFor(() => {
      expect(screen.getByText("S.K.A.T.E.")).toBeInTheDocument();
      expect(screen.getByText("Get Started with Email")).toBeInTheDocument();
      expect(screen.getByText("I Have an Account")).toBeInTheDocument();
    });
  });

  it("navigates to sign up screen when 'Get Started' is clicked", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    renderApp();

    await userEvent.click(screen.getByText("Get Started with Email"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Create Account" })).toBeInTheDocument();
    });
  });

  it("navigates to sign in screen when 'I Have an Account' is clicked", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    renderApp();

    await userEvent.click(screen.getByText("I Have an Account"));
    await waitFor(() => {
      expect(screen.getByText("Welcome Back")).toBeInTheDocument();
    });
  });

  it("shows profile setup when user exists but has no profile", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", email: "a@b.com" },
      profile: null,
      refreshProfile: vi.fn(),
    });
    renderApp();
    await waitFor(() => {
      expect(screen.getByText("Lock in your handle")).toBeInTheDocument();
    });
  });

  it("shows lobby when user is authenticated with a profile", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", email: "a@b.com" },
      profile: { uid: "u1", username: "sk8r", stance: "regular" },
      refreshProfile: vi.fn(),
    });
    renderApp();
    await waitFor(() => {
      expect(screen.getByText(/@sk8r/i)).toBeInTheDocument();
    });
  });
});
