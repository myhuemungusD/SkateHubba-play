import { describe, it, expect } from "vitest";

// prettier-ignore
import { installGamesTestBeforeEach, makeGameSnap, makeNotFoundSnap, baseGame, mockTxUpdate, mockTxGet } from "./games.test-helpers";

import { forfeitExpiredTurn } from "../games";

installGamesTestBeforeEach();

describe("games service", () => {
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

    it("auto-accepts expired disputable phase (matcher's landed call stands)", async () => {
      const game = {
        ...baseGame,
        phase: "disputable",
        currentSetter: "p1",
        currentTurn: "p1",
        currentTrickName: "Kickflip",
        currentTrickVideoUrl: "https://vid.url/set.webm",
        matchVideoUrl: "https://vid.url/match.webm",
        turnDeadline: { toMillis: () => Date.now() - 1000 },
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1");
      expect(result.forfeited).toBe(false);
      expect(result.winner).toBeNull();
      expect(result.disputeAutoAccepted).toBe(true);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("setting");
      expect(updates.currentSetter).toBe("p2"); // roles swap
      expect(updates.currentTurn).toBe("p2");
      expect(updates.turnNumber).toBe(2);
      expect(updates.p1Letters).toBe(0); // no letter changes
      expect(updates.p2Letters).toBe(0);
      // Turn history recorded
      const record = updates.turnHistory._arrayUnion[0];
      expect(record.landed).toBe(true);
      expect(record.letterTo).toBeNull();
    });

    it("auto-accepts expired disputable with null trickName (uses 'Trick' fallback)", async () => {
      const game = {
        ...baseGame,
        phase: "disputable",
        currentSetter: "p1",
        currentTurn: "p1",
        currentTrickName: null,
        currentTrickVideoUrl: null,
        matchVideoUrl: null,
        turnDeadline: { toMillis: () => Date.now() - 1000 },
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1");
      expect(result.disputeAutoAccepted).toBe(true);

      const updates = mockTxUpdate.mock.calls[0][1];
      const record = updates.turnHistory._arrayUnion[0];
      expect(record.trickName).toBe("Trick");
    });

    it("auto-accepts expired disputable when p2 is setter (covers p2 username ternary)", async () => {
      const game = {
        ...baseGame,
        phase: "disputable",
        currentSetter: "p2",
        currentTurn: "p2",
        currentTrickName: "Heelflip",
        currentTrickVideoUrl: "https://vid.url/set.webm",
        matchVideoUrl: "https://vid.url/match.webm",
        turnDeadline: { toMillis: () => Date.now() - 1000 },
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1");
      expect(result.disputeAutoAccepted).toBe(true);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.currentSetter).toBe("p1"); // roles swap: p1 is matcher who landed
      const record = updates.turnHistory._arrayUnion[0];
      expect(record.setterUsername).toBe("bob"); // p2's username
      expect(record.matcherUsername).toBe("alice"); // p1's username
    });

    it("auto-clears expired setReview (benefit of doubt to setter)", async () => {
      const game = {
        ...baseGame,
        phase: "setReview",
        currentSetter: "p1",
        currentTurn: "j1",
        currentTrickName: "Kickflip",
        currentTrickVideoUrl: "https://vid.url/set.webm",
        judgeId: "j1",
        judgeStatus: "accepted",
        turnDeadline: { toMillis: () => Date.now() - 1000 },
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1");
      expect(result.forfeited).toBe(false);
      expect(result.setReviewAutoCleared).toBe(true);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("matching");
      expect(updates.currentTurn).toBe("p2"); // matcher
    });

    it("does not auto-accept disputable when deadline is in the future", async () => {
      const game = {
        ...baseGame,
        phase: "disputable",
        currentTurn: "p1",
        turnDeadline: { toMillis: () => Date.now() + 86400000 },
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1");
      expect(result.forfeited).toBe(false);
      expect(result.disputeAutoAccepted).toBeUndefined();
      expect(mockTxUpdate).not.toHaveBeenCalled();
    });
  });
});
