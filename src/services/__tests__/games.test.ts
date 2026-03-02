import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ────────────────── */
const {
  mockAddDoc,
  mockGetDoc,
  mockUpdateDoc,
  mockOnSnapshot,
  mockDoc,
  mockCollection,
  mockQuery,
  mockWhere,
  mockOrderBy,
} = vi.hoisted(() => ({
  mockAddDoc: vi.fn(),
  mockGetDoc: vi.fn(),
  mockUpdateDoc: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockDoc: vi.fn((...args: any[]) => args.slice(1).join("/")),
  mockCollection: vi.fn((...args: any[]) => args[1]),
  mockQuery: vi.fn((...args: any[]) => args),
  mockWhere: vi.fn((...args: any[]) => args),
  mockOrderBy: vi.fn((...args: any[]) => args),
}));

vi.mock("firebase/firestore", () => ({
  collection: mockCollection,
  doc: mockDoc,
  addDoc: mockAddDoc,
  getDoc: mockGetDoc,
  updateDoc: mockUpdateDoc,
  query: mockQuery,
  where: mockWhere,
  orderBy: mockOrderBy,
  onSnapshot: mockOnSnapshot,
  serverTimestamp: () => "SERVER_TS",
  Timestamp: {
    fromMillis: (ms: number) => ({ _ms: ms, toMillis: () => ms }),
  },
}));

vi.mock("../../firebase");

import {
  createGame,
  setTrick,
  submitMatchResult,
  subscribeToGame,
} from "../games";

beforeEach(() => vi.clearAllMocks());

/* ── Helpers ────────────────────────────────── */

function makeGameSnap(data: Record<string, unknown>, id = "g1") {
  return {
    exists: () => true,
    id,
    data: () => data,
  };
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
      expect(mockAddDoc).toHaveBeenCalledTimes(1);

      const docData = mockAddDoc.mock.calls[0][1];
      expect(docData.player1Uid).toBe("p1");
      expect(docData.player2Uid).toBe("p2");
      expect(docData.status).toBe("active");
      expect(docData.phase).toBe("setting");
      expect(docData.currentSetter).toBe("p1");
    });
  });

  describe("setTrick", () => {
    it("transitions the game from setting to matching phase", async () => {
      mockGetDoc.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));
      mockUpdateDoc.mockResolvedValueOnce(undefined);

      await setTrick("g1", "Kickflip", "https://vid.url");

      expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
      const updates = mockUpdateDoc.mock.calls[0][1];
      expect(updates.phase).toBe("matching");
      expect(updates.currentTrickName).toBe("Kickflip");
      expect(updates.currentTurn).toBe("p2"); // matcher
    });

    it("throws when game is not in setting phase", async () => {
      mockGetDoc.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "matching" }));
      await expect(setTrick("g1", "Kickflip", null)).rejects.toThrow(
        "Not in setting phase"
      );
    });

    it("throws when game is not found", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false });
      await expect(setTrick("g1", "Kickflip", null)).rejects.toThrow("Game not found");
    });
  });

  describe("submitMatchResult", () => {
    it("adds a letter when the matcher misses", async () => {
      const game = { ...baseGame, phase: "matching", currentSetter: "p1" };
      mockGetDoc.mockResolvedValueOnce(makeGameSnap(game));
      mockUpdateDoc.mockResolvedValueOnce(undefined);

      const result = await submitMatchResult("g1", false, null);
      expect(result.gameOver).toBe(false);

      const updates = mockUpdateDoc.mock.calls[0][1];
      // p2 is matcher (since p1 is setter), p2 gets letter
      expect(updates.p2Letters).toBe(1);
    });

    it("does not add a letter when the matcher lands it", async () => {
      const game = { ...baseGame, phase: "matching", currentSetter: "p1" };
      mockGetDoc.mockResolvedValueOnce(makeGameSnap(game));
      mockUpdateDoc.mockResolvedValueOnce(undefined);

      await submitMatchResult("g1", true, null);

      const updates = mockUpdateDoc.mock.calls[0][1];
      expect(updates.p1Letters).toBe(0);
      expect(updates.p2Letters).toBe(0);
    });

    it("switches setter to matcher when trick is landed", async () => {
      const game = { ...baseGame, phase: "matching", currentSetter: "p1" };
      mockGetDoc.mockResolvedValueOnce(makeGameSnap(game));
      mockUpdateDoc.mockResolvedValueOnce(undefined);

      await submitMatchResult("g1", true, null);

      const updates = mockUpdateDoc.mock.calls[0][1];
      // matcher was p2, now p2 becomes setter
      expect(updates.currentSetter).toBe("p2");
    });

    it("keeps same setter when trick is missed", async () => {
      const game = { ...baseGame, phase: "matching", currentSetter: "p1" };
      mockGetDoc.mockResolvedValueOnce(makeGameSnap(game));
      mockUpdateDoc.mockResolvedValueOnce(undefined);

      await submitMatchResult("g1", false, null);

      const updates = mockUpdateDoc.mock.calls[0][1];
      expect(updates.currentSetter).toBe("p1");
    });

    it("ends the game when a player reaches 5 letters", async () => {
      const game = {
        ...baseGame,
        phase: "matching",
        currentSetter: "p1",
        p2Letters: 4, // p2 (matcher) about to get 5th letter
      };
      mockGetDoc.mockResolvedValueOnce(makeGameSnap(game));
      mockUpdateDoc.mockResolvedValueOnce(undefined);

      const result = await submitMatchResult("g1", false, null);
      expect(result.gameOver).toBe(true);
      expect(result.winner).toBe("p1"); // p2 lost (reached 5), so p1 wins

      const updates = mockUpdateDoc.mock.calls[0][1];
      expect(updates.status).toBe("complete");
      expect(updates.winner).toBe("p1");
    });

    it("throws when not in matching phase", async () => {
      mockGetDoc.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));
      await expect(submitMatchResult("g1", true, null)).rejects.toThrow(
        "Not in matching phase"
      );
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
  });
});
