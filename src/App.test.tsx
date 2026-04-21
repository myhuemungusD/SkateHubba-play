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
  getUserProfile: vi.fn().mockResolvedValue(null),
  getUserProfileOnAuth: vi.fn().mockResolvedValue(null),
  isUsernameAvailable: vi.fn(),
  getUidByUsername: vi.fn(),
  getPlayerDirectory: vi.fn().mockResolvedValue([]),
  // Shared validation constants imported by ProfileSetup.
  USERNAME_MIN: 3,
  USERNAME_MAX: 20,
  USERNAME_RE: /^[a-z0-9_]+$/,
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
vi.mock("./services/blocking", () => ({
  blockUser: vi.fn().mockResolvedValue(undefined),
  unblockUser: vi.fn().mockResolvedValue(undefined),
  isUserBlocked: vi.fn().mockResolvedValue(false),
  getBlockedUserIds: vi.fn().mockResolvedValue(new Set()),
  subscribeToBlockedUsers: vi.fn(() => vi.fn()),
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
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
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
      expect(screen.getByText("QUIT SCROLLING.")).toBeInTheDocument();
      expect(screen.getByText("Use email")).toBeInTheDocument();
      expect(screen.getByText("Account")).toBeInTheDocument();
    });
  });

  it("navigates directly to the signup card when 'Use email' is clicked", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    renderApp();

    await userEvent.click(screen.getByText("Use email"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Create Account" })).toBeInTheDocument();
    });
    // DOB inputs are inline on the signup card — no separate age-gate screen.
    expect(screen.getByLabelText("Birth month")).toBeInTheDocument();
    expect(screen.getByLabelText("Birth day")).toBeInTheDocument();
    expect(screen.getByLabelText("Birth year")).toBeInTheDocument();
  });

  it("navigates to sign in screen when 'Account' is clicked", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    renderApp();

    await userEvent.click(screen.getByText("Account"));
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
