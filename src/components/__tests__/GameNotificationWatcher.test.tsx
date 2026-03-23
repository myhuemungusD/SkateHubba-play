import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { GameNotificationWatcher } from "../GameNotificationWatcher";
import type { GameDoc } from "../../services/games";

const mockNotify = vi.fn();
const mockUser = { uid: "u1", displayName: "Alice" };

vi.mock("../../context/AuthContext", () => ({
  useAuthContext: vi.fn(() => ({ user: mockUser, loading: false })),
}));

const mockGames: GameDoc[] = [];
let mockActiveGame: GameDoc | null = null;

vi.mock("../../context/GameContext", () => ({
  useGameContext: vi.fn(() => ({
    games: mockGames,
    activeGame: mockActiveGame,
  })),
}));

vi.mock("../../context/NotificationContext", () => ({
  useNotifications: vi.fn(() => ({
    notify: mockNotify,
  })),
}));

vi.mock("../../firebase", () => ({
  db: null,
}));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()),
  updateDoc: vi.fn(),
  doc: vi.fn(),
}));

vi.mock("../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("../../services/fcm", () => ({
  onForegroundMessage: vi.fn(() => vi.fn()),
}));

vi.mock("../../utils/helpers", () => ({
  parseFirebaseError: (e: unknown) => String(e),
}));

describe("GameNotificationWatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGames.length = 0;
    mockActiveGame = null;
  });

  it("renders null (no visible UI)", () => {
    const { container } = render(<GameNotificationWatcher />);
    expect(container.firstChild).toBeNull();
  });

  it("does not notify on initial game list load", () => {
    const game: GameDoc = {
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
    };
    mockGames.push(game);

    render(<GameNotificationWatcher />);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("mounts and unmounts without errors", () => {
    const { unmount } = render(<GameNotificationWatcher />);
    expect(() => unmount()).not.toThrow();
  });
});
