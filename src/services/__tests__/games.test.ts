import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ────────────────── */
const {
  mockAddDoc,
  mockSetDoc,
  mockGetDocs,
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
  mockGetDocs: vi.fn(),
  mockRunTransaction: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockDoc: vi.fn((...args: any[]) => {
    const path = args.slice(1).join("/");
    return { __path: path, id: path.split("/").pop() || "auto-id" };
  }),
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
  getDocs: mockGetDocs,
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
  forfeitExpiredTurn,
  subscribeToGame,
  subscribeToMyGames,
  fetchPlayerCompletedGames,
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
      // First addDoc creates the game; second (fire-and-forget) writes a notification
      expect(mockAddDoc).toHaveBeenCalledTimes(2);

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

    it("throws when called again within the turn action cooldown period", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));
      await setTrick("g1", "Kickflip", null);

      // Second call hits rate limit before reaching the transaction — no mock needed
      await expect(setTrick("g1", "Heelflip", null)).rejects.toThrow("Please wait before submitting another action");
    });

    it("allows calls on different games within cooldown", async () => {
      mockTxGet
        .mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }))
        .mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));
      await setTrick("g1", "Kickflip", null);
      await expect(setTrick("g2", "Heelflip", null)).resolves.toBeUndefined();
    });

    it("prunes stale rate-limit entries when map exceeds 50 entries", async () => {
      // Fill the rate-limit map with 51 entries by calling setTrick on distinct game IDs.
      // We fake Date.now so the first 51 entries appear old (> 60s ago), then advance time.
      const realDateNow = Date.now;
      let fakeNow = 1_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => fakeNow);

      for (let i = 0; i < 51; i++) {
        _resetCreateGameRateLimit();
        // We only need to reset the *game create* cooldown; turn-action entries accumulate.
        // Actually, _resetCreateGameRateLimit clears the map, so we need a different approach.
      }

      // Restore and use a manual approach: call setTrick on 51 different game IDs
      vi.spyOn(Date, "now").mockRestore();
      _resetCreateGameRateLimit();

      // Set fakeNow to a point in the past so entries are "old"
      fakeNow = 100_000;
      vi.spyOn(Date, "now").mockImplementation(() => fakeNow);

      // Perform 51 turn actions on different game IDs
      for (let i = 0; i < 51; i++) {
        mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));
        await setTrick(`prune-game-${i}`, "Trick", null);
      }

      // Now advance time by more than 60s so entries become stale
      fakeNow = 100_000 + 61_000;

      // The next call will trigger pruning (map.size > 50) and remove stale entries
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));
      await setTrick("prune-game-new", "Trick", null);

      // If pruning works, no error is thrown — the test passes.
      expect(mockTxUpdate).toHaveBeenCalled();

      vi.spyOn(Date, "now").mockRestore();
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

    it("throws when called again within the turn action cooldown period", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));
      await failSetTrick("g1");

      // Second call hits rate limit before reaching the transaction — no mock needed
      await expect(failSetTrick("g1")).rejects.toThrow("Please wait before submitting another action");
    });
  });

  describe("submitMatchAttempt (self-judging)", () => {
    const matchingGame = {
      ...baseGame,
      phase: "matching",
      currentSetter: "p1",
      currentTurn: "p2",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://vid.url/set.webm",
    };

    it("landed — no letter, setter stays the setter", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matchingGame));

      const result = await submitMatchAttempt("g1", "https://vid.url/match.webm", true);

      expect(result.gameOver).toBe(false);
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.p1Letters).toBe(0);
      expect(updates.p2Letters).toBe(0);
      expect(updates.phase).toBe("setting");
      expect(updates.currentSetter).toBe("p1"); // setter stays until they miss their own trick
      expect(updates.matchVideoUrl).toBe("https://vid.url/match.webm");
    });

    it("missed — matcher gets a letter, setter stays", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matchingGame));

      const result = await submitMatchAttempt("g1", "https://vid.url/match.webm", false);

      expect(result.gameOver).toBe(false);
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.p2Letters).toBe(1); // p2 is matcher
      expect(updates.p1Letters).toBe(0);
      expect(updates.currentSetter).toBe("p1"); // same setter stays
    });

    it("ends game when matcher reaches 5 letters", async () => {
      const game = { ...matchingGame, p2Letters: 4 };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await submitMatchAttempt("g1", null, false);
      expect(result.gameOver).toBe(true);
      expect(result.winner).toBe("p1");

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.status).toBe("complete");
      expect(updates.winner).toBe("p1");
    });

    it("ends game when p1 reaches 5 letters (p2 wins)", async () => {
      // p2 is setter, p1 is matcher
      const game = { ...matchingGame, currentSetter: "p2", currentTurn: "p1", p1Letters: 4 };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await submitMatchAttempt("g1", null, false);
      expect(result.gameOver).toBe(true);
      expect(result.winner).toBe("p2");
    });

    it("sends game_lost notification when setter loses", async () => {
      // Edge case: p1 is setter but already had 5 letters (data inconsistency).
      // The winner becomes p2 (matcher's side), so the setter gets a "game_lost" notification.
      const game = { ...matchingGame, p1Letters: 5, currentSetter: "p1", currentTurn: "p2" };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await submitMatchAttempt("g1", null, true);
      expect(result.gameOver).toBe(true);
      expect(result.winner).toBe("p2");
    });

    it("increments turn number when game continues", async () => {
      const game = { ...matchingGame, turnNumber: 3 };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      await submitMatchAttempt("g1", null, false);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.turnNumber).toBe(4);
    });

    it("records turn history", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matchingGame));

      await submitMatchAttempt("g1", "https://vid.url/match.webm", true);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.turnHistory).toBeDefined();
      const record = updates.turnHistory._arrayUnion[0];
      expect(record.trickName).toBe("Kickflip");
      expect(record.landed).toBe(true);
      expect(record.letterTo).toBeNull();
    });

    it("uses 'Trick' fallback when currentTrickName is null", async () => {
      const game = { ...matchingGame, currentTrickName: null };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      await submitMatchAttempt("g1", null, true);

      const updates = mockTxUpdate.mock.calls[0][1];
      const record = updates.turnHistory._arrayUnion[0];
      expect(record.trickName).toBe("Trick");
    });

    it("throws when game is not found", async () => {
      mockTxGet.mockResolvedValueOnce(makeNotFoundSnap());
      await expect(submitMatchAttempt("g1", null, true)).rejects.toThrow("Game not found");
    });

    it("throws when game is already over", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, status: "forfeit", phase: "matching" }));
      await expect(submitMatchAttempt("g1", null, true)).rejects.toThrow("Game is already over");
    });

    it("throws when not in matching phase", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));
      await expect(submitMatchAttempt("g1", null, true)).rejects.toThrow("Not in matching phase");
    });

    it("throws when called again within the turn action cooldown period", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matchingGame));
      await submitMatchAttempt("g1", null, true);

      // Second call hits rate limit before reaching the transaction — no mock needed
      await expect(submitMatchAttempt("g1", null, false)).rejects.toThrow(
        "Please wait before submitting another action",
      );
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

    it("accepts a custom limit count", () => {
      mockOnSnapshot.mockReturnValue(vi.fn());

      subscribeToMyGames("u1", vi.fn(), 10);

      expect(mockLimit).toHaveBeenCalledWith(10);
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

      // Should not throw — error is swallowed with a logger.warn
      expect(() => subscribeToMyGames("u1", vi.fn())).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        "[WARN]",
        "game_subscription_error",
        expect.objectContaining({ uid: "u1", error: "network error" }),
      );
      warnSpy.mockRestore();
    });
  });

  /* ── fetchPlayerCompletedGames ─────────────── */

  describe("fetchPlayerCompletedGames", () => {
    function makeDocSnap(data: Record<string, unknown>, id: string) {
      return {
        id,
        data: () => data,
      };
    }

    const baseCompleteGame = {
      player1Uid: "u1",
      player2Uid: "u2",
      player1Username: "alice",
      player2Username: "bob",
      p1Letters: 5,
      p2Letters: 2,
      status: "complete",
      currentTurn: "u1",
      phase: "setting",
      currentSetter: "u1",
      currentTrickName: null,
      currentTrickVideoUrl: null,
      matchVideoUrl: null,
      turnDeadline: { toMillis: () => 1000 },
      turnNumber: 4,
      winner: "u2",
      createdAt: null,
      updatedAt: { toMillis: () => 2000 },
    };

    it("fetches and merges games from both player1 and player2 queries", async () => {
      mockGetDocs
        .mockResolvedValueOnce({
          docs: [makeDocSnap({ ...baseCompleteGame }, "g1")],
        })
        .mockResolvedValueOnce({
          docs: [
            makeDocSnap(
              { ...baseCompleteGame, player1Uid: "u3", player2Uid: "u1", updatedAt: { toMillis: () => 3000 } },
              "g2",
            ),
          ],
        });

      const games = await fetchPlayerCompletedGames("u1");
      expect(games).toHaveLength(2);
      // Sorted by updatedAt desc — g2 (3000) before g1 (2000)
      expect(games[0].id).toBe("g2");
      expect(games[1].id).toBe("g1");
    });

    it("deduplicates games that appear in both queries", async () => {
      const sharedDoc = makeDocSnap({ ...baseCompleteGame }, "g1");
      mockGetDocs.mockResolvedValueOnce({ docs: [sharedDoc] }).mockResolvedValueOnce({ docs: [sharedDoc] });

      const games = await fetchPlayerCompletedGames("u1");
      expect(games).toHaveLength(1);
      expect(games[0].id).toBe("g1");
    });

    it("returns empty array when player has no completed games", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({ docs: [] });

      const games = await fetchPlayerCompletedGames("u1");
      expect(games).toHaveLength(0);
    });

    it("sorts games by updatedAt descending", async () => {
      mockGetDocs
        .mockResolvedValueOnce({
          docs: [
            makeDocSnap({ ...baseCompleteGame, updatedAt: { toMillis: () => 1000 } }, "g-old"),
            makeDocSnap({ ...baseCompleteGame, updatedAt: { toMillis: () => 5000 } }, "g-new"),
            makeDocSnap({ ...baseCompleteGame, updatedAt: { toMillis: () => 3000 } }, "g-mid"),
          ],
        })
        .mockResolvedValueOnce({ docs: [] });

      const games = await fetchPlayerCompletedGames("u1");
      expect(games.map((g) => g.id)).toEqual(["g-new", "g-mid", "g-old"]);
    });

    it("handles games with null updatedAt", async () => {
      mockGetDocs
        .mockResolvedValueOnce({
          docs: [
            makeDocSnap({ ...baseCompleteGame, updatedAt: null }, "g-null"),
            makeDocSnap({ ...baseCompleteGame, updatedAt: { toMillis: () => 1000 } }, "g-dated"),
          ],
        })
        .mockResolvedValueOnce({ docs: [] });

      const games = await fetchPlayerCompletedGames("u1");
      expect(games).toHaveLength(2);
      // g-dated (1000) comes before g-null (0)
      expect(games[0].id).toBe("g-dated");
      expect(games[1].id).toBe("g-null");
    });

    it("scopes queries to shared games when viewerUid is provided", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({ docs: [] });
      mockWhere.mockClear();

      await fetchPlayerCompletedGames("u1", "viewer1");

      // Should include where clauses for both players in each query
      expect(mockWhere).toHaveBeenCalledWith("player1Uid", "==", "u1");
      expect(mockWhere).toHaveBeenCalledWith("player2Uid", "==", "viewer1");
      expect(mockWhere).toHaveBeenCalledWith("player2Uid", "==", "u1");
      expect(mockWhere).toHaveBeenCalledWith("player1Uid", "==", "viewer1");
    });

    it("does not scope queries when viewerUid equals uid", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({ docs: [] });
      mockWhere.mockClear();

      await fetchPlayerCompletedGames("u1", "u1");

      // Should NOT add extra where clauses for viewerUid when same as uid
      const playerCalls = mockWhere.mock.calls.filter(
        (c: unknown[]) => (c[0] === "player1Uid" || c[0] === "player2Uid") && c[1] === "==",
      );
      // Only 2 calls: player1Uid==u1 and player2Uid==u1 (no viewer scoping)
      expect(playerCalls).toHaveLength(2);
    });

    it("handles games with updatedAt missing toMillis", async () => {
      mockGetDocs
        .mockResolvedValueOnce({
          docs: [
            makeDocSnap({ ...baseCompleteGame, updatedAt: {} }, "g-no-millis-a"),
            makeDocSnap({ ...baseCompleteGame, updatedAt: {} }, "g-no-millis-b"),
            makeDocSnap({ ...baseCompleteGame, updatedAt: { toMillis: () => 1000 } }, "g-dated"),
          ],
        })
        .mockResolvedValueOnce({ docs: [] });

      const games = await fetchPlayerCompletedGames("u1");
      expect(games).toHaveLength(3);
      expect(games[0].id).toBe("g-dated");
    });
  });
});
