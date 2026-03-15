import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useGameContext } from "../GameContext";

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ loading: false, user: null, profile: null, refreshProfile: vi.fn() }),
}));
vi.mock("../../services/auth", () => ({
  signOut: vi.fn(),
  signInWithGoogle: vi.fn(),
  resolveGoogleRedirect: vi.fn().mockResolvedValue(null),
  deleteAccount: vi.fn(),
}));
vi.mock("../../services/users", () => ({
  deleteUserData: vi.fn(),
}));
vi.mock("../../services/games", () => ({
  createGame: vi.fn(),
  subscribeToMyGames: vi.fn(() => vi.fn()),
  subscribeToGame: vi.fn(() => vi.fn()),
}));
vi.mock("../../services/analytics", () => ({
  analytics: { signIn: vi.fn(), gameCreated: vi.fn() },
}));
vi.mock("../../services/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  metrics: { signIn: vi.fn(), accountDeleted: vi.fn() },
}));
vi.mock("@sentry/react", () => ({
  captureException: vi.fn(),
}));

describe("useGameContext", () => {
  it("throws when used outside GameProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function TestComponent() {
      useGameContext();
      return null;
    }
    expect(() => render(<TestComponent />)).toThrow("useGameContext must be used within GameProvider");
    spy.mockRestore();
  });
});
