import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ────────────────── */
const {
  mockAddDoc,
  mockSetDoc,
  mockRunTransaction,
  mockOnSnapshot,
  mockDoc,
  mockCollection,
  mockQuery,
  mockWhere,
  mockLimit,
  mockOrderBy,
  mockTxGet,
  mockTxUpdate,
} = vi.hoisted(() => ({
  mockAddDoc: vi.fn(),
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockRunTransaction: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockDoc: vi.fn((...args: any[]) => args.slice(1).join("/")),
  mockCollection: vi.fn((...args: any[]) => args[1]),
  mockQuery: vi.fn((...args: any[]) => args),
  mockWhere: vi.fn((...args: any[]) => args),
  mockLimit: vi.fn((...args: any[]) => args),
  mockOrderBy: vi.fn((...args: any[]) => args),
  mockTxGet: vi.fn(),
  mockTxUpdate: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: mockCollection,
  doc: mockDoc,
  addDoc: mockAddDoc,
  setDoc: mockSetDoc,
  runTransaction: mockRunTransaction,
  query: mockQuery,
  where: mockWhere,
  limit: mockLimit,
  orderBy: mockOrderBy,
  onSnapshot: mockOnSnapshot,
  serverTimestamp: () => "SERVER_TS",
  arrayUnion: (...elements: unknown[]) => ({ _arrayUnion: elements }),
  Timestamp: {
    fromMillis: (ms: number) => ({ _ms: ms, toMillis: () => ms }),
  },
}));

vi.mock("../../firebase");

import {
  createGame,
  _resetCreateGameRateLimit,
  setTrick,
  failSetTrick,
  submitMatchAttempt,
  submitConfirmation,
  forfeitExpiredTurn,
  subscribeToGame,
  subscribeToMyGames,
} from "../games";

beforeEach(() => {
  vi.clearAllMocks();
  _resetCreateGameRateLimit();
  // Default: runTransaction calls the callback with a mock tx object
  mockRunTransaction.mockImplementation(async (_db: unknown, cb: Function) => {
    const tx = { get: mockTxGet, update: mockTxUpdate, set: vi.fn() };
    return cb(tx);
  });
});

/* ── Helpers ────────────────────────────────── */

function makeGameSnap(data: Record<string, unknown>, id = "g1") {
  return {
    exists: () => true,
    id,
    data: () => data,
  };
}

function makeNotFoundSnap() {
  return { exists: () => false };
}

const baseGame = {
  player1Uid: "p1",
  player2Uid: "p2",
  player1Username: "alice",
  player2Username: "bob",
  p1Letters: 0,
  p2Letters: 0,
  status: "active",
  currentTurn: "p1",
  phase: "setting",
  currentSetter: "p1",
  currentTrickName: null,
  currentTrickVideoUrl: null,
  matchVideoUrl: null,
  setterConfirm: null,
  matcherConfirm: null,
  turnNumber: 1,
  winner: null,
};

/* ── Tests ──────────────────────────────────── */

describe("games service", () => {
  describe("createGame", () => {
    it("creates a game doc and returns its id", async () => {
      mockAddDoc.mockResolvedValueOnce({ id: "game123" });
      const id = await createGame("p1", "alice", "p2", "bob");
      expect(id).toBe("game123");
      expect(mockAddDoc).toHaveBeenCalledTimes(1);

      const docData = mockAddDoc.mock.calls[0][1];
      expect(docData.player1Uid).toBe("p1");
      expect(docData.player2Uid).toBe("p2");
      expect(docData.status).toBe("active");
      expect(docData.phase).toBe("setting");
      expect(docData.currentSetter).toBe("p1");
    });

    it("throws when called again within the cooldown period", async () => {
      mockAddDoc.mockResolvedValueOnce({ id: "game1" });
      await createGame("p1", "alice", "p2", "bob");

      // Second call without resetting — should hit rate limit
      await expect(createGame("p1", "alice", "p2", "bob")).rejects.toThrow("Please wait before creating another game");
    });

    it("sets initial scores, turn, and timestamps", async () => {
      mockAddDoc.mockResolvedValueOnce({ id: "g1" });
      await createGame("p1", "alice", "p2", "bob");

      const docData = mockAddDoc.mock.calls[0][1];
      expect(docData.p1Letters).toBe(0);
      expect(docData.p2Letters).toBe(0);
      expect(docData.turnNumber).toBe(1);
      expect(docData.currentTurn).toBe("p1");
      expect(docData.winner).toBeNull();
      expect(docData.currentTrickName).toBeNull();
      expect(docData.turnDeadline).toBeDefined();
      expect(docData.createdAt).toBe("SERVER_TS");
      expect(docData.updatedAt).toBe("SERVER_TS");
    });

    it("updates lastGameCreatedAt on user profile (best effort)", async () => {
      mockAddDoc.mockResolvedValueOnce({ id: "g1" });
      await createGame("p1", "alice", "p2", "bob");
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
    });

    it("still returns game id if rate-limit timestamp update fails", async () => {
      mockAddDoc.mockResolvedValueOnce({ id: "g1" });
      mockSetDoc.mockRejectedValueOnce(new Error("write failed"));
      const id = await createGame("p1", "alice", "p2", "bob");
      expect(id).toBe("g1");
    });
  });

  describe("setTrick", () => {
    it("transitions the game from setting to matching phase", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));

      await setTrick("g1", "Kickflip", "https://vid.url");

      expect(mockTxUpdate).toHaveBeenCalledTimes(1);
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("matching");
      expect(updates.currentTrickName).toBe("Kickflip");
      expect(updates.currentTurn).toBe("p2"); // matcher
    });

    it("sets null video URL when no video recorded", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));

      await setTrick("g1", "Manual", null);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.currentTrickVideoUrl).toBeNull();
      expect(updates.matchVideoUrl).toBeNull();
    });

    it("assigns p1 as matcher when p2 is the setter", async () => {
      mockTxGet.mockResolvedValueOnce(
        makeGameSnap({ ...baseGame, phase: "setting", currentSetter: "p2", currentTurn: "p2" }),
      );

      await setTrick("g1", "Tre Flip", null);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.currentTurn).toBe("p1");
    });

    it("throws when trick name is empty after trimming", async () => {
      await expect(setTrick("g1", "   ", null)).rejects.toThrow("Trick name cannot be empty");
    });

    it("throws when game is not in setting phase", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "matching" }));
      await expect(setTrick("g1", "Kickflip", null)).rejects.toThrow("Not in setting phase");
    });

    it("throws when game is already over", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, status: "complete", phase: "setting" }));
      await expect(setTrick("g1", "Kickflip", null)).rejects.toThrow("Game is already over");
    });

    it("throws when game is not found", async () => {
      mockTxGet.mockResolvedValueOnce(makeNotFoundSnap());
      await expect(setTrick("g1", "Kickflip", null)).rejects.toThrow("Game not found");
    });

    it("throws when game document is malformed (missing required fields)", async () => {
      // toGameDoc validates player1Uid, player2Uid, and status are strings
      const malformedSnap = {
        exists: () => true,
        id: "bad-doc",
        data: () => ({ phase: "setting" }), // missing player1Uid, player2Uid, status
      };
      mockTxGet.mockResolvedValueOnce(malformedSnap);
      await expect(setTrick("bad-doc", "Kickflip", null)).rejects.toThrow("Malformed game document: bad-doc");
    });
  });

  describe("failSetTrick", () => {
    it("switches setter to opponent and stays in setting phase", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting", currentSetter: "p1" }));

      await failSetTrick("g1");

      expect(mockTxUpdate).toHaveBeenCalledTimes(1);
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("setting");
      expect(updates.currentSetter).toBe("p2");
      expect(updates.currentTurn).toBe("p2");
      expect(updates.currentTrickName).toBeNull();
      expect(updates.currentTrickVideoUrl).toBeNull();
      expect(updates.matchVideoUrl).toBeNull();
      expect(updates.turnNumber).toBe(2);
    });

    it("switches setter from p2 to p1", async () => {
      mockTxGet.mockResolvedValueOnce(
        makeGameSnap({ ...baseGame, phase: "setting", currentSetter: "p2", currentTurn: "p2" }),
      );

      await failSetTrick("g1");

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.currentSetter).toBe("p1");
      expect(updates.currentTurn).toBe("p1");
    });

    it("throws when game is not found", async () => {
      mockTxGet.mockResolvedValueOnce(makeNotFoundSnap());
      await expect(failSetTrick("g1")).rejects.toThrow("Game not found");
    });

    it("throws when game is already over", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, status: "complete", phase: "setting" }));
      await expect(failSetTrick("g1")).rejects.toThrow("Game is already over");
    });

    it("throws when not in setting phase", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "matching" }));
      await expect(failSetTrick("g1")).rejects.toThrow("Not in setting phase");
    });
  });

  describe("submitMatchAttempt", () => {
    it("transitions to confirming phase with match video URL and turn to setter", async () => {
      const game = { ...baseGame, phase: "matching", currentSetter: "p1", currentTurn: "p2" };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      await submitMatchAttempt("g1", "https://cdn.example.com/match.webm");

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("confirming");
      expect(updates.matchVideoUrl).toBe("https://cdn.example.com/match.webm");
      expect(updates.setterConfirm).toBeNull();
      expect(updates.matcherConfirm).toBeNull();
      // Turn passes to setter for review
      expect(updates.currentTurn).toBe("p1");
    });

    it("throws when game is not found", async () => {
      mockTxGet.mockResolvedValueOnce(makeNotFoundSnap());
      await expect(submitMatchAttempt("g1", null)).rejects.toThrow("Game not found");
    });

    it("throws when game is already over", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, status: "forfeit", phase: "matching" }));
      await expect(submitMatchAttempt("g1", null)).rejects.toThrow("Game is already over");
    });

    it("throws when not in matching phase", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));
      await expect(submitMatchAttempt("g1", null)).rejects.toThrow("Not in matching phase");
    });
  });

  describe("submitConfirmation", () => {
    const confirmingGame = {
      ...baseGame,
      phase: "confirming",
      currentSetter: "p1",
      currentTurn: "p1",
      setterConfirm: null,
      matcherConfirm: null,
    };

    it("setter confirms landed — resolves immediately, no letter", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(confirmingGame));

      const result = await submitConfirmation("g1", "p1", true);
      expect(result.resolved).toBe(true);
      expect(result.gameOver).toBe(false);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.setterConfirm).toBe(true);
      expect(updates.matcherConfirm).toBeNull();
      expect(updates.p1Letters).toBe(0);
      expect(updates.p2Letters).toBe(0);
      expect(updates.phase).toBe("setting");
      // Matcher landed, so matcher becomes next setter
      expect(updates.currentSetter).toBe("p2");
    });

    it("setter confirms missed — matcher gets a letter", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(confirmingGame));

      const result = await submitConfirmation("g1", "p1", false);
      expect(result.resolved).toBe(true);

      const updates = mockTxUpdate.mock.calls[0][1];
      // p2 is matcher and gets a letter since setter said missed
      expect(updates.p2Letters).toBe(1);
      expect(updates.p1Letters).toBe(0);
      expect(updates.currentSetter).toBe("p1"); // Same setter stays
    });

    it("throws when matcher tries to vote", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(confirmingGame));
      await expect(submitConfirmation("g1", "p2", true)).rejects.toThrow("Only the setter can confirm");
    });

    it("ends game when matcher reaches 5 letters", async () => {
      const game = { ...confirmingGame, p2Letters: 4 };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await submitConfirmation("g1", "p1", false);
      expect(result.gameOver).toBe(true);
      expect(result.winner).toBe("p1");

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.status).toBe("complete");
      expect(updates.winner).toBe("p1");
    });

    it("ends game when p1 reaches 5 letters (p2 wins)", async () => {
      const game = { ...confirmingGame, currentSetter: "p2", currentTurn: "p2", p1Letters: 4 };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await submitConfirmation("g1", "p2", false);
      expect(result.gameOver).toBe(true);
      expect(result.winner).toBe("p2");
    });

    it("increments turn number when game continues", async () => {
      const game = { ...confirmingGame, turnNumber: 3 };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await submitConfirmation("g1", "p1", false);
      expect(result.resolved).toBe(true);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.turnNumber).toBe(4);
    });

    it("does not reset locked fields when resolving back to setting phase", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(confirmingGame));

      await submitConfirmation("g1", "p1", true);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("setting");
      // These fields are intentionally NOT reset here — the Firestore confirmation
      // rule locks them, so resetting them would violate the rule. They are cleaned
      // up by subsequent phase transitions (setTrick / submitMatchAttempt).
      expect(updates).not.toHaveProperty("currentTrickName");
      expect(updates).not.toHaveProperty("currentTrickVideoUrl");
      expect(updates).not.toHaveProperty("matchVideoUrl");
      // setterConfirm retains the vote value to satisfy Firestore rule validation
      expect(updates.setterConfirm).toBe(true);
    });

    it("throws when setter already voted", async () => {
      const game = { ...confirmingGame, setterConfirm: true };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));
      await expect(submitConfirmation("g1", "p1", true)).rejects.toThrow("You already voted");
    });

    it("throws when game is not found", async () => {
      mockTxGet.mockResolvedValueOnce(makeNotFoundSnap());
      await expect(submitConfirmation("g1", "p1", true)).rejects.toThrow("Game not found");
    });

    it("throws when not in confirming phase", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));
      await expect(submitConfirmation("g1", "p1", true)).rejects.toThrow("Not in confirming phase");
    });

    it("throws when game is already over", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, status: "complete", phase: "confirming" }));
      await expect(submitConfirmation("g1", "p1", true)).rejects.toThrow("Game is already over");
    });
  });

  describe("forfeitExpiredTurn", () => {
    it("forfeits when turn deadline has passed", async () => {
      const game = {
        ...baseGame,
        currentTurn: "p1",
        turnDeadline: { toMillis: () => Date.now() - 1000 },
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1");
      expect(result.forfeited).toBe(true);
      expect(result.winner).toBe("p2");

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.status).toBe("forfeit");
      expect(updates.winner).toBe("p2");
    });

    it("does not forfeit when deadline has not passed", async () => {
      const game = {
        ...baseGame,
        currentTurn: "p1",
        turnDeadline: { toMillis: () => Date.now() + 86400000 },
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1");
      expect(result.forfeited).toBe(false);
      expect(mockTxUpdate).not.toHaveBeenCalled();
    });

    it("does not forfeit completed games", async () => {
      const game = { ...baseGame, status: "complete" };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1");
      expect(result.forfeited).toBe(false);
    });

    it("returns false for non-existent games", async () => {
      mockTxGet.mockResolvedValueOnce(makeNotFoundSnap());

      const result = await forfeitExpiredTurn("g1");
      expect(result.forfeited).toBe(false);
    });

    it("does not forfeit when turnDeadline is missing", async () => {
      const game = {
        ...baseGame,
        currentTurn: "p1",
        turnDeadline: null,
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1");
      expect(result.forfeited).toBe(false);
      expect(mockTxUpdate).not.toHaveBeenCalled();
    });

    it("awards win to p1 when p2's turn expires", async () => {
      const game = {
        ...baseGame,
        currentTurn: "p2",
        turnDeadline: { toMillis: () => Date.now() - 5000 },
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1");
      expect(result.forfeited).toBe(true);
      expect(result.winner).toBe("p1");
    });
  });

  describe("subscribeToGame", () => {
    it("calls onUpdate with the game doc on snapshot", () => {
      mockOnSnapshot.mockImplementation((_ref: unknown, cb: Function) => {
        cb({
          exists: () => true,
          id: "g1",
          data: () => ({ ...baseGame }),
        });
        return vi.fn(); // unsub
      });

      const onUpdate = vi.fn();
      subscribeToGame("g1", onUpdate);
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }));
    });

    it("calls onUpdate with null when doc doesn't exist", () => {
      mockOnSnapshot.mockImplementation((_ref: unknown, cb: Function) => {
        cb({ exists: () => false });
        return vi.fn();
      });

      const onUpdate = vi.fn();
      subscribeToGame("g1", onUpdate);
      expect(onUpdate).toHaveBeenCalledWith(null);
    });

    it("returns an unsubscribe function", () => {
      const mockUnsub = vi.fn();
      mockOnSnapshot.mockReturnValue(mockUnsub);

      const unsub = subscribeToGame("g1", vi.fn());
      unsub();
      expect(mockUnsub).toHaveBeenCalled();
    });

    it("calls onUpdate with null on snapshot error", () => {
      mockOnSnapshot.mockImplementation((_ref: unknown, _onNext: unknown, onError: Function) => {
        onError(new Error("permission-denied"));
        return vi.fn();
      });

      const onUpdate = vi.fn();
      subscribeToGame("g1", onUpdate);
      expect(onUpdate).toHaveBeenCalledWith(null);
    });
  });

  describe("subscribeToMyGames", () => {
    it("sets up two snapshot listeners (p1 and p2 queries)", () => {
      mockOnSnapshot.mockReturnValue(vi.fn());

      subscribeToMyGames("u1", vi.fn());

      // Two queries: player1Uid == u1, player2Uid == u1
      expect(mockOnSnapshot).toHaveBeenCalledTimes(2);
      expect(mockWhere).toHaveBeenCalledWith("player1Uid", "==", "u1");
      expect(mockWhere).toHaveBeenCalledWith("player2Uid", "==", "u1");
    });

    it("unsubscribes both listeners on cleanup", () => {
      const unsub1 = vi.fn();
      const unsub2 = vi.fn();
      mockOnSnapshot.mockReturnValueOnce(unsub1).mockReturnValueOnce(unsub2);

      const unsub = subscribeToMyGames("u1", vi.fn());
      unsub();

      expect(unsub1).toHaveBeenCalled();
      expect(unsub2).toHaveBeenCalled();
    });

    it("merges and deduplicates games from both queries", () => {
      const onUpdate = vi.fn();
      const game1 = { id: "g1", ...baseGame, status: "active", turnNumber: 1 };
      const game2 = { id: "g2", ...baseGame, status: "active", turnNumber: 2 };

      mockOnSnapshot.mockImplementation((_query: unknown, cb: Function) => {
        // Both queries return the same game + one unique
        cb({
          docs: [
            { id: "g1", data: () => ({ ...baseGame, status: "active", turnNumber: 1 }) },
            { id: "g2", data: () => ({ ...baseGame, status: "active", turnNumber: 2 }) },
          ],
        });
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);

      // Should be called with deduplicated games
      const games = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      const ids = games.map((g: any) => g.id);
      expect(new Set(ids).size).toBe(ids.length); // no duplicates
    });

    it("sorts active games before completed games", () => {
      const onUpdate = vi.fn();

      mockOnSnapshot.mockImplementation((_query: unknown, cb: Function) => {
        cb({
          docs: [
            { id: "g1", data: () => ({ ...baseGame, status: "complete", turnNumber: 5 }) },
            { id: "g2", data: () => ({ ...baseGame, status: "active", turnNumber: 1 }) },
          ],
        });
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);

      const games = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(games[0].status).toBe("active");
      expect(games[1].status).toBe("complete");
    });

    it("keeps active game at front when it appears first in results", () => {
      const onUpdate = vi.fn();

      // Put active game FIRST so comparator is called with (active, complete)
      mockOnSnapshot.mockImplementation((_query: unknown, cb: Function) => {
        cb({
          docs: [
            { id: "g2", data: () => ({ ...baseGame, status: "active", turnNumber: 1 }) },
            { id: "g1", data: () => ({ ...baseGame, status: "complete", turnNumber: 5 }) },
          ],
        });
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);

      const games = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(games[0].status).toBe("active");
      expect(games[1].status).toBe("complete");
    });

    it("sorts completed games by turn number descending", () => {
      const onUpdate = vi.fn();

      mockOnSnapshot.mockImplementation((_query: unknown, cb: Function) => {
        cb({
          docs: [
            { id: "g1", data: () => ({ ...baseGame, status: "complete", turnNumber: 2 }) },
            { id: "g2", data: () => ({ ...baseGame, status: "forfeit", turnNumber: 5 }) },
          ],
        });
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);

      const games = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      // Both are non-active, should be sorted by turnNumber descending
      expect(games[0].id).toBe("g2"); // turnNumber 5 first
      expect(games[1].id).toBe("g1"); // turnNumber 2 second
    });

    it("logs a warning on snapshot error (does not throw)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockOnSnapshot.mockImplementation((_query: unknown, _onNext: unknown, onError: Function) => {
        onError(new Error("network error"));
        return vi.fn();
      });

      // Should not throw — error is swallowed with a console.warn
      expect(() => subscribeToMyGames("u1", vi.fn())).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith("Game subscription error for uid:", "u1", "network error");
      warnSpy.mockRestore();
    });
  });
});
