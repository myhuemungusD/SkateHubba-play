import { describe, it, expect, vi } from "vitest";

// prettier-ignore
import { installGamesTestBeforeEach, makeGameSnap, makeNotFoundSnap, baseGame, mockTxUpdate, mockTxGet } from "./games.test-helpers";

import { setTrick, failSetTrick, submitMatchAttempt, _turnActionMapSize } from "../games";

installGamesTestBeforeEach();

describe("games service", () => {
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
      // matchVideoUrl is intentionally NOT written by setTrick — see the
      // service file for rationale (setting-phase rule pins it immutable).
      expect("matchVideoUrl" in updates).toBe(false);
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

    it("prunes stale rate-limit entries on every turn action", async () => {
      let fakeNow = 100_000;
      vi.spyOn(Date, "now").mockImplementation(() => fakeNow);

      for (let i = 0; i < 5; i++) {
        mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));
        await setTrick(`prune-game-${i}`, "Trick", null);
      }
      expect(_turnActionMapSize()).toBe(5);

      // Advance past the 3s cooldown window — all 5 entries become stale
      fakeNow += 4_000;

      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));
      await setTrick("prune-game-new", "Trick", null);
      expect(_turnActionMapSize()).toBe(1);

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
      // matchVideoUrl is intentionally NOT written by failSetTrick — see
      // the service file for rationale (setting-phase rule pins it immutable).
      expect("matchVideoUrl" in updates).toBe(false);
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

  describe("submitMatchAttempt", () => {
    const matchingGame = {
      ...baseGame,
      phase: "matching",
      currentSetter: "p1",
      currentTurn: "p2",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://vid.url/set.webm",
    };

    const matchingGameWithJudge = {
      ...matchingGame,
      judgeId: "j1",
      judgeUsername: "judge",
      judgeStatus: "accepted",
    };

    it("honor-system landed — matcher becomes next setter immediately", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matchingGame));

      const result = await submitMatchAttempt("g1", "https://vid.url/match.webm", true);

      expect(result.gameOver).toBe(false);
      expect(result.winner).toBeNull();
      const updates = mockTxUpdate.mock.calls[0][1];
      // No judge → no disputable. Roles swap, matcher becomes setter.
      expect(updates.phase).toBe("setting");
      expect(updates.currentSetter).toBe("p2");
      expect(updates.currentTurn).toBe("p2");
      expect(updates.turnNumber).toBe(2);
      expect(updates.matchVideoUrl).toBe("https://vid.url/match.webm");
      // Turn history recorded with landed=true
      const record = updates.turnHistory._arrayUnion[0];
      expect(record.landed).toBe(true);
      expect(record.letterTo).toBeNull();
    });

    it("judge-active landed — enters disputable phase routed to judge, no letters change", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matchingGameWithJudge));

      const result = await submitMatchAttempt("g1", "https://vid.url/match.webm", true);

      expect(result.gameOver).toBe(false);
      expect(result.winner).toBeNull();
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("disputable");
      expect(updates.matchVideoUrl).toBe("https://vid.url/match.webm");
      // Judge reviews — never the setter.
      expect(updates.currentTurn).toBe("j1");
      // No letter changes, no turn history yet (deferred to dispute resolution)
      expect(updates.p1Letters).toBeUndefined();
      expect(updates.p2Letters).toBeUndefined();
      expect(updates.turnHistory).toBeUndefined();
    });

    it("judge nominated but not accepted — still honor system", async () => {
      const pendingJudgeGame = { ...matchingGameWithJudge, judgeStatus: "pending" };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(pendingJudgeGame));

      await submitMatchAttempt("g1", "https://vid.url/match.webm", true);

      const updates = mockTxUpdate.mock.calls[0][1];
      // Pending judge doesn't activate dispute path.
      expect(updates.phase).toBe("setting");
      expect(updates.currentSetter).toBe("p2");
    });

    it("honor-system landed uses 'Trick' fallback when currentTrickName is null", async () => {
      const noTrickName = { ...matchingGame, currentTrickName: null };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(noTrickName));
      await submitMatchAttempt("g1", null, true);
      const updates = mockTxUpdate.mock.calls[0][1];
      const record = updates.turnHistory._arrayUnion[0];
      expect(record.trickName).toBe("Trick");
    });

    it("missed — matcher gets a letter, setter stays", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matchingGame));

      const result = await submitMatchAttempt("g1", "https://vid.url/match.webm", false);

      expect(result.gameOver).toBe(false);
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.p2Letters).toBe(1); // p2 is matcher
      expect(updates.p1Letters).toBe(0);
      expect(updates.currentSetter).toBe("p1"); // same setter stays
      expect(updates.phase).toBe("setting");
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
      const game = { ...matchingGame, currentSetter: "p2", currentTurn: "p1", p1Letters: 4 };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await submitMatchAttempt("g1", null, false);
      expect(result.gameOver).toBe(true);
      expect(result.winner).toBe("p2");
    });

    it("judge-active landed with 5 letters already — still enters disputable, not game over", async () => {
      // Even if matcher already has 5 letters, landing enters disputable (no letter change)
      const game = { ...matchingGameWithJudge, p1Letters: 5, currentSetter: "p1", currentTurn: "p2" };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await submitMatchAttempt("g1", null, true);
      expect(result.gameOver).toBe(false);
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("disputable");
    });

    it("increments turn number when game continues (missed)", async () => {
      const game = { ...matchingGame, turnNumber: 3 };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      await submitMatchAttempt("g1", null, false);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.turnNumber).toBe(4);
    });

    it("records turn history on miss", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matchingGame));

      await submitMatchAttempt("g1", "https://vid.url/match.webm", false);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.turnHistory).toBeDefined();
      const record = updates.turnHistory._arrayUnion[0];
      expect(record.trickName).toBe("Kickflip");
      expect(record.landed).toBe(false);
      expect(record.letterTo).toBe("p2");
    });

    it("uses 'Trick' fallback when currentTrickName is null (miss)", async () => {
      const game = { ...matchingGame, currentTrickName: null };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      await submitMatchAttempt("g1", null, false);

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

      await expect(submitMatchAttempt("g1", null, false)).rejects.toThrow(
        "Please wait before submitting another action",
      );
    });
  });
});
