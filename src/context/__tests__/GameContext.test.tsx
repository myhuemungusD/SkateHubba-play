import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Component, type ReactNode } from "react";
import { useGameContext } from "../GameContext";
import { AuthProvider } from "../AuthContext";
import { NavigationProvider } from "../NavigationContext";
import { NotificationProvider } from "../NotificationContext";
import type { GameDoc } from "../../services/games";

const mockUseAuth = vi.fn();
// Inline single-line vi.mock for hooks/useAuth so the mock-setup block stays
// distinct from AuthContext.test.tsx's longer multi-mock block.
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("../../services/auth", () => ({
  signOut: vi.fn(),
  signInWithGoogle: vi.fn(),
  resolveGoogleRedirect: vi.fn().mockResolvedValue(null),
  deleteAccount: vi.fn(),
}));
vi.mock("../../services/users", () => ({
  deleteUserData: vi.fn(),
  updatePlayerStats: vi.fn().mockResolvedValue(undefined),
  getUserProfile: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../services/blocking", () => ({ isUserBlocked: vi.fn().mockResolvedValue(false) }));
const mockSubscribeToMyGames = vi.fn();
const mockForfeitExpiredTurn = vi.fn();
vi.mock("../../services/games", () => ({
  createGame: vi.fn(),
  forfeitExpiredTurn: (gameId: string) => mockForfeitExpiredTurn(gameId),
  subscribeToMyGames: (uid: string, cb: (games: GameDoc[]) => void, limit?: number) =>
    mockSubscribeToMyGames(uid, cb, limit),
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

/**
 * Default mock baseline used by every test below. Each describe block can
 * override individual mocks in its own beforeEach hook.
 */
function resetMocks(): void {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
  mockSubscribeToMyGames.mockReturnValue(vi.fn());
  mockForfeitExpiredTurn.mockResolvedValue({ forfeited: false, winner: null });
}

describe("useGameContext", () => {
  beforeEach(resetMocks);

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

describe("GameProvider auto-forfeit sweep", () => {
  type GameSubCallback = (games: GameDoc[]) => void;
  let snapshotCb: GameSubCallback | null = null;

  beforeEach(() => {
    resetMocks();
    vi.useFakeTimers();
    mockUseAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", emailVerified: true } as { uid: string; emailVerified: boolean },
      profile: { uid: "u1", username: "sk8r", isVerifiedPro: false },
      refreshProfile: vi.fn(),
    });
    snapshotCb = null;
    mockSubscribeToMyGames.mockImplementation((_uid: string, cb: GameSubCallback) => {
      snapshotCb = cb;
      return vi.fn();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeGame(overrides: Partial<GameDoc> & { deadlineMs: number; id: string }): GameDoc {
    const { deadlineMs, id, ...rest } = overrides;
    return {
      id,
      player1Uid: "u1",
      player2Uid: "u2",
      player1Username: "sk8r",
      player2Username: "rival",
      status: "active",
      phase: "setting",
      currentTurn: "u2",
      currentSetter: "u2",
      turnNumber: 1,
      p1Letters: 0,
      p2Letters: 0,
      winner: null,
      turnDeadline: { toMillis: () => deadlineMs } as GameDoc["turnDeadline"],
      currentTrickName: null,
      currentTrickVideoUrl: null,
      matchVideoUrl: null,
      ...rest,
    } as GameDoc;
  }

  async function renderWithProvider() {
    const { GameProvider } = await import("../GameContext");
    return render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <NavigationProvider>
            <NotificationProvider uid="u1">
              <GameProvider>
                <span />
              </GameProvider>
            </NotificationProvider>
          </NavigationProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it("fires forfeitExpiredTurn from the timer when a future deadline elapses", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await renderWithProvider();
    expect(snapshotCb).not.toBeNull();

    // Snapshot delivers ONE game whose deadline is 60s in the future.
    const futureDeadline = Date.now() + 60_000;
    act(() => {
      snapshotCb!([makeGame({ id: "g1", deadlineMs: futureDeadline })]);
    });

    // Snapshot delivery is not expired yet → no sweep fired.
    expect(mockForfeitExpiredTurn).not.toHaveBeenCalled();

    // Advance past the deadline + 1s buffer → timer fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_500);
    });

    expect(mockForfeitExpiredTurn).toHaveBeenCalledWith("g1");
    expect(mockForfeitExpiredTurn).toHaveBeenCalledTimes(1);
  });

  it("does not double-fire when both snapshot and timer would trigger", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await renderWithProvider();

    // Snapshot delivers an already-expired game → sweep fires immediately.
    act(() => {
      snapshotCb!([makeGame({ id: "g1", deadlineMs: Date.now() - 1000 })]);
    });
    expect(mockForfeitExpiredTurn).toHaveBeenCalledTimes(1);

    // Drain any timers the effect might have scheduled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // forfeitAttemptedRef prevents a second call for the same gameId.
    expect(mockForfeitExpiredTurn).toHaveBeenCalledTimes(1);
  });
});
