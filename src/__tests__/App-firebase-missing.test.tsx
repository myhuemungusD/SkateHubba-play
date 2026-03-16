import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../firebase", () => ({
  firebaseReady: false,
  auth: null,
  db: null,
  storage: null,
  default: {},
}));

vi.mock("../services/auth", () => ({
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  resendVerification: vi.fn(),
  signInWithGoogle: vi.fn(),
  resolveGoogleRedirect: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/users", () => ({
  createProfile: vi.fn(),
  isUsernameAvailable: vi.fn(),
  getUidByUsername: vi.fn(),
}));

vi.mock("../services/games", () => ({
  createGame: vi.fn(),
  setTrick: vi.fn(),
  submitMatchAttempt: vi.fn(),
  submitConfirmation: vi.fn(),
  forfeitExpiredTurn: vi.fn(),
  subscribeToMyGames: vi.fn(() => vi.fn()),
  subscribeToGame: vi.fn(() => vi.fn()),
}));

vi.mock("../services/storage", () => ({
  uploadVideo: vi.fn(),
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
}));

import App from "../App";

describe("App — Firebase not configured", () => {
  it("shows Setup Required when firebaseReady is false", () => {
    render(<App />);
    expect(screen.getByText("Setup Required")).toBeInTheDocument();
    expect(screen.getByText(/Firebase environment variables are missing/)).toBeInTheDocument();
  });
});
