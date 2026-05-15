import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Component, type ReactNode } from "react";
import { useGameContext } from "../GameContext";
import { AuthProvider } from "../AuthContext";
import { NavigationProvider } from "../NavigationContext";
import { NotificationProvider } from "../NotificationContext";
import * as usersService from "../../services/users";
import * as gamesService from "../../services/games";
import type { GameDoc } from "../../services/games";

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({
    loading: false,
    user: { uid: "alice-uid" },
    profile: { uid: "alice-uid", username: "alice", stance: "Regular" },
    refreshProfile: vi.fn(),
  }),
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
  forfeitExpiredTurn: vi.fn().mockResolvedValue(undefined),
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
  setUser: vi.fn(),
}));
vi.mock("../../lib/posthog", () => ({
  identify: vi.fn(),
  resetIdentity: vi.fn(),
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
      <MemoryRouter>
        <ErrorCatcher>
          <TestComponent />
        </ErrorCatcher>
      </MemoryRouter>,
    );

    expect(getByTestId("error").textContent).toBe("useGameContext must be used within GameProvider");
    spy.mockRestore();
  });

  it("returns context value when used inside GameProvider", async () => {
    const { GameProvider } = await import("../GameContext");

    function TestComponent() {
      const ctx = useGameContext();
      return <span data-testid="games">{ctx.games.length}</span>;
    }

    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <NavigationProvider>
            <NotificationProvider uid={null}>
              <GameProvider>
                <TestComponent />
              </GameProvider>
            </NotificationProvider>
          </NavigationProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(getByTestId("games").textContent).toBe("0");
  });
});

describe("GameProvider — opponent stats catch-up fan-out", () => {
  type SubscribeCallback = (games: GameDoc[]) => void;

  // Hold onto the callback subscribeToMyGames was invoked with so each test
  // can drive its own emissions.
  let subscribeCallback: SubscribeCallback | null = null;

  beforeEach(() => {
    vi.mocked(usersService.updatePlayerStats).mockReset().mockResolvedValue(undefined);
    subscribeCallback = null;
    vi.mocked(gamesService.subscribeToMyGames).mockImplementation(((_uid: string, cb: SubscribeCallback) => {
      subscribeCallback = cb;
      return () => {};
    }) as unknown as typeof gamesService.subscribeToMyGames);
    vi.mocked(gamesService.subscribeToGame).mockImplementation((() =>
      () => {}) as unknown as typeof gamesService.subscribeToGame);
  });

  async function renderProvider(): Promise<void> {
    // Mirror the dynamic import used in the existing test above so the
    // module-level vi.mocks are honoured before GameProvider resolves.
    const { GameProvider } = await import("../GameContext");
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <MemoryRouter initialEntries={["/"]}>
          <AuthProvider>
            <NavigationProvider>
              <NotificationProvider uid="alice-uid">{children}</NotificationProvider>
            </NavigationProvider>
          </AuthProvider>
        </MemoryRouter>
      );
    }
    render(
      <Wrapper>
        <GameProvider>
          <span data-testid="ok">ok</span>
        </GameProvider>
      </Wrapper>,
    );
  }

  function makeFinishedGame(overrides: Partial<GameDoc> = {}): GameDoc {
    // Cast through unknown — we don't need every GameDoc field for this
    // catch-up code path; it touches id/status/winner/playerNUid only.
    return {
      id: "game-1",
      player1Uid: "alice-uid",
      player2Uid: "bob-uid",
      status: "complete",
      winner: "alice-uid",
      ...overrides,
    } as unknown as GameDoc;
  }

  it("fan-out: fires updatePlayerStats for BOTH self and opponent on a finished game", async () => {
    await renderProvider();
    expect(subscribeCallback).not.toBeNull();
    subscribeCallback!([makeFinishedGame()]);

    await waitFor(() => {
      expect(usersService.updatePlayerStats).toHaveBeenCalledTimes(2);
    });
    expect(usersService.updatePlayerStats).toHaveBeenCalledWith("alice-uid", "game-1", true);
    expect(usersService.updatePlayerStats).toHaveBeenCalledWith("bob-uid", "game-1", false);
  });

  it("isolation: self-write failure does not suppress the opponent-write attempt", async () => {
    vi.mocked(usersService.updatePlayerStats).mockImplementation(async (uid: string) => {
      if (uid === "alice-uid") throw new Error("self write rejected");
    });
    await renderProvider();
    subscribeCallback!([makeFinishedGame()]);

    await waitFor(() => {
      expect(usersService.updatePlayerStats).toHaveBeenCalledTimes(2);
    });
    // Both calls must have been issued — independent .catch() handlers
    // mean the rejection on the self call does not block the opp call.
    expect(usersService.updatePlayerStats).toHaveBeenCalledWith("alice-uid", "game-1", true);
    expect(usersService.updatePlayerStats).toHaveBeenCalledWith("bob-uid", "game-1", false);
  });

  it("idempotency: re-emission of the same finished game does not double-fire either write", async () => {
    await renderProvider();
    const game = makeFinishedGame();
    subscribeCallback!([game]);
    await waitFor(() => {
      expect(usersService.updatePlayerStats).toHaveBeenCalledTimes(2);
    });
    // Re-emit the same game (e.g. another snapshot ticked while still
    // mounted). processedStatsRef must keep the count at two.
    subscribeCallback!([game]);
    subscribeCallback!([game]);
    // Give microtasks a chance to flush.
    await Promise.resolve();
    expect(usersService.updatePlayerStats).toHaveBeenCalledTimes(2);
  });
});
