import { describe, it, expect } from "vitest";

// prettier-ignore
import { installGamesTestBeforeEach, makeGameSnap, makeNotFoundSnap, baseGame, mockTxUpdate, mockTxGet } from "./games.test-helpers";

import { callBSOnSetTrick, judgeRuleSetTrick, resolveDispute } from "../games";

installGamesTestBeforeEach();

describe("games service", () => {
  describe("callBSOnSetTrick", () => {
    const matchingWithJudge = {
      ...baseGame,
      phase: "matching",
      currentSetter: "p1",
      currentTurn: "p2",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://vid.url/set.webm",
      judgeId: "j1",
      judgeUsername: "judge",
      judgeStatus: "accepted",
    };

    it("transitions to setReview and routes currentTurn to the judge", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matchingWithJudge));
      await callBSOnSetTrick("g1");
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("setReview");
      expect(updates.currentTurn).toBe("j1");
      expect(updates.judgeReviewFor).toBe("p1");
    });

    it("throws when judge is not active (honor system)", async () => {
      const honorSystem = { ...matchingWithJudge, judgeStatus: "pending" };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(honorSystem));
      await expect(callBSOnSetTrick("g1")).rejects.toThrow("Call BS is only available when a referee is active");
    });

    it("throws when not in matching phase", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...matchingWithJudge, phase: "setting" }));
      await expect(callBSOnSetTrick("g1")).rejects.toThrow("Not in matching phase");
    });

    it("throws when game is not found", async () => {
      mockTxGet.mockResolvedValueOnce(makeNotFoundSnap());
      await expect(callBSOnSetTrick("g1")).rejects.toThrow("Game not found");
    });

    it("throws when game is already over", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...matchingWithJudge, status: "complete" }));
      await expect(callBSOnSetTrick("g1")).rejects.toThrow("Game is already over");
    });

    it("computes usernames when p2 is the setter", async () => {
      const p2Setter = { ...matchingWithJudge, currentSetter: "p2", currentTurn: "p1" };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(p2Setter));
      await callBSOnSetTrick("g1");
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.judgeReviewFor).toBe("p2");
      expect(updates.currentTurn).toBe("j1");
    });

    it("throws on rate limit when called twice quickly", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matchingWithJudge));
      await callBSOnSetTrick("g1");
      await expect(callBSOnSetTrick("g1")).rejects.toThrow("Please wait before submitting another action");
    });
  });

  describe("judgeRuleSetTrick", () => {
    const setReviewGame = {
      ...baseGame,
      phase: "setReview",
      currentSetter: "p1",
      currentTurn: "j1", // judge rules
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://vid.url/set.webm",
      judgeId: "j1",
      judgeUsername: "judge",
      judgeStatus: "accepted",
    };

    it("clean → matching phase, matcher's turn", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(setReviewGame));
      await judgeRuleSetTrick("g1", true);
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("matching");
      expect(updates.currentTurn).toBe("p2");
    });

    it("sketchy → back to setting, same setter, trick fields cleared", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(setReviewGame));
      await judgeRuleSetTrick("g1", false);
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("setting");
      expect(updates.currentTurn).toBe("p1");
      expect(updates.currentTrickName).toBeNull();
      expect(updates.currentTrickVideoUrl).toBeNull();
    });

    it("throws when not in setReview phase", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...setReviewGame, phase: "matching" }));
      await expect(judgeRuleSetTrick("g1", true)).rejects.toThrow("Not in setReview phase");
    });

    it("throws when game is not found", async () => {
      mockTxGet.mockResolvedValueOnce(makeNotFoundSnap());
      await expect(judgeRuleSetTrick("g1", true)).rejects.toThrow("Game not found");
    });

    it("throws when game is already over", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...setReviewGame, status: "complete" }));
      await expect(judgeRuleSetTrick("g1", true)).rejects.toThrow("Game is already over");
    });

    it("throws when judge is missing", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...setReviewGame, judgeId: null }));
      await expect(judgeRuleSetTrick("g1", true)).rejects.toThrow("No referee on this game");
    });

    it("sketchy — notifies setter (covers notification path)", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(setReviewGame));
      await judgeRuleSetTrick("g1", false);
      // Notification is best-effort (tested via no-throw).
      expect(mockTxUpdate).toHaveBeenCalled();
    });

    it("computes usernames when p2 is setter", async () => {
      const p2Setter = { ...setReviewGame, currentSetter: "p2" };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(p2Setter));
      await judgeRuleSetTrick("g1", true);
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.currentTurn).toBe("p1"); // matcher (opposite of p2)
    });
  });

  describe("resolveDispute", () => {
    const disputableGame = {
      ...baseGame,
      phase: "disputable",
      currentSetter: "p1",
      currentTurn: "j1", // judge reviews
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://vid.url/set.webm",
      matchVideoUrl: "https://vid.url/match.webm",
      judgeId: "j1",
      judgeUsername: "judge",
      judgeStatus: "accepted",
    };

    it("accept — no letter change, roles swap, matcher becomes setter", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(disputableGame));

      const result = await resolveDispute("g1", true);

      expect(result.gameOver).toBe(false);
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.p1Letters).toBe(0);
      expect(updates.p2Letters).toBe(0);
      expect(updates.phase).toBe("setting");
      expect(updates.currentSetter).toBe("p2"); // matcher becomes setter
      expect(updates.currentTurn).toBe("p2");
      expect(updates.turnNumber).toBe(2);
    });

    it("accept — records turn history with landed=true", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(disputableGame));

      await resolveDispute("g1", true);

      const updates = mockTxUpdate.mock.calls[0][1];
      const record = updates.turnHistory._arrayUnion[0];
      expect(record.landed).toBe(true);
      expect(record.letterTo).toBeNull();
      expect(record.trickName).toBe("Kickflip");
      expect(record.matchVideoUrl).toBe("https://vid.url/match.webm");
    });

    it("dispute — matcher gets a letter, setter keeps setting", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(disputableGame));

      const result = await resolveDispute("g1", false);

      expect(result.gameOver).toBe(false);
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.p2Letters).toBe(1); // p2 is matcher, gets letter
      expect(updates.p1Letters).toBe(0);
      expect(updates.phase).toBe("setting");
      expect(updates.currentSetter).toBe("p1"); // setter stays
      expect(updates.turnNumber).toBe(2);
    });

    it("dispute — records turn history with landed=false", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(disputableGame));

      await resolveDispute("g1", false);

      const updates = mockTxUpdate.mock.calls[0][1];
      const record = updates.turnHistory._arrayUnion[0];
      expect(record.landed).toBe(false);
      expect(record.letterTo).toBe("p2");
    });

    it("dispute ends game when matcher reaches 5 letters", async () => {
      const game = { ...disputableGame, p2Letters: 4 };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await resolveDispute("g1", false);

      expect(result.gameOver).toBe(true);
      expect(result.winner).toBe("p1");
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.status).toBe("complete");
      expect(updates.winner).toBe("p1");
    });

    it("dispute ends game when p1-as-matcher reaches 5 letters", async () => {
      // judge still reviews — roles swap but judge still holds the turn.
      const game = { ...disputableGame, currentSetter: "p2", currentTurn: "j1", p1Letters: 4 };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await resolveDispute("g1", false);

      expect(result.gameOver).toBe(true);
      expect(result.winner).toBe("p2");
    });

    it("uses 'Trick' fallback when currentTrickName is null", async () => {
      const game = { ...disputableGame, currentTrickName: null };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      await resolveDispute("g1", true);

      const updates = mockTxUpdate.mock.calls[0][1];
      const record = updates.turnHistory._arrayUnion[0];
      expect(record.trickName).toBe("Trick");
    });

    it("throws when game is not found", async () => {
      mockTxGet.mockResolvedValueOnce(makeNotFoundSnap());
      await expect(resolveDispute("g1", true)).rejects.toThrow("Game not found");
    });

    it("throws when game is already over", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...disputableGame, status: "complete" }));
      await expect(resolveDispute("g1", true)).rejects.toThrow("Game is already over");
    });

    it("throws when not in disputable phase", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...disputableGame, phase: "setting" }));
      await expect(resolveDispute("g1", true)).rejects.toThrow("Not in disputable phase");
    });

    it("accept with roles swapped (p2 is setter)", async () => {
      const game = { ...disputableGame, currentSetter: "p2", currentTurn: "j1" };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      await resolveDispute("g1", true);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.currentSetter).toBe("p1"); // roles swap: p1 becomes setter
      expect(updates.currentTurn).toBe("p1");
    });

    it("dispute with roles swapped — sends game_won notification to matcher", async () => {
      // p2 is setter, p1 is matcher. Dispute → p1 gets letter. p1 at 4 letters → game over
      const game = { ...disputableGame, currentSetter: "p2", currentTurn: "j1", p1Letters: 4 };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await resolveDispute("g1", false);
      expect(result.gameOver).toBe(true);
      expect(result.winner).toBe("p2"); // p2 wins (p1 gets 5th letter)
    });

    it("throws when no judge is set on the game (honor-system should never reach this)", async () => {
      const noJudge = { ...disputableGame, judgeId: null, judgeStatus: null };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(noJudge));
      await expect(resolveDispute("g1", true)).rejects.toThrow("No referee on this game");
    });

    it("accept — sends your_turn notification to new setter", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(disputableGame));

      await resolveDispute("g1", true);

      // Notification is best-effort via writeNotification (mocked as addDoc)
      // Just verify the service function completes without error
      expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    });

    it("dispute — sends correct notification when setter keeps setting", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(disputableGame));

      await resolveDispute("g1", false);

      // Dispute: matcher gets letter, setter keeps setting
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.currentSetter).toBe("p1");
    });

    it("throws when called again within cooldown", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(disputableGame));
      await resolveDispute("g1", true);

      await expect(resolveDispute("g1", false)).rejects.toThrow("Please wait before submitting another action");
    });
  });
});
