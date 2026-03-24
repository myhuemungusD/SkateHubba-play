import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
  getPlayerDirectory: vi.fn().mockResolvedValue([]),
}));

vi.mock("./services/games", () => ({
  createGame: vi.fn(),
  setTrick: vi.fn(),
  submitMatchAttempt: vi.fn(),
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

function renderApp(initialRoute = "/") {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <App />
    </MemoryRouter>,
  );
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
    expect(screen.getByText(/SKATEHUBBA/)).toBeInTheDocument();
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
      expect(screen.getByText("READY TO PLAY?")).toBeInTheDocument();
      expect(screen.getByText("Sign In / Sign Up")).toBeInTheDocument();
      expect(screen.getByText("LOG IN")).toBeInTheDocument();
    });
  });

  it("navigates to age gate screen when 'Get Started' is clicked", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    renderApp();

    await userEvent.click(screen.getByText("Sign In / Sign Up"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Verify Your Age" })).toBeInTheDocument();
    });
  });

  it("navigates to sign in screen when 'LOG IN' is clicked", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    renderApp();

    await userEvent.click(screen.getByText("LOG IN"));
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
      expect(screen.getByText("Pick your handle")).toBeInTheDocument();
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

  it("renders the privacy page at /privacy", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    renderApp("/privacy");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Privacy Policy/i })).toBeInTheDocument();
    });
  });

  it("renders the terms page at /terms", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    renderApp("/terms");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Terms of Service/i })).toBeInTheDocument();
    });
  });

  it("renders 404 for unknown paths", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    renderApp("/nonexistent-page");
    await waitFor(() => {
      expect(screen.getByText("BAIL!")).toBeInTheDocument();
    });
  });
});
