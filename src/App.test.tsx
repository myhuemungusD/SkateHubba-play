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

vi.mock("./firebase", () => ({
  firebaseReady: true,
  auth: { currentUser: null },
  db: {},
  storage: {},
  default: {},
}));

import App, { ErrorBoundary, isFirebaseStorageUrl } from "./App";

beforeEach(() => vi.clearAllMocks());

/* ── Tests ──────────────────────────────────── */

describe("App", () => {
  it("shows spinner while loading", () => {
    mockUseAuth.mockReturnValue({
      loading: true,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    render(<App />);
    expect(screen.getByText("SKATEHUBBA™")).toBeInTheDocument();
  });

  it("shows the landing page when not authenticated", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    render(<App />);
    expect(screen.getByText("S.K.A.T.E.")).toBeInTheDocument();
    expect(screen.getByText("Get Started with Email")).toBeInTheDocument();
    expect(screen.getByText("I Have an Account")).toBeInTheDocument();
  });

  it("navigates to sign up screen when 'Get Started' is clicked", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    render(<App />);

    await userEvent.click(screen.getByText("Get Started with Email"));
    expect(screen.getByRole("heading", { name: "Create Account" })).toBeInTheDocument();
  });

  it("navigates to sign in screen when 'I Have an Account' is clicked", async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      profile: null,
      refreshProfile: vi.fn(),
    });
    render(<App />);

    await userEvent.click(screen.getByText("I Have an Account"));
    expect(screen.getByText("Welcome Back")).toBeInTheDocument();
  });

  it("shows profile setup when user exists but has no profile", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", email: "a@b.com" },
      profile: null,
      refreshProfile: vi.fn(),
    });
    render(<App />);
    // Profile setup screen heading
    expect(screen.getByText("Lock in your handle")).toBeInTheDocument();
  });

  it("shows lobby when user is authenticated with a profile", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", email: "a@b.com" },
      profile: { uid: "u1", username: "sk8r", stance: "regular" },
      refreshProfile: vi.fn(),
    });
    render(<App />);
    expect(screen.getByText(/@sk8r/i)).toBeInTheDocument();
  });
});

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(<ErrorBoundary><div>hello</div></ErrorBoundary>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("renders error UI when a child throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const Bomb = (): never => { throw new Error("test error"); };
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByText("Something broke")).toBeInTheDocument();
    expect(screen.getByText("test error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload App" })).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("reload button calls window.location.reload", async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, reload }, writable: true });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const Bomb = (): never => { throw new Error("boom"); };
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    await user.click(screen.getByRole("button", { name: "Reload App" }));
    expect(reload).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("isFirebaseStorageUrl", () => {
  it("accepts a googleapis.com storage URL matching the configured bucket", () => {
    vi.stubEnv("VITE_FIREBASE_STORAGE_BUCKET", "mybucket.firebasestorage.app");
    const url = "https://firebasestorage.googleapis.com/v0/b/mybucket.firebasestorage.app/o/games%2Fclip.webm?alt=media";
    expect(isFirebaseStorageUrl(url)).toBe(true);
    vi.unstubAllEnvs();
  });

  it("rejects a googleapis.com URL for a different bucket", () => {
    vi.stubEnv("VITE_FIREBASE_STORAGE_BUCKET", "mybucket.firebasestorage.app");
    const url = "https://firebasestorage.googleapis.com/v0/b/otherbucket.firebasestorage.app/o/clip.webm";
    expect(isFirebaseStorageUrl(url)).toBe(false);
    vi.unstubAllEnvs();
  });

  it("accepts a .firebasestorage.app CDN URL matching the configured bucket", () => {
    vi.stubEnv("VITE_FIREBASE_STORAGE_BUCKET", "mybucket.firebasestorage.app");
    const url = "https://mybucket.firebasestorage.app/v0/b/mybucket.firebasestorage.app/o/clip.webm";
    expect(isFirebaseStorageUrl(url)).toBe(true);
    vi.unstubAllEnvs();
  });

  it("rejects http:// URLs", () => {
    expect(isFirebaseStorageUrl("http://firebasestorage.googleapis.com/v0/b/x/o/y")).toBe(false);
  });

  it("rejects arbitrary https URLs", () => {
    expect(isFirebaseStorageUrl("https://evil.com/video.webm")).toBe(false);
  });

  it("rejects javascript: URIs", () => {
    expect(isFirebaseStorageUrl("javascript:alert(1)")).toBe(false);
  });
});
