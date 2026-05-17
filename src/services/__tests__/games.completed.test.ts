import { describe, it, expect } from "vitest";

import { installGamesTestBeforeEach, mockGetDocs, mockWhere } from "./games.test-helpers";

import { fetchPlayerCompletedGames } from "../games";

installGamesTestBeforeEach();

describe("games service", () => {
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
