import { describe, it, expect, vi } from "vitest";

// prettier-ignore
import { installGamesTestBeforeEach, makeGameSnap, makeNotFoundSnap, baseGame, mockTxUpdate, mockTxGet, mockTxSetCalls } from "./games.test-helpers";

import { setTrick, failSetTrick, submitMatchAttempt, acceptLanded, _turnActionMapSize } from "../games";
import { auth } from "../../firebase";
import { toGameDoc } from "../games.mappers";
import { decidePendingReviewExpiry, type DisputeGameUpdate } from "../dispute.resolution.shared";

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

    it("honor-system landed — FREEZES into pendingReview (no swap, no clip, review alert only)", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matchingGame));

      const result = await submitMatchAttempt("g1", "https://vid.url/match.webm", true);

      expect(result.gameOver).toBe(false);
      expect(result.winner).toBeNull();
      const updates = mockTxUpdate.mock.calls[0][1];
      // No judge → the claim FREEZES pending the setter's 24h accept/dispute.
      expect(updates.phase).toBe("pendingReview");
      expect(updates.reviewFor).toBe("p2"); // matcher
      expect(updates.reviewDeadline).toBeDefined();
      expect(updates.matchVideoUrl).toBe("https://vid.url/match.webm");
      // Roles/turn/letters/turnHistory stay pinned — nothing written for them.
      expect(updates.currentSetter).toBeUndefined();
      expect(updates.currentTurn).toBeUndefined();
      expect(updates.turnNumber).toBeUndefined();
      expect(updates.turnHistory).toBeUndefined();
      // The landed clip and the RESULT ("Trick Landed") notification are
      // DEFERRED to acceptLanded / resolution — nothing is written to the
      // feed here. The only in-tx write is the setter's review-window alert.
      expect(mockTxSetCalls).toHaveLength(1);
      const notif = mockTxSetCalls[0].data;
      expect(notif.recipientUid).toBe("p1"); // setter
      expect(notif.senderUid).toBe("p2"); // matcher
      expect(notif.type).toBe("your_turn");
      expect(notif.title).toBe("Land Claimed");
      expect(notif.body).toContain("@bob");
      expect(notif.gameId).toBe("g1");
      expect(notif.read).toBe(false);
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

    it("judge nominated but not accepted — still honor system, freezes to pendingReview", async () => {
      const pendingJudgeGame = { ...matchingGameWithJudge, judgeStatus: "pending" };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(pendingJudgeGame));

      await submitMatchAttempt("g1", "https://vid.url/match.webm", true);

      const updates = mockTxUpdate.mock.calls[0][1];
      // Pending judge doesn't activate the judge dispute path → honor freeze.
      expect(updates.phase).toBe("pendingReview");
      expect(updates.reviewFor).toBe("p2");
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

  describe("acceptLanded", () => {
    const pendingReviewGame = {
      ...baseGame,
      phase: "pendingReview",
      currentSetter: "p1",
      currentTurn: "p2",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://vid.url/set.webm",
      matchVideoUrl: "https://vid.url/match.webm",
      reviewFor: "p2",
    };

    function signIn(uid: string | null): void {
      (auth as unknown as { currentUser: { uid: string } | null }).currentUser = uid ? { uid } : null;
    }

    // Maps the SDK-agnostic decision to the game-doc key set acceptLanded must
    // persist: `*Ms` collapses to its Timestamp field, `appendTurnRecord` to
    // `turnHistory`, plus the caller-stamped `updatedAt`. Loop-driven (not a
    // hand-listed field map) so it derives the expected keys from whatever the
    // helper actually emits — a new or renamed helper field shifts this set.
    function expectedGameWriteKeys(update: DisputeGameUpdate): string[] {
      const rename: Record<string, string> = { turnDeadlineMs: "turnDeadline", appendTurnRecord: "turnHistory" };
      const keys = new Set<string>(["updatedAt"]);
      for (const [k, v] of Object.entries(update)) {
        if (v === undefined) continue;
        keys.add(rename[k] ?? k);
      }
      return [...keys].sort();
    }

    it("performs the deferred honor swap and writes the deferred clip + notification", async () => {
      signIn("p1"); // the frozen setter accepts
      mockTxGet.mockResolvedValueOnce(makeGameSnap(pendingReviewGame));

      await acceptLanded("g1");

      const updates = mockTxUpdate.mock.calls[0][1];
      // Deferred honor swap — identical net effect to the old instant swap:
      // matcher (p2) becomes setter, turn advances, no letter, review cleared.
      expect(updates).toMatchObject({
        phase: "setting",
        currentSetter: "p2",
        currentTurn: "p2",
        turnNumber: 2,
        p1Letters: 0,
        p2Letters: 0,
        reviewFor: null,
        reviewDeadline: null,
      });
      expect(updates.turnDeadline).toBeDefined();
      const record = updates.turnHistory._arrayUnion[0];
      expect(record).toMatchObject({
        turnNumber: 1,
        trickName: "Kickflip",
        setterUid: "p1",
        matcherUid: "p2",
        landed: true,
        letterTo: null,
      });

      // The deferred "Trick Landed" notification now fires — sender is the
      // setter (caller), recipient is the matcher (the no-self-notify rule).
      const notif = mockTxSetCalls.find((c) => (c.data as { title?: string }).title === "Trick Landed!");
      expect(notif?.data.senderUid).toBe("p1");
      expect(notif?.data.recipientUid).toBe("p2");
    });

    // PARITY GUARD: acceptLanded hand-assembles its tx.update from the shared
    // decidePendingReviewExpiry decision, exactly as the dispute referee does
    // via toAdminDisputeUpdate (see resolve-expired-disputes.parity.test.ts).
    // This locks the manual accept's game-doc write to the helper's output so
    // it can never silently drift from the timed auto-accept if the helper
    // gains or renames a field.
    it("writes exactly what decidePendingReviewExpiry produces (parity with the timed auto-accept)", async () => {
      const NOW = 1_700_000_000_000;
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(NOW);
      signIn("p1");
      const snap = makeGameSnap(pendingReviewGame);
      mockTxGet.mockResolvedValueOnce(snap);

      await acceptLanded("g1");

      // The SAME helper + nowMs the referee feeds through toAdminDisputeUpdate.
      const decision = decidePendingReviewExpiry(toGameDoc(snap), NOW);
      const updates = mockTxUpdate.mock.calls[0][1];

      // Key-set parity: acceptLanded writes no game-doc field the decision
      // omits, and drops none the decision yields (updatedAt is caller-stamped).
      // Derived generically from the decision, so a new/renamed field fails here.
      expect(Object.keys(updates).sort()).toEqual(expectedGameWriteKeys(decision));

      // Field-for-field: every persisted game-state value equals the decision's.
      expect(updates.phase).toBe(decision.phase);
      expect(updates.currentSetter).toBe(decision.currentSetter);
      expect(updates.currentTurn).toBe(decision.currentTurn);
      expect(updates.turnNumber).toBe(decision.turnNumber);
      expect(updates.p1Letters).toBe(decision.p1Letters);
      expect(updates.p2Letters).toBe(decision.p2Letters);
      expect(updates.reviewFor).toBe(decision.reviewFor);
      expect(updates.reviewDeadline).toBe(decision.reviewDeadline);
      // turnDeadline is the decision's *Ms materialized via the web SDK Timestamp.
      expect((updates.turnDeadline as { _ms: number })._ms).toBe(decision.turnDeadlineMs);
      // turnHistory is the decision's TurnRecord wrapped in the web SDK arrayUnion.
      expect(updates.turnHistory).toEqual({ _arrayUnion: [decision.appendTurnRecord] });

      nowSpy.mockRestore();
    });

    it("falls back to 'Trick' when the frozen trick name is null", async () => {
      signIn("p1");
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...pendingReviewGame, currentTrickName: null }));

      await acceptLanded("g1");

      const record = mockTxUpdate.mock.calls[0][1].turnHistory._arrayUnion[0];
      expect(record.trickName).toBe("Trick");
    });

    it("carries the game's spotId onto the deferred landed clips", async () => {
      signIn("p1");
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...pendingReviewGame, spotId: "spot-9" }));

      await acceptLanded("g1");

      const matchClip = mockTxSetCalls.find((c) => (c.data as { role?: string }).role === "match");
      expect(matchClip?.data.spotId).toBe("spot-9");
    });

    it("throws when nobody is signed in", async () => {
      signIn(null);
      await expect(acceptLanded("g1")).rejects.toThrow(/signed in/);
    });

    it("throws when the game is not found", async () => {
      signIn("p1");
      mockTxGet.mockResolvedValueOnce(makeNotFoundSnap());
      await expect(acceptLanded("g1")).rejects.toThrow("Game not found");
    });

    it("throws when the game is already over", async () => {
      signIn("p1");
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...pendingReviewGame, status: "complete" }));
      await expect(acceptLanded("g1")).rejects.toThrow("Game is already over");
    });

    it("throws when the game isn't in pendingReview", async () => {
      signIn("p1");
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...pendingReviewGame, phase: "matching" }));
      await expect(acceptLanded("g1")).rejects.toThrow("No landed claim is awaiting review");
    });

    it("throws when the caller isn't the frozen setter (matcher can't accept own claim)", async () => {
      signIn("p2");
      mockTxGet.mockResolvedValueOnce(makeGameSnap(pendingReviewGame));
      await expect(acceptLanded("g1")).rejects.toThrow("Only the setter can accept the landed claim");
    });

    it("throws when called again within the turn action cooldown period", async () => {
      signIn("p1");
      mockTxGet.mockResolvedValueOnce(makeGameSnap(pendingReviewGame));
      await acceptLanded("g1");

      await expect(acceptLanded("g1")).rejects.toThrow("Please wait before submitting another action");
    });
  });
});
