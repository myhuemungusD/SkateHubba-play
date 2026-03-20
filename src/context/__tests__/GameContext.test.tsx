import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { Component, type ReactNode } from "react";
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
  updatePlayerStats: vi.fn().mockResolvedValue(undefined),
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
vi.mock("../../lib/sentry", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

/** Error boundary that captures the error for assertions. */
class ErrorCatcher extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <span data-testid="error">{this.state.error.message}</span> : this.props.children;
  }
}

describe("useGameContext", () => {
  it("throws when used outside GameProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    function TestComponent() {
      useGameContext();
      return null;
    }

    const { getByTestId } = render(
      <ErrorCatcher>
        <TestComponent />
      </ErrorCatcher>,
    );

    expect(getByTestId("error").textContent).toBe("useGameContext must be used within GameProvider");
    spy.mockRestore();
  });

  it("returns context value when used inside GameProvider", async () => {
    const { GameProvider } = await import("../GameContext");

    function TestComponent() {
      const ctx = useGameContext();
      return <span data-testid="screen">{ctx.screen}</span>;
    }

    const { getByTestId } = render(
      <GameProvider>
        <TestComponent />
      </GameProvider>,
    );

    // Default screen for unauthenticated user is "landing"
    expect(getByTestId("screen").textContent).toBe("landing");
  });
});
