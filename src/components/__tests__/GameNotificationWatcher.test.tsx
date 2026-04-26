import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { GameNotificationWatcher, OPEN_GAME_EVENT } from "../GameNotificationWatcher";
import type { GameDoc } from "../../services/games";
import { onForegroundMessage } from "../../services/fcm";
import { subscribeToNudges, subscribeToNotifications } from "../../services/notifications";

/* ── Mocks ─────────────────────────────────── */

const mockNotify = vi.fn();
let mockUser: { uid: string; displayName: string } | null = { uid: "u1", displayName: "Alice" };

const mockActiveProfile = { uid: "u1", username: "alice", stance: "Regular", createdAt: null, emailVerified: true };

vi.mock("../../context/AuthContext", () => ({
  useAuthContext: vi.fn(() => ({ user: mockUser, activeProfile: mockUser ? mockActiveProfile : null, loading: false })),
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
  useNotifications: vi.fn(() => ({ notify: mockNotify })),
}));

const mockNudgeUnsub = vi.fn();
const mockNotifUnsub = vi.fn();

vi.mock("../../services/notifications", () => ({
  subscribeToNudges: vi.fn(() => mockNudgeUnsub),
  subscribeToNotifications: vi.fn(() => mockNotifUnsub),
}));

const mockFcmUnsub = vi.fn();

vi.mock("../../services/fcm", () => ({
  onForegroundMessage: vi.fn(() => mockFcmUnsub),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGames.length = 0;
  mockActiveGame = null;
  mockUser = { uid: "u1", displayName: "Alice" };
});

afterEach(() => {
  // Reset any navigator.serviceWorker stubs from individual tests.
  Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true, writable: true });
});

/* ── Smoke ──────────────────────────────────── */

describe("GameNotificationWatcher", () => {
  it("renders null", () => {
    const { container } = render(<GameNotificationWatcher />);
    expect(container.firstChild).toBeNull();
  });

  it("does not toast on initial games snapshot (seed only)", () => {
    mockGames.push(makeGame({ status: "active" }), makeGame({ id: "g2", status: "forfeit", winner: "u1" }));
    render(<GameNotificationWatcher />);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does not subscribe to /nudges or /notifications when activeProfile is null", async () => {
    mockUser = { uid: "u1", displayName: "Alice" };
    const { useAuthContext } = await import("../../context/AuthContext");
    vi.mocked(useAuthContext).mockReturnValueOnce({
      user: mockUser,
      activeProfile: null,
      loading: false,
    } as ReturnType<typeof useAuthContext>);
    render(<GameNotificationWatcher />);
    expect(vi.mocked(subscribeToNudges)).not.toHaveBeenCalled();
    expect(vi.mocked(subscribeToNotifications)).not.toHaveBeenCalled();
  });
});

/* ── /notifications listener (canonical source) ─ */

describe("notifications collection listener", () => {
  it("subscribes with the user uid", () => {
    render(<GameNotificationWatcher />);
    expect(vi.mocked(subscribeToNotifications)).toHaveBeenCalledWith("u1", expect.any(Function));
  });

  it.each([
    ["your_turn", "your_turn"],
    ["new_challenge", "new_challenge"],
    ["game_won", "game_won"],
    ["game_lost", "game_lost"],
    ["judge_invite", "general"],
    ["unknown_future_type", "general"],
  ])("maps type %s → chime %s", (type, expectedChime) => {
    render(<GameNotificationWatcher />);
    const cb = vi.mocked(subscribeToNotifications).mock.calls[0]?.[1];
    cb!({ firestoreId: "fs1", type, title: "T", body: "B", gameId: "g1" });

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "game_event",
        title: "T",
        message: "B",
        chime: expectedChime,
        gameId: "g1",
        firestoreId: "fs1",
      }),
    );
  });
});

/* ── /nudges listener ───────────────────────── */

describe("nudge listener", () => {
  it("subscribes with the user uid", () => {
    render(<GameNotificationWatcher />);
    expect(vi.mocked(subscribeToNudges)).toHaveBeenCalledWith("u1", expect.any(Function));
  });

  it("notifies with a nudge chime + sender username", () => {
    render(<GameNotificationWatcher />);
    const cb = vi.mocked(subscribeToNudges).mock.calls[0]?.[1];
    cb!({ senderUsername: "bob", gameId: "g1" });

    expect(mockNotify).toHaveBeenCalledWith({
      type: "game_event",
      title: "You got nudged!",
      message: "@bob is waiting for your move",
      chime: "nudge",
      gameId: "g1",
    });
  });
});

/* ── Forfeit fallback (the only games-diff path) ─ */

describe("forfeit fallback watcher", () => {
  it("notifies winner with 'Opponent Forfeited!' when active game flips to forfeit", () => {
    mockActiveGame = makeGame({ id: "g1", status: "active" });
    const { rerender } = render(<GameNotificationWatcher />);
    expect(mockNotify).not.toHaveBeenCalled();

    mockActiveGame = makeGame({ id: "g1", status: "forfeit", winner: "u1" });
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledWith({
      type: "success",
      title: "Opponent Forfeited!",
      message: "vs @bob",
      chime: "game_won",
      gameId: "g1",
    });
  });

  it("notifies loser with 'Time Expired' when active game flips to forfeit", () => {
    mockActiveGame = makeGame({ id: "g1", status: "active" });
    const { rerender } = render(<GameNotificationWatcher />);

    mockActiveGame = makeGame({ id: "g1", status: "forfeit", winner: "u2" });
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledWith({
      type: "game_event",
      title: "Time Expired",
      message: "vs @bob",
      chime: "game_lost",
      gameId: "g1",
    });
  });

  it("uses player1's username when the viewer is player2", () => {
    mockActiveGame = makeGame({
      id: "g1",
      status: "active",
      player1Uid: "u2",
      player1Username: "bob",
      player2Uid: "u1",
      player2Username: "alice",
    });
    const { rerender } = render(<GameNotificationWatcher />);

    mockActiveGame = makeGame({
      id: "g1",
      status: "forfeit",
      winner: "u1",
      player1Uid: "u2",
      player1Username: "bob",
      player2Uid: "u1",
      player2Username: "alice",
    });
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ message: "vs @bob" }));
  });

  it("notifies for a background game (in list, not active)", () => {
    mockGames.push(makeGame({ id: "g1", status: "active" }));
    const { rerender } = render(<GameNotificationWatcher />);

    mockGames.length = 0;
    mockGames.push(makeGame({ id: "g1", status: "forfeit", winner: "u1" }));
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ title: "Opponent Forfeited!", gameId: "g1" }));
  });

  it("dedups across activeGame + games list — fires once per gameId", () => {
    const active = makeGame({ id: "g1", status: "active" });
    mockActiveGame = active;
    mockGames.push(active);
    const { rerender } = render(<GameNotificationWatcher />);

    const forfeited = makeGame({ id: "g1", status: "forfeit", winner: "u1" });
    mockActiveGame = forfeited;
    mockGames.length = 0;
    mockGames.push(forfeited);
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it("does not re-fire on subsequent renders of the same forfeit", () => {
    mockActiveGame = makeGame({ id: "g1", status: "active" });
    const { rerender } = render(<GameNotificationWatcher />);

    mockActiveGame = makeGame({ id: "g1", status: "forfeit", winner: "u1" });
    rerender(<GameNotificationWatcher />);
    rerender(<GameNotificationWatcher />);
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it("does not toast for a game that was already forfeit on first render", () => {
    mockGames.push(makeGame({ id: "g1", status: "forfeit", winner: "u1" }));
    const { rerender } = render(<GameNotificationWatcher />);
    rerender(<GameNotificationWatcher />);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does not toast for status=complete — that path is handled by /notifications", () => {
    mockActiveGame = makeGame({ id: "g1", status: "active" });
    const { rerender } = render(<GameNotificationWatcher />);

    mockActiveGame = makeGame({ id: "g1", status: "complete", winner: "u1" });
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("clears state when user logs out", () => {
    mockActiveGame = makeGame({ id: "g1", status: "active" });
    const { rerender } = render(<GameNotificationWatcher />);

    mockUser = null;
    mockActiveGame = null;
    mockGames.length = 0;
    rerender(<GameNotificationWatcher />);

    // Log back in with a stale "active" game and then forfeit it — the
    // post-logout reset must allow this to fire even though gameId reused.
    mockUser = { uid: "u1", displayName: "Alice" };
    mockActiveGame = makeGame({ id: "g1", status: "active" });
    rerender(<GameNotificationWatcher />);

    mockActiveGame = makeGame({ id: "g1", status: "forfeit", winner: "u1" });
    rerender(<GameNotificationWatcher />);

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ gameId: "g1" }));
  });
});

/* ── FCM foreground bridge ──────────────────── */

describe("FCM foreground bridge", () => {
  it.each(["nudge", "your_turn", "new_challenge", "game_won", "game_lost", "judge_invite"])(
    "suppresses Firestore-handled type %s",
    (type) => {
      render(<GameNotificationWatcher />);
      const cb = vi.mocked(onForegroundMessage).mock.calls[0]?.[0];
      cb!({ notification: { title: "x", body: "y" }, data: { type } });
      expect(mockNotify).not.toHaveBeenCalled();
    },
  );

  it("passes through unknown types as a 'general' fallback", () => {
    render(<GameNotificationWatcher />);
    const cb = vi.mocked(onForegroundMessage).mock.calls[0]?.[0];
    cb!({ notification: { title: "Promo", body: "msg" }, data: { type: "tournament_invite", gameId: "g5" } });

    expect(mockNotify).toHaveBeenCalledWith({
      type: "game_event",
      title: "Promo",
      message: "msg",
      chime: "general",
      gameId: "g5",
    });
  });

  it("ignores payloads without a notification block", () => {
    render(<GameNotificationWatcher />);
    const cb = vi.mocked(onForegroundMessage).mock.calls[0]?.[0];
    cb!({ data: { type: "promo" } });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("treats a missing data block as an unknown type and falls through", () => {
    render(<GameNotificationWatcher />);
    const cb = vi.mocked(onForegroundMessage).mock.calls[0]?.[0];
    cb!({ notification: { title: "x", body: "y" } });
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ chime: "general" }));
  });

  it("uses fallback title/message when fields are missing", () => {
    render(<GameNotificationWatcher />);
    const cb = vi.mocked(onForegroundMessage).mock.calls[0]?.[0];
    cb!({ notification: {}, data: { type: "promo" } });
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ title: "SkateHubba", message: "" }));
  });
});

/* ── Service worker deep-link ───────────────── */

describe("service worker deep-link bridge", () => {
  function stubServiceWorker(controller: unknown = null) {
    const listeners: Record<string, EventListener[]> = {};
    const sw = {
      controller,
      addEventListener: vi.fn((event: string, h: EventListener) => {
        (listeners[event] ??= []).push(h);
      }),
      removeEventListener: vi.fn((event: string, h: EventListener) => {
        listeners[event] = (listeners[event] ?? []).filter((x) => x !== h);
      }),
    };
    Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true, writable: true });
    return { sw, listeners };
  }

  it("dispatches OPEN_GAME_EVENT for a valid OPEN_GAME message", () => {
    const { listeners } = stubServiceWorker();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(<GameNotificationWatcher />);
    listeners["message"][0](new MessageEvent("message", { data: { type: "OPEN_GAME", gameId: "g99" } }));

    const ev = dispatchSpy.mock.calls.find((c) => c[0] instanceof CustomEvent && c[0].type === OPEN_GAME_EVENT);
    expect(ev).toBeDefined();
    expect((ev![0] as CustomEvent).detail).toEqual({ gameId: "g99" });
  });

  it("ignores messages with a non-OPEN_GAME type", () => {
    const { listeners } = stubServiceWorker();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(<GameNotificationWatcher />);
    listeners["message"][0](new MessageEvent("message", { data: { type: "OTHER", gameId: "g1" } }));

    expect(
      dispatchSpy.mock.calls.find((c) => c[0] instanceof CustomEvent && c[0].type === OPEN_GAME_EVENT),
    ).toBeUndefined();
  });

  it("ignores messages with missing/empty gameId", () => {
    const { listeners } = stubServiceWorker();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(<GameNotificationWatcher />);
    listeners["message"][0](new MessageEvent("message", { data: { type: "OPEN_GAME" } }));
    listeners["message"][0](new MessageEvent("message", { data: { type: "OPEN_GAME", gameId: "" } }));
    listeners["message"][0](new MessageEvent("message", { data: { type: "OPEN_GAME", gameId: 42 } }));

    expect(
      dispatchSpy.mock.calls.find((c) => c[0] instanceof CustomEvent && c[0].type === OPEN_GAME_EVENT),
    ).toBeUndefined();
  });

  it("ignores messages whose source is not the controlling SW", () => {
    const controller = { id: "trusted-sw" };
    const { listeners } = stubServiceWorker(controller);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(<GameNotificationWatcher />);
    const evt = new MessageEvent("message", {
      data: { type: "OPEN_GAME", gameId: "g99" },
      source: { id: "spoofed" } as unknown as Window,
    });
    listeners["message"][0](evt);

    expect(
      dispatchSpy.mock.calls.find((c) => c[0] instanceof CustomEvent && c[0].type === OPEN_GAME_EVENT),
    ).toBeUndefined();
  });

  it("no-ops when navigator.serviceWorker is undefined", () => {
    Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true, writable: true });
    expect(() => render(<GameNotificationWatcher />)).not.toThrow();
  });
});

/* ── Cleanup ────────────────────────────────── */

describe("cleanup", () => {
  it("unsubscribes nudge, notifications, and FCM listeners on unmount", () => {
    const { unmount } = render(<GameNotificationWatcher />);
    unmount();
    expect(mockNudgeUnsub).toHaveBeenCalled();
    expect(mockNotifUnsub).toHaveBeenCalled();
    expect(mockFcmUnsub).toHaveBeenCalled();
  });

  it("removes the service worker message listener on unmount", () => {
    const listeners: Record<string, EventListener[]> = {};
    const sw = {
      controller: null,
      addEventListener: vi.fn((event: string, h: EventListener) => {
        (listeners[event] ??= []).push(h);
      }),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true, writable: true });

    const { unmount } = render(<GameNotificationWatcher />);
    unmount();
    expect(sw.removeEventListener).toHaveBeenCalledWith("message", expect.any(Function));
  });
});
