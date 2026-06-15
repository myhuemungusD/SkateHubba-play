import { describe, it, expect } from "vitest";

// prettier-ignore
import { installGamesTestBeforeEach, makeGameSnap, makeNotFoundSnap, baseGame, mockTxUpdate, mockTxGet, mockTxSetCalls } from "./games.test-helpers";

import { forfeitExpiredTurn } from "../games";

/** Pull the in-tx "your_turn" notification writes out of the captured tx.set calls. */
function yourTurnNotifications(): Array<Record<string, unknown>> {
  return mockTxSetCalls.map((c) => c.data).filter((d) => d.type === "your_turn");
}

/** An already-expired turn deadline (1s in the past). */
const expiredDeadline = () => ({ toMillis: () => Date.now() - 1000 });

/** Expired disputable-phase game (matcher's landed call about to auto-accept). */
function disputableGame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...baseGame,
    phase: "disputable",
    currentSetter: "p1",
    currentTurn: "p1",
    currentTrickName: "Kickflip",
    currentTrickVideoUrl: "https://vid.url/set.webm",
    matchVideoUrl: "https://vid.url/match.webm",
    turnDeadline: expiredDeadline(),
    ...overrides,
  };
}

/** Expired setReview-phase game (set about to be ruled clean). */
function setReviewGame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...baseGame,
    phase: "setReview",
    currentSetter: "p1",
    currentTurn: "j1",
    currentTrickName: "Kickflip",
    currentTrickVideoUrl: "https://vid.url/set.webm",
    judgeId: "j1",
    judgeStatus: "accepted",
    turnDeadline: expiredDeadline(),
    ...overrides,
  };
}

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

      const result = await forfeitExpiredTurn("g1", "caller");
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

      const result = await forfeitExpiredTurn("g1", "caller");
      expect(result.forfeited).toBe(false);
      expect(mockTxUpdate).not.toHaveBeenCalled();
    });

    it("does not forfeit completed games", async () => {
      const game = { ...baseGame, status: "complete" };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1", "caller");
      expect(result.forfeited).toBe(false);
    });

    it("returns false for non-existent games", async () => {
      mockTxGet.mockResolvedValueOnce(makeNotFoundSnap());

      const result = await forfeitExpiredTurn("g1", "caller");
      expect(result.forfeited).toBe(false);
    });

    it("does not forfeit when turnDeadline is missing", async () => {
      const game = {
        ...baseGame,
        currentTurn: "p1",
        turnDeadline: null,
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1", "caller");
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

      const result = await forfeitExpiredTurn("g1", "caller");
      expect(result.forfeited).toBe(true);
      expect(result.winner).toBe("p1");
    });

    it("auto-accepts expired disputable phase (matcher's landed call stands)", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(disputableGame()));

      const result = await forfeitExpiredTurn("g1", "caller");
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

      const result = await forfeitExpiredTurn("g1", "caller");
      expect(result.disputeAutoAccepted).toBe(true);

      const updates = mockTxUpdate.mock.calls[0][1];
      const record = updates.turnHistory._arrayUnion[0];
      expect(record.trickName).toBe("Trick");
    });

    it("auto-accepts expired disputable when p2 is setter (covers p2 username ternary)", async () => {
      const game = disputableGame({ currentSetter: "p2", currentTurn: "p2", currentTrickName: "Heelflip" });
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1", "caller");
      expect(result.disputeAutoAccepted).toBe(true);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.currentSetter).toBe("p1"); // roles swap: p1 is matcher who landed
      const record = updates.turnHistory._arrayUnion[0];
      expect(record.setterUsername).toBe("bob"); // p2's username
      expect(record.matcherUsername).toBe("alice"); // p1's username
    });

    it("auto-clears expired setReview (benefit of doubt to setter)", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(setReviewGame()));

      const result = await forfeitExpiredTurn("g1", "caller");
      expect(result.forfeited).toBe(false);
      expect(result.setReviewAutoCleared).toBe(true);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("matching");
      expect(updates.currentTurn).toBe("p2"); // matcher
    });

    // Shared helper: seed an expired-deadline game, run forfeit, return the
    // captured update payload. Keeps the dup-detector happy and lets the two
    // forfeit-record assertions focus on the data they care about.
    async function runForfeitAndGetUpdates(game: Record<string, unknown>): Promise<Record<string, unknown>> {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));
      await forfeitExpiredTurn("g1", "caller");
      return mockTxUpdate.mock.calls[0][1] as Record<string, unknown>;
    }

    it("appends a final turnHistory record on plain forfeit (setting/matching)", async () => {
      // Regression: status/winner advanced on forfeit but turnHistory never
      // got the closing frame. The disputable / setReview branches append
      // their own records — the plain-forfeit path was the inconsistency.
      const updates = await runForfeitAndGetUpdates({
        ...baseGame,
        currentSetter: "p1",
        currentTurn: "p1",
        currentTrickName: "Kickflip",
        currentTrickVideoUrl: "https://vid.url/set.webm",
        matchVideoUrl: null,
        turnNumber: 4,
        turnDeadline: { toMillis: () => Date.now() - 1000 },
      });

      expect(updates.status).toBe("forfeit");
      expect(updates.winner).toBe("p2");
      const record = (updates.turnHistory as { _arrayUnion: Record<string, unknown>[] })._arrayUnion[0];
      expect(record.turnNumber).toBe(4);
      expect(record.trickName).toBe("Kickflip");
      expect(record.setterUid).toBe("p1");
      expect(record.setterUsername).toBe("alice");
      expect(record.matcherUid).toBe("p2");
      expect(record.matcherUsername).toBe("bob");
      expect(record.landed).toBe(false);
      // The forfeited player (currentTurn) is the loser → records the letter.
      expect(record.letterTo).toBe("p1");
      expect(record.judgedBy).toBeNull();
    });

    it("forfeit record falls back to 'Trick' when no trickName is set yet", async () => {
      const updates = await runForfeitAndGetUpdates({
        ...baseGame,
        currentSetter: "p2",
        currentTurn: "p2", // p2 forfeits while still in setting
        currentTrickName: null,
        currentTrickVideoUrl: null,
        matchVideoUrl: null,
        turnDeadline: { toMillis: () => Date.now() - 1000 },
      });

      const record = (updates.turnHistory as { _arrayUnion: Record<string, unknown>[] })._arrayUnion[0];
      expect(record.trickName).toBe("Trick");
      expect(record.setterUsername).toBe("bob");
      expect(record.matcherUsername).toBe("alice");
      expect(record.letterTo).toBe("p2");
    });

    it("does not auto-accept disputable when deadline is in the future", async () => {
      const game = {
        ...baseGame,
        phase: "disputable",
        currentTurn: "p1",
        turnDeadline: { toMillis: () => Date.now() + 86400000 },
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1", "caller");
      expect(result.forfeited).toBe(false);
      expect(result.disputeAutoAccepted).toBeUndefined();
      expect(mockTxUpdate).not.toHaveBeenCalled();
    });
  });

  // ── "your turn" notification side-effect on auto-resolve ──────────────────
  // The game-state write (turn advance) is identical regardless of caller; only
  // the notification is conditionally skipped when the caller IS the recipient,
  // because the /notifications create rule forbids a self-notify.
  describe("forfeitExpiredTurn — auto-resolve your_turn notification", () => {
    // Assert exactly one your_turn notification to the matcher (p2), authored by
    // `senderUid`. The sender MUST be the authenticated caller — never the
    // setter when the caller differs — so the /notifications create rule
    // (senderUid == request.auth.uid) accepts the write rather than aborting the
    // whole transaction. The recipient is always the matcher (p2).
    function expectOneMatcherNotification(senderUid: string): void {
      const notifs = yourTurnNotifications();
      expect(notifs).toHaveLength(1);
      expect(notifs[0]).toMatchObject({
        senderUid,
        recipientUid: "p2",
        type: "your_turn",
        read: false,
        gameId: "g1",
      });
    }

    it("disputeAccept: writes your_turn to the matcher when caller is not the recipient", async () => {
      // Recipient is the matcher (p2). Caller is p1 (the setter) → not the
      // recipient → notify. Caller == setter, so sender is p1 either way.
      mockTxGet.mockResolvedValueOnce(makeGameSnap(disputableGame()));

      const result = await forfeitExpiredTurn("g1", "p1");
      expect(result.disputeAutoAccepted).toBe(true);

      expectOneMatcherNotification("p1");
      // Game state still advanced correctly.
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("setting");
      expect(updates.currentSetter).toBe("p2");
    });

    it("disputeAccept: skips the notification when the caller IS the recipient, but still advances", async () => {
      // Caller is the matcher (p2) — the player being advanced. Self-notify is
      // forbidden by the rule, so no notification doc; game must still advance.
      mockTxGet.mockResolvedValueOnce(makeGameSnap(disputableGame()));

      const result = await forfeitExpiredTurn("g1", "p2");
      expect(result.disputeAutoAccepted).toBe(true);

      expect(yourTurnNotifications()).toHaveLength(0);
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("setting");
      expect(updates.currentSetter).toBe("p2"); // identical game-state write
      expect(updates.currentTurn).toBe("p2");
      expect(updates.turnNumber).toBe(2);
    });

    it("setReviewClear: writes your_turn to the matcher when caller is not the recipient", async () => {
      // Recipient is the matcher (p2). Caller is the setter p1 → notify.
      mockTxGet.mockResolvedValueOnce(makeGameSnap(setReviewGame()));

      const result = await forfeitExpiredTurn("g1", "p1");
      expect(result.setReviewAutoCleared).toBe(true);

      expectOneMatcherNotification("p1");
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("matching");
      expect(updates.currentTurn).toBe("p2");
    });

    // ── JUDGE-as-caller regression (the bug this PR fixes) ──────────────────
    // disputable/setReview phases have `currentTurn == judgeId`, so the judge's
    // own tab (or subscribeToMyGames, which includes judge games) triggers the
    // resolve with callerUid == judgeUid. The shared decision's canonical
    // sender is the setter (p1), but materializing that on the CLIENT would make
    // senderUid (p1) != auth.uid (j1) → the /notifications create rule DENIES it
    // → the ENTIRE runTransaction rolls back → the judged game never
    // auto-resolves on the client. The fix stamps senderUid = callerUid so the
    // create is rule-legal; the game-state advance is unconditional regardless.
    it("setReviewClear: judge-as-caller notifies the matcher with sender = judge (not setter)", async () => {
      // setReviewGame(): currentSetter "p1", currentTurn "j1" (judge), matcher p2.
      mockTxGet.mockResolvedValueOnce(makeGameSnap(setReviewGame()));

      const result = await forfeitExpiredTurn("g1", "j1");
      expect(result.setReviewAutoCleared).toBe(true);

      // (a) Game-state advance happened — UNCONDITIONALLY, never gated on the
      // notification. This is the corruption the bug caused: the whole tx aborted.
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("matching");
      expect(updates.currentTurn).toBe("p2");
      expect(updates.judgeReviewFor).toBeNull();

      // (b) Notification written with sender = the judge/caller (j1), NOT the
      // setter (p1), and recipient = the matcher (p2). It does NOT skip.
      expectOneMatcherNotification("j1");
    });

    it("disputeAccept: judge-as-caller notifies the matcher with sender = judge (not setter)", async () => {
      // A disputable game judged by j1: currentTurn is the judge, recipient is
      // the matcher (p2) who becomes next setter. Sender must be the caller j1.
      const game = disputableGame({ currentTurn: "j1", judgeId: "j1", judgeStatus: "accepted" });
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1", "j1");
      expect(result.disputeAutoAccepted).toBe(true);

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("setting");
      expect(updates.currentSetter).toBe("p2"); // matcher swaps in as setter

      expectOneMatcherNotification("j1");
    });

    it("setReviewClear: skips the notification when the caller IS the recipient, but still advances", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(setReviewGame()));

      const result = await forfeitExpiredTurn("g1", "p2");
      expect(result.setReviewAutoCleared).toBe(true);

      expect(yourTurnNotifications()).toHaveLength(0);
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.phase).toBe("matching");
      expect(updates.currentTurn).toBe("p2"); // identical game-state write
    });

    it("plain forfeit: never writes a your_turn notification (game ends)", async () => {
      const game = { ...baseGame, currentSetter: "p1", currentTurn: "p1", turnDeadline: expiredDeadline() };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(game));

      const result = await forfeitExpiredTurn("g1", "p2");
      expect(result.forfeited).toBe(true);
      expect(yourTurnNotifications()).toHaveLength(0);
    });

    it("notifies the away player when callerUid is null (no signed-in user)", async () => {
      // callerUid null ≠ recipient p2 → notification IS written (away player
      // gets alerted). Covers the null-caller branch of the guard.
      mockTxGet.mockResolvedValueOnce(makeGameSnap(disputableGame()));

      await forfeitExpiredTurn("g1", null);
      expect(yourTurnNotifications()).toHaveLength(1);
    });
  });
});
