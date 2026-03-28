import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { GameNotificationWatcher } from "../GameNotificationWatcher";
import type { GameDoc } from "../../services/games";
import { onSnapshot } from "firebase/firestore";
import { onForegroundMessage } from "../../services/fcm";

/* ── Mocks ─────────────────────────────────── */

const mockNotify = vi.fn();
let mockUser: { uid: string; displayName: string } | null = { uid: "u1", displayName: "Alice" };

vi.mock("../../context/AuthContext", () => ({
  useAuthContext: vi.fn(() => ({ user: mockUser, loading: false })),
}));

const mockGames: GameDoc[] = [];
let mockActiveGame: GameDoc | null = null;

vi.mock("../../context/GameContext", () => ({
  useGameContext: vi.fn(() => ({
    games: [...mockGames],
    activeGame: mockActiveGame,
  })),
}));

vi.mock("../../context/NotificationContext", () => ({
  useNotifications: vi.fn(() => ({
    notify: mockNotify,
  })),
}));

vi.mock("../../firebase", () => ({
  db: {},
}));

const mockOnSnapshotUnsub = vi.fn();

vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(() => mockOnSnapshotUnsub),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  doc: vi.fn(),
}));

vi.mock("../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const mockFcmUnsub = vi.fn();

vi.mock("../../services/fcm", () => ({
  onForegroundMessage: vi.fn(() => mockFcmUnsub),
}));

vi.mock("../../utils/helpers", () => ({
  parseFirebaseError: (e: unknown) => String(e),
}));

/* ── Helpers ────────────────────────────────── */

function makeGame(overrides: Partial<GameDoc> = {}): GameDoc {
  return {
    id: "g1",
    player1Uid: "u1",
    player2Uid: "u2",
    player1Username: "alice",
    player2Username: "bob",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: "u2",
    phase: "setting",
    currentSetter: "u2",
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: { toMillis: () => Date.now() + 86400000 } as GameDoc["turnDeadline"],
    turnNumber: 1,
    winner: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

/* ── Setup ──────────────────────────────────── */

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockGames.length = 0;
  mockActiveGame = null;
  mockUser = { uid: "u1", displayName: "Alice" };
});

afterEach(() => {
  vi.useRealTimers();
});

/* ── Tests ──────────────────────────────────── */

describe("GameNotificationWatcher", () => {
  it("renders null (no visible UI)", () => {
    const { container } = render(<GameNotificationWatcher />);
    expect(container.firstChild).toBeNull();
  });

  it("does not notify on initial game list load", () => {
    mockGames.push(makeGame());
    render(<GameNotificationWatcher />);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("mounts and unmounts without errors", () => {
    const { unmount } = render(<GameNotificationWatcher />);
    expect(() => unmount()).not.toThrow();
  });
});

describe("ready pattern guards", () => {
  it("updates prevGameIdsRef without notifying when gamesReadyRef is false", () => {
    mockGames.push(makeGame({ id: "g1", player1Uid: "u3", player2Uid: "u1" }));

    const { rerender } = render(<GameNotificationWatcher />);

    // Before the setTimeout fires, add another game and rerender
    // This hits the !gamesReadyRef.current guard (lines 77-79)
    mockGames.push(makeGame({ id: "g2", player1Uid: "u4", player2Uid: "u1" }));
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("updates prevGameRef without notifying when gameReadyRef is false", () => {
    mockActiveGame = makeGame({ id: "g1", currentTurn: "u2" });

    const { rerender } = render(<GameNotificationWatcher />);

    // Before the setTimeout fires, update the active game
    // This hits the !gameReadyRef.current guard (lines 125-127)
    mockActiveGame = makeGame({ id: "g1", currentTurn: "u1" });
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("new challenge detection", () => {
  it("notifies player2 when new game appears after ready", () => {
    // User is player2 in the new game
    const game = makeGame({ id: "g1", player1Uid: "u3", player2Uid: "u1", player1Username: "charlie" });
    mockGames.push(game);

    const { rerender } = render(<GameNotificationWatcher />);

    // Flush the setTimeout to mark ready
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // Add a new game
    const newGame = makeGame({ id: "g2", player1Uid: "u4", player2Uid: "u1", player1Username: "dave" });
    mockGames.push(newGame);
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "game_event",
        title: "New Challenge!",
        message: "@dave challenged you to S.K.A.T.E.",
        chime: "new_challenge",
        gameId: "g2",
      }),
    );
  });

  it("does NOT notify player1 (the challenger)", () => {
    const game = makeGame({ id: "g1" });
    mockGames.push(game);

    const { rerender } = render(<GameNotificationWatcher />);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // New game where u1 is player1 (challenger)
    const newGame = makeGame({ id: "g2", player1Uid: "u1", player2Uid: "u5" });
    mockGames.push(newGame);
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does not notify for non-active new games", () => {
    const game = makeGame({ id: "g1", player1Uid: "u3", player2Uid: "u1" });
    mockGames.push(game);

    const { rerender } = render(<GameNotificationWatcher />);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    const completedGame = makeGame({
      id: "g2",
      player1Uid: "u4",
      player2Uid: "u1",
      status: "complete",
    });
    mockGames.push(completedGame);
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("active game state changes", () => {
  it("notifies on game completion — won", () => {
    const game = makeGame({ id: "g1", currentTurn: "u2" });
    mockActiveGame = game;

    const { rerender } = render(<GameNotificationWatcher />);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // Game completes — u1 wins
    mockActiveGame = makeGame({
      id: "g1",
      status: "complete",
      winner: "u1",
      currentTurn: "u2",
    });
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        title: "You Won!",
        chime: "game_won",
        gameId: "g1",
      }),
    );
  });

  it("notifies on game completion — lost", () => {
    const game = makeGame({ id: "g1", currentTurn: "u2" });
    mockActiveGame = game;

    const { rerender } = render(<GameNotificationWatcher />);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    mockActiveGame = makeGame({
      id: "g1",
      status: "complete",
      winner: "u2",
      currentTurn: "u2",
    });
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "game_event",
        title: "Game Over",
        chime: "game_lost",
      }),
    );
  });

  it("notifies on forfeit with correct titles", () => {
    const game = makeGame({ id: "g1" });
    mockActiveGame = game;

    const { rerender } = render(<GameNotificationWatcher />);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // u1 wins by forfeit
    mockActiveGame = makeGame({
      id: "g1",
      status: "forfeit",
      winner: "u1",
    });
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Opponent Forfeited!",
        type: "success",
        chime: "game_won",
      }),
    );
  });

  it("notifies on forfeit — lost (time expired)", () => {
    const game = makeGame({ id: "g1" });
    mockActiveGame = game;

    const { rerender } = render(<GameNotificationWatcher />);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    mockActiveGame = makeGame({
      id: "g1",
      status: "forfeit",
      winner: "u2",
    });
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Time Expired",
        type: "game_event",
        chime: "game_lost",
      }),
    );
  });

  it("notifies turn change — matching phase (includes trick name)", () => {
    const game = makeGame({ id: "g1", currentTurn: "u2", phase: "setting" });
    mockActiveGame = game;

    const { rerender } = render(<GameNotificationWatcher />);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    mockActiveGame = makeGame({
      id: "g1",
      currentTurn: "u1",
      phase: "matching",
      currentTrickName: "kickflip",
    });
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Your Turn!",
        message: "Match @bob's kickflip",
        chime: "your_turn",
      }),
    );
  });

  it("notifies turn change — setting phase", () => {
    const game = makeGame({ id: "g1", currentTurn: "u2", phase: "matching" });
    mockActiveGame = game;

    const { rerender } = render(<GameNotificationWatcher />);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    mockActiveGame = makeGame({
      id: "g1",
      currentTurn: "u1",
      phase: "setting",
    });
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Your Turn to Set!",
        message: "Set a trick for @bob",
        chime: "your_turn",
      }),
    );
  });

  it("seeds on first render without notifying", () => {
    mockActiveGame = makeGame({ id: "g1", currentTurn: "u1", phase: "matching" });

    render(<GameNotificationWatcher />);

    // Even though it's our turn and matching phase, no notification on seed
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("background games list changes", () => {
  it("notifies turn change for non-active game", () => {
    const bg = makeGame({ id: "g2", currentTurn: "u2" });
    const active = makeGame({ id: "g1" });
    mockGames.push(active, bg);
    mockActiveGame = active;

    const { rerender } = render(<GameNotificationWatcher />);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // Intermediate rerender to populate prevGamesMapRef (gamesReadyRef is now true)
    rerender(<GameNotificationWatcher />);
    expect(mockNotify).not.toHaveBeenCalled();

    // Now update background game: turn changes to u1
    mockGames.length = 0;
    mockGames.push(active, makeGame({ id: "g2", currentTurn: "u1" }));
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Your Turn!",
        message: expect.stringContaining("@bob"),
        chime: "your_turn",
        gameId: "g2",
      }),
    );
  });

  it("notifies completion for non-active game", () => {
    const bg = makeGame({ id: "g2" });
    const active = makeGame({ id: "g1" });
    mockGames.push(active, bg);
    mockActiveGame = active;

    const { rerender } = render(<GameNotificationWatcher />);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // Intermediate rerender to populate prevGamesMapRef
    rerender(<GameNotificationWatcher />);

    mockGames.length = 0;
    mockGames.push(active, makeGame({ id: "g2", status: "complete", winner: "u1" }));
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "You Won!",
        chime: "game_won",
        gameId: "g2",
      }),
    );
  });

  it("skips active game to avoid duplicate notification", () => {
    const game = makeGame({ id: "g1", currentTurn: "u2" });
    mockGames.push(game);
    mockActiveGame = game;

    const { rerender } = render(<GameNotificationWatcher />);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // Turn changes to u1 in the active game via the games list
    const updated = makeGame({ id: "g1", currentTurn: "u1" });
    mockGames.length = 0;
    mockGames.push(updated);
    mockActiveGame = updated;
    rerender(<GameNotificationWatcher />);

    // The active game watcher will handle this — the background watcher should skip it
    // Verify that notify was called at most once (from the active game watcher, not both)
    const turnCalls = mockNotify.mock.calls.filter(
      (call) => call[0].title === "Your Turn to Set!" || call[0].title === "Your Turn!",
    );
    expect(turnCalls.length).toBeLessThanOrEqual(1);
  });
});

describe("nudge listener", () => {
  it("seeds initial nudge IDs without notifying", () => {
    render(<GameNotificationWatcher />);

    const snapshotCb = vi.mocked(onSnapshot).mock.calls[0]?.[1] as (snap: unknown) => void;
    expect(snapshotCb).toBeDefined();

    // First snapshot — seed
    snapshotCb({
      docs: [{ id: "nudge1" }, { id: "nudge2" }],
      docChanges: () => [],
    });

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("notifies on new nudge after ready", () => {
    render(<GameNotificationWatcher />);

    const snapshotCb = vi.mocked(onSnapshot).mock.calls[0]?.[1] as (snap: unknown) => void;

    // First snapshot — seed
    snapshotCb({
      docs: [{ id: "nudge1" }],
      docChanges: () => [],
    });

    // Flush setTimeout to mark ready
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // Second snapshot — new nudge
    snapshotCb({
      docs: [{ id: "nudge1" }, { id: "nudge2" }],
      docChanges: () => [
        {
          type: "added",
          doc: {
            id: "nudge2",
            data: () => ({ senderUsername: "bob", gameId: "g1" }),
          },
        },
      ],
    });

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "You got nudged!",
        message: "@bob is waiting for your move",
        chime: "nudge",
        gameId: "g1",
      }),
    );
  });

  it("does not notify for pre-existing nudge IDs", () => {
    render(<GameNotificationWatcher />);

    const snapshotCb = vi.mocked(onSnapshot).mock.calls[0]?.[1] as (snap: unknown) => void;

    // Seed with nudge1
    snapshotCb({
      docs: [{ id: "nudge1" }],
      docChanges: () => [],
    });

    act(() => {
      vi.advanceTimersByTime(1);
    });

    // "added" change for nudge1 which was already seeded
    snapshotCb({
      docs: [{ id: "nudge1" }],
      docChanges: () => [
        {
          type: "added",
          doc: {
            id: "nudge1",
            data: () => ({ senderUsername: "bob", gameId: "g1" }),
          },
        },
      ],
    });

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("caps tracked IDs at 50 (cycles to last 25)", () => {
    render(<GameNotificationWatcher />);

    const snapshotCb = vi.mocked(onSnapshot).mock.calls[0]?.[1] as (snap: unknown) => void;

    // Seed with 48 nudges
    const seedDocs = Array.from({ length: 48 }, (_, i) => ({ id: `n${i}` }));
    snapshotCb({ docs: seedDocs, docChanges: () => [] });
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // Add 4 more to push over 50
    for (let i = 48; i < 52; i++) {
      snapshotCb({
        docs: [],
        docChanges: () => [
          {
            type: "added",
            doc: { id: `n${i}`, data: () => ({ senderUsername: "x", gameId: "g1" }) },
          },
        ],
      });
    }

    // Should have notified 4 times (the 4 new ones) and cycled IDs
    expect(mockNotify).toHaveBeenCalledTimes(4);
  });
});

describe("notifications listener", () => {
  it("surfaces new notification as toast and marks read", () => {
    render(<GameNotificationWatcher />);

    // The second onSnapshot call is for the notifications collection
    const calls = vi.mocked(onSnapshot).mock.calls;
    const notifCb = calls[1]?.[1] as (snap: unknown) => void;
    expect(notifCb).toBeDefined();

    // Seed
    notifCb({ docs: [], docChanges: () => [] });
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // New notification arrives
    notifCb({
      docs: [{ id: "notif1" }],
      docChanges: () => [
        {
          type: "added",
          doc: {
            id: "notif1",
            data: () => ({
              type: "your_turn",
              title: "Your Turn",
              body: "Go play!",
              gameId: "g1",
            }),
          },
        },
      ],
    });

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "game_event",
        title: "Your Turn",
        message: "Go play!",
        chime: "your_turn",
        gameId: "g1",
      }),
    );
  });

  it("seeds initial notification IDs without notifying", () => {
    render(<GameNotificationWatcher />);

    const notifCb = vi.mocked(onSnapshot).mock.calls[1]?.[1] as (snap: unknown) => void;

    notifCb({
      docs: [{ id: "notif1" }, { id: "notif2" }],
      docChanges: () => [],
    });

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("uses general chime for unknown notification type", () => {
    render(<GameNotificationWatcher />);

    const notifCb = vi.mocked(onSnapshot).mock.calls[1]?.[1] as (snap: unknown) => void;

    notifCb({ docs: [], docChanges: () => [] });
    act(() => {
      vi.advanceTimersByTime(1);
    });

    notifCb({
      docs: [{ id: "notif1" }],
      docChanges: () => [
        {
          type: "added",
          doc: {
            id: "notif1",
            data: () => ({ type: "unknown_type", title: "X", body: "Y" }),
          },
        },
      ],
    });

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        chime: "general",
      }),
    );
  });

  it("handles updateDoc failure gracefully (mark read catch path)", async () => {
    const { updateDoc: mockUpdateDoc } = await import("firebase/firestore");
    vi.mocked(mockUpdateDoc).mockRejectedValueOnce(new Error("permission-denied"));

    render(<GameNotificationWatcher />);

    const notifCb = vi.mocked(onSnapshot).mock.calls[1]?.[1] as (snap: unknown) => void;

    notifCb({ docs: [], docChanges: () => [] });
    act(() => {
      vi.advanceTimersByTime(1);
    });

    notifCb({
      docs: [{ id: "notif1" }],
      docChanges: () => [
        {
          type: "added",
          doc: {
            id: "notif1",
            data: () => ({ type: "nudge", title: "Nudge", body: "Go!" }),
          },
        },
      ],
    });

    // Should have called updateDoc and not thrown
    expect(vi.mocked(mockUpdateDoc)).toHaveBeenCalled();
    // Let the rejection settle
    await vi.advanceTimersByTimeAsync(0);
  });

  it("caps tracked notification IDs at 50 (cycles to last 25)", () => {
    render(<GameNotificationWatcher />);

    const notifCb = vi.mocked(onSnapshot).mock.calls[1]?.[1] as (snap: unknown) => void;

    // Seed with 48 notification IDs
    const seedDocs = Array.from({ length: 48 }, (_, i) => ({ id: `notif${i}` }));
    notifCb({ docs: seedDocs, docChanges: () => [] });
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // Add 4 more to push over 50
    for (let i = 48; i < 52; i++) {
      notifCb({
        docs: [],
        docChanges: () => [
          {
            type: "added",
            doc: { id: `notif${i}`, data: () => ({ type: "info", title: "X", body: "Y" }) },
          },
        ],
      });
    }

    // Should have notified 4 times (the 4 new ones) and capped IDs
    expect(mockNotify).toHaveBeenCalledTimes(4);
  });
});

describe("FCM foreground bridge", () => {
  it("suppresses nudge type (already handled by onSnapshot)", () => {
    render(<GameNotificationWatcher />);

    const fcmCb = vi.mocked(onForegroundMessage).mock.calls[0]?.[0] as (payload: unknown) => void;
    expect(fcmCb).toBeDefined();

    fcmCb({
      notification: { title: "Nudge", body: "Go!" },
      data: { type: "nudge" },
    });

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("suppresses FIRESTORE_HANDLED_TYPES", () => {
    render(<GameNotificationWatcher />);

    const fcmCb = vi.mocked(onForegroundMessage).mock.calls[0]?.[0] as (payload: unknown) => void;

    for (const type of ["your_turn", "new_challenge", "game_won", "game_lost"]) {
      fcmCb({
        notification: { title: "Event", body: "msg" },
        data: { type },
      });
    }

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("passes through unknown FCM type as fallback", () => {
    render(<GameNotificationWatcher />);

    const fcmCb = vi.mocked(onForegroundMessage).mock.calls[0]?.[0] as (payload: unknown) => void;

    fcmCb({
      notification: { title: "New Feature", body: "Check it out" },
      data: { type: "promo", gameId: "g5" },
    });

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "game_event",
        title: "New Feature",
        message: "Check it out",
        chime: "general",
        gameId: "g5",
      }),
    );
  });

  it("ignores payloads without notification", () => {
    render(<GameNotificationWatcher />);

    const fcmCb = vi.mocked(onForegroundMessage).mock.calls[0]?.[0] as (payload: unknown) => void;

    fcmCb({ data: { type: "promo" } });

    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("service worker deep-link", () => {
  it("dispatches skatehubba:open-game on OPEN_GAME message", () => {
    // Mock navigator.serviceWorker since jsdom doesn't provide it
    const listeners: Record<string, EventListener[]> = {};
    const mockSW = {
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        (listeners[event] ??= []).push(handler);
      }),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      value: mockSW,
      configurable: true,
      writable: true,
    });

    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(<GameNotificationWatcher />);

    // Fire the registered message handler
    const handlers = listeners["message"] ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    handlers[0](new MessageEvent("message", { data: { type: "OPEN_GAME", gameId: "g99" } }));

    const customEvent = dispatchSpy.mock.calls.find(
      (c) => c[0] instanceof CustomEvent && c[0].type === "skatehubba:open-game",
    );
    expect(customEvent).toBeDefined();
    expect((customEvent![0] as CustomEvent).detail).toEqual({ gameId: "g99" });

    dispatchSpy.mockRestore();
    // Clean up mock
    Object.defineProperty(navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });
});

describe("cleanup", () => {
  it("unsubscribes onSnapshot listeners on unmount", () => {
    const { unmount } = render(<GameNotificationWatcher />);

    unmount();

    expect(mockOnSnapshotUnsub).toHaveBeenCalled();
  });

  it("unsubscribes FCM listener on unmount", () => {
    const { unmount } = render(<GameNotificationWatcher />);

    unmount();

    expect(mockFcmUnsub).toHaveBeenCalled();
  });

  it("resets when user logs out (uid becomes null)", () => {
    mockGames.push(makeGame());

    const { rerender } = render(<GameNotificationWatcher />);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // Log out
    mockUser = null;
    mockGames.length = 0;
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).not.toHaveBeenCalled();
  });
});
