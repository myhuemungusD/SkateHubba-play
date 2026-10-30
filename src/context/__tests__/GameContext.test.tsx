import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { Component, type ReactNode } from "react";
import { useGameContext } from "../GameContext";
import { AuthProvider } from "../AuthContext";
import { NavigationProvider } from "../NavigationContext";
import { NotificationProvider, useNotifications } from "../NotificationContext";
import { useNavigationContext } from "../NavigationContext";
import type { GameDoc } from "../../services/games";

const mockUseAuth = vi.fn();
// Inline single-line vi.mock for hooks/useAuth so the mock-setup block stays
// distinct from AuthContext.test.tsx's longer multi-mock block.
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("../../services/auth", () => ({
  signOut: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithApple: vi.fn(),
  resolveGoogleRedirect: vi.fn().mockResolvedValue(null),
  deleteAccount: vi.fn(),
}));
vi.mock("../../services/users", () => ({
  getUserProfile: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../services/blocking", () => ({ isUserBlocked: vi.fn().mockResolvedValue(false) }));
const mockSubscribeToMyGames = vi.fn();
const mockSubscribeToGame = vi.fn();
const mockForfeitExpiredTurn = vi.fn();
vi.mock("../../services/games", () => ({
  createGame: vi.fn(),
  timestampFromMillis: (ms: number) => ({ toMillis: () => ms }),
  forfeitExpiredTurn: (gameId: string, callerUid: string | null) => mockForfeitExpiredTurn(gameId, callerUid),
  subscribeToMyGames: (uid: string, cb: (games: GameDoc[]) => void, limit?: number) =>
    mockSubscribeToMyGames(uid, cb, limit),
  subscribeToGame: (gameId: string, cb: (g: GameDoc | null) => void, onAccessDenied?: () => void) =>
    mockSubscribeToGame(gameId, cb, onAccessDenied),
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
  mockSubscribeToGame.mockReturnValue(vi.fn());
  mockForfeitExpiredTurn.mockResolvedValue({ forfeited: false, winner: null });
}

/** Mounts `node` under the real Auth/Navigation/Notification/Game providers. */
async function renderInGameProviders(node: ReactNode) {
  const { GameProvider } = await import("../GameContext");
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AuthProvider>
        <NavigationProvider>
          <NotificationProvider uid="u1">
            <GameProvider>{node}</GameProvider>
          </NotificationProvider>
        </NavigationProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
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

  /** Signed-in u1 + a provider tree around a consumer that can open `game`. */
  async function renderOpenableGame(game: GameDoc) {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", emailVerified: true },
      profile: { uid: "u1", username: "sk8r" },
      refreshProfile: vi.fn(),
    });

    function Consumer() {
      const ctx = useGameContext();
      const { screen: current } = useNavigationContext();
      const { notifications } = useNotifications();
      return (
        <>
          <span data-testid="active-game">{ctx.activeGame?.id ?? "none"}</span>
          <span data-testid="screen">{current}</span>
          <span data-testid="toast">
            {notifications[0] ? `${notifications[0].type}: ${notifications[0].title}` : ""}
          </span>
          <button onClick={() => ctx.openGame(game)}>Open</button>
        </>
      );
    }

    await renderInGameProviders(<Consumer />);
    await userEvent.click(screen.getByText("Open"));
    expect(screen.getByTestId("active-game")).toHaveTextContent(game.id);
  }

  it("clears an open game when its document is authoritatively deleted", async () => {
    let gameUpdate: ((game: GameDoc | null) => void) | undefined;
    mockSubscribeToGame.mockImplementation((_id: string, cb: (game: GameDoc | null) => void) => {
      gameUpdate = cb;
      return vi.fn();
    });

    await renderOpenableGame({
      id: "deleted-game",
      status: "active",
      player1Uid: "u1",
      player2Uid: "u2",
      player1Username: "sk8r",
      player2Username: "rival",
    } as GameDoc);

    act(() => gameUpdate?.(null));
    expect(screen.getByTestId("active-game")).toHaveTextContent("none");
  });

  it("sends the user back to the lobby with an error toast when the game read is denied", async () => {
    let denyAccess: (() => void) | undefined;
    mockSubscribeToGame.mockImplementation((_id: string, _cb: unknown, onAccessDenied?: () => void) => {
      denyAccess = onAccessDenied;
      return vi.fn();
    });

    await renderOpenableGame({
      id: "forbidden-game",
      status: "active",
      player1Uid: "u2",
      player2Uid: "u3",
      player1Username: "rival",
      player2Username: "other",
    } as GameDoc);

    expect(screen.getByTestId("screen")).toHaveTextContent("game");
    expect(denyAccess).toBeTypeOf("function");

    act(() => denyAccess?.());

    expect(screen.getByTestId("active-game")).toHaveTextContent("none");
    expect(screen.getByTestId("screen")).toHaveTextContent("lobby");
    expect(screen.getByTestId("toast")).toHaveTextContent("error: You can't open that game");
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
    return renderInGameProviders(<span />);
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

    expect(mockForfeitExpiredTurn).toHaveBeenCalledWith("g1", "u1");
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

describe("GameProvider actions", () => {
  type Ctx = ReturnType<typeof useGameContext>;
  const live: { ctx: Ctx | null } = { ctx: null };

  beforeEach(() => {
    resetMocks();
    live.ctx = null;
    mockUseAuth.mockReturnValue({
      loading: false,
      user: { uid: "u1", emailVerified: true },
      profile: { uid: "u1", username: "sk8r", isVerifiedPro: false },
      refreshProfile: vi.fn(),
    });
  });

  async function mountActions() {
    function Probe() {
      const ctx = useGameContext();
      live.ctx = ctx;
      const { screen: where } = useNavigationContext();
      const { notifications } = useNotifications();
      return (
        <>
          <span data-testid="where">{where}</span>
          <span data-testid="loading">{String(ctx.gamesLoading)}</span>
          <span data-testid="last-toast">{notifications[0]?.title ?? ""}</span>
        </>
      );
    }
    await renderInGameProviders(<Probe />);
  }

  it("opens a finished game straight on the game-over screen", async () => {
    await mountActions();
    act(() => live.ctx?.openGame({ id: "done", status: "forfeit" } as GameDoc));
    expect(screen.getByTestId("where")).toHaveTextContent("gameover");
    expect(live.ctx?.activeGame?.id).toBe("done");
  });

  it("loadMoreGames widens the subscription by a page and shows loading until it lands", async () => {
    let deliver: ((games: GameDoc[]) => void) | undefined;
    mockSubscribeToMyGames.mockImplementation((_uid: string, cb: (games: GameDoc[]) => void) => {
      deliver = cb;
      return vi.fn();
    });
    await mountActions();
    expect(mockSubscribeToMyGames).toHaveBeenLastCalledWith("u1", expect.any(Function), 20);

    act(() => live.ctx?.loadMoreGames());
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    expect(mockSubscribeToMyGames).toHaveBeenLastCalledWith("u1", expect.any(Function), 40);

    // A game with no deadline is neither swept nor scheduled.
    act(() => deliver?.([{ id: "g-no-deadline", status: "active" } as GameDoc]));
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(mockForfeitExpiredTurn).not.toHaveBeenCalled();
  });

  it("refuses to challenge a player when either side has blocked the other", async () => {
    const { isUserBlocked } = await import("../../services/blocking");
    const { createGame } = await import("../../services/games");
    vi.mocked(isUserBlocked).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await mountActions();

    await expect(live.ctx!.startChallenge("u2", "rival")).rejects.toThrow("Cannot challenge this player.");
    expect(createGame).not.toHaveBeenCalled();
  });

  it("binds the judge's real handle and forwards spot presence and turn length", async () => {
    const { getUserProfile } = await import("../../services/users");
    const { createGame } = await import("../../services/games");
    vi.mocked(getUserProfile).mockImplementation(async (uid: string) =>
      uid === "u2" ? ({ uid, username: "rival" } as never) : ({ uid, username: "realjudge" } as never),
    );
    vi.mocked(createGame).mockResolvedValue("game-77");
    await mountActions();

    await act(async () => {
      await live.ctx!.startChallenge("u2", "spoofed", {
        judgeUid: "j1",
        judgeUsername: "claimed",
        spotPresence: true,
        turnLengthHours: 72,
      });
    });

    expect(createGame).toHaveBeenCalledWith(
      "u1",
      "sk8r",
      "u2",
      "rival",
      expect.objectContaining({ judgeUid: "j1", judgeUsername: "realjudge", spotPresence: true, turnLengthHours: 72 }),
    );
    expect(screen.getByTestId("where")).toHaveTextContent("game");
    expect(screen.getByTestId("last-toast")).toHaveTextContent("Challenge sent to @rival");
  });

  it("drops a judge nomination whose profile has no handle", async () => {
    const { getUserProfile } = await import("../../services/users");
    const { createGame } = await import("../../services/games");
    vi.mocked(getUserProfile).mockImplementation(async (uid: string) =>
      uid === "u2" ? ({ uid, username: "rival" } as never) : null,
    );
    vi.mocked(createGame).mockResolvedValue("game-78");
    await mountActions();

    await act(async () => {
      await live.ctx!.startChallenge("u2", "rival", { judgeUid: "ghost", judgeUsername: "ghost" });
    });

    const opts = vi.mocked(createGame).mock.calls[0][4];
    expect(opts).toMatchObject({ judgeUid: null, judgeUsername: null });
    expect(opts).not.toHaveProperty("spotPresence");
    expect(opts).not.toHaveProperty("turnLengthHours");
  });
});
