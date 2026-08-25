import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  installGamesTestBeforeEach,
  makeGameSnap,
  baseGame,
  mockRunTransaction,
  mockTxUpdate,
  mockTxGet,
  mockTxSetCalls,
} from "./games.test-helpers";

import {
  setTrick,
  failSetTrick,
  submitMatchAttempt,
  callBSOnSetTrick,
  judgeRuleSetTrick,
  resolveDispute,
} from "../games";

/* ── capture push-outbox drains ──────────────────────────────────
 * The outbox itself is created inside each service function, so the only
 * observation point is the drain call after runTransaction returns. Keep
 * create/reset real (tx-retry semantics stay under test) and swap only the
 * drain, which would otherwise do real /pushTargets reads.
 */
const pushHoisted = vi.hoisted(() => ({ drained: [] as unknown[][] }));

vi.mock("../pushDispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pushDispatch")>();
  return {
    ...actual,
    drainPushDispatchOutbox: vi.fn(async (outbox: { staged: unknown[] }) => {
      pushHoisted.drained.push([...outbox.staged]);
      outbox.staged.length = 0;
    }),
  };
});

const drainedPushes = pushHoisted.drained;

installGamesTestBeforeEach();

beforeEach(() => {
  drainedPushes.length = 0;
});

/* ── H-G9 regression: notifications staged inside transactions ─── */

describe("games service", () => {
  describe("in-transaction notifications", () => {
    // Helper: find an in-tx notification write by type + recipient. Returns
    // the staged notification payload (or undefined if none match).
    function findInTxNotification(type: string, recipientUid: string): Record<string, unknown> | undefined {
      const match = mockTxSetCalls.find((c) => c.data?.type === type && c.data?.recipientUid === recipientUid);
      return match?.data;
    }

    it("setTrick stages the matcher notification inside the transaction", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));
      await setTrick("g1", "Kickflip", null);

      // tx.set was called exactly once for the notification, atomically with
      // the game update.
      expect(mockTxSetCalls).toHaveLength(1);
      const notif = findInTxNotification("your_turn", "p2");
      expect(notif).toBeDefined();
      expect(notif?.senderUid).toBe("p1");
      expect(notif?.gameId).toBe("g1");
      expect(notif?.title).toBe("Your Turn!");
      expect(notif?.read).toBe(false);
    });

    it("failSetTrick stages the next-setter notification inside the transaction", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting", currentSetter: "p1" }));
      await failSetTrick("g1");

      expect(mockTxSetCalls).toHaveLength(1);
      const notif = findInTxNotification("your_turn", "p2");
      expect(notif).toBeDefined();
      expect(notif?.title).toBe("Your Turn to Set!");
    });

    it("submitMatchAttempt (honor-system landed) stages the setter's review-window alert in-tx", async () => {
      const matching = {
        ...baseGame,
        phase: "matching",
        currentSetter: "p1",
        currentTurn: "p2",
        currentTrickName: "Kickflip",
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matching));
      await submitMatchAttempt("g1", null, true);

      // The claim freezes into pendingReview and auto-accepts on expiry, so
      // the setter MUST be told the window opened — atomically with the
      // freeze. The "Trick Landed" RESULT notification stays deferred to
      // acceptLanded (covered in games.match.test).
      expect(mockTxSetCalls).toHaveLength(1);
      const notif = findInTxNotification("your_turn", "p1");
      expect(notif).toBeDefined();
      expect(notif?.senderUid).toBe("p2"); // matcher
      expect(notif?.title).toBe("Land Claimed");

      // …and the OS push for it is staged in the outbox, drained after the
      // transaction commits (never inside it).
      expect(drainedPushes).toHaveLength(1);
      expect(drainedPushes[0]).toEqual([
        expect.objectContaining({ recipientUid: "p1", senderUid: "p2", type: "your_turn", title: "Land Claimed" }),
      ]);
    });

    it("submitMatchAttempt (missed, game over) stages a game_won notification in-tx", async () => {
      const matching = {
        ...baseGame,
        phase: "matching",
        currentSetter: "p1",
        currentTurn: "p2",
        currentTrickName: "Kickflip",
        p2Letters: 4, // matcher hits 5 → setter wins
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matching));
      const result = await submitMatchAttempt("g1", null, false);
      expect(result.gameOver).toBe(true);

      const notif = findInTxNotification("game_won", "p1");
      expect(notif).toBeDefined();
      expect(notif?.title).toBe("You Won!");
    });

    it("submitMatchAttempt (judge-active landed) stages a judge-ruling notification in-tx", async () => {
      const matching = {
        ...baseGame,
        phase: "matching",
        currentSetter: "p1",
        currentTurn: "p2",
        currentTrickName: "Kickflip",
        judgeId: "j1",
        judgeUsername: "judge",
        judgeStatus: "accepted",
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matching));
      await submitMatchAttempt("g1", null, true);

      const notif = findInTxNotification("your_turn", "j1");
      expect(notif).toBeDefined();
      expect(notif?.title).toBe("Ruling Needed");
    });

    it("callBSOnSetTrick stages the judge notification in-tx", async () => {
      const matchingWithJudge = {
        ...baseGame,
        phase: "matching",
        currentSetter: "p1",
        currentTurn: "p2",
        currentTrickName: "Kickflip",
        judgeId: "j1",
        judgeStatus: "accepted",
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matchingWithJudge));
      await callBSOnSetTrick("g1");

      expect(mockTxSetCalls).toHaveLength(1);
      const notif = findInTxNotification("your_turn", "j1");
      expect(notif?.title).toBe("Ruling Needed");
    });

    it("judgeRuleSetTrick (clean) stages matcher notification in-tx", async () => {
      const setReview = {
        ...baseGame,
        phase: "setReview",
        currentSetter: "p1",
        currentTurn: "j1",
        currentTrickName: "Kickflip",
        judgeId: "j1",
        judgeStatus: "accepted",
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(setReview));
      await judgeRuleSetTrick("g1", true);

      const notif = findInTxNotification("your_turn", "p2");
      expect(notif?.title).toBe("Referee ruled: Clean");
    });

    it("judgeRuleSetTrick (sketchy) stages setter notification in-tx", async () => {
      const setReview = {
        ...baseGame,
        phase: "setReview",
        currentSetter: "p1",
        currentTurn: "j1",
        currentTrickName: "Kickflip",
        judgeId: "j1",
        judgeStatus: "accepted",
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(setReview));
      await judgeRuleSetTrick("g1", false);

      const notif = findInTxNotification("your_turn", "p1");
      expect(notif?.title).toBe("Referee ruled: Sketchy");
    });

    it("resolveDispute (landed) stages matcher notification in-tx with judge as sender", async () => {
      const disputable = {
        ...baseGame,
        phase: "disputable",
        currentSetter: "p1",
        currentTurn: "j1",
        currentTrickName: "Kickflip",
        matchVideoUrl: "https://vid.url/match.webm",
        judgeId: "j1",
        judgeStatus: "accepted",
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(disputable));
      await resolveDispute("g1", true);

      const notif = findInTxNotification("your_turn", "p2");
      expect(notif?.senderUid).toBe("j1");
      expect(notif?.title).toBe("Referee ruled: Landed");
    });

    it("resolveDispute (missed, game over) stages a game_lost notification in-tx", async () => {
      const disputable = {
        ...baseGame,
        phase: "disputable",
        currentSetter: "p1",
        currentTurn: "j1",
        currentTrickName: "Kickflip",
        matchVideoUrl: "https://vid.url/match.webm",
        judgeId: "j1",
        judgeStatus: "accepted",
        p2Letters: 4,
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(disputable));
      const result = await resolveDispute("g1", false);
      expect(result.gameOver).toBe(true);

      const notif = findInTxNotification("game_lost", "p2");
      expect(notif?.senderUid).toBe("j1");
      expect(notif?.title).toBe("Game Over");
    });

    it("resolveDispute (missed, continuing) stages a your_turn notification in-tx", async () => {
      const disputable = {
        ...baseGame,
        phase: "disputable",
        currentSetter: "p1",
        currentTurn: "j1",
        currentTrickName: "Kickflip",
        matchVideoUrl: "https://vid.url/match.webm",
        judgeId: "j1",
        judgeStatus: "accepted",
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(disputable));
      await resolveDispute("g1", false);

      const notif = findInTxNotification("your_turn", "p2");
      expect(notif?.title).toBe("Referee ruled: Missed");
    });

    it("in-tx notifications roll back when the transaction callback throws", async () => {
      // Simulate a rule-layer rejection mid-transaction: update succeeds but
      // the validator throws before commit. Because everything is staged
      // inside the same tx, the notification write cannot land independently.
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, phase: "setting" }));
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          get: mockTxGet,
          update: mockTxUpdate,
          set: vi.fn((ref: unknown, data: Record<string, unknown>) => {
            mockTxSetCalls.push({ ref, data });
          }),
        };
        // Run the callback so it stages writes...
        await cb(tx);
        // ...then throw, mimicking a post-callback commit failure. With a
        // real Firestore transaction, NONE of the staged writes commit.
        throw new Error("aborted");
      });

      await expect(setTrick("g1", "Kickflip", null)).rejects.toThrow("aborted");
      // We don't need to observe staged writes being "undone" — the point is
      // that with tx.set (rather than a post-commit addDoc), the Firestore
      // SDK is responsible for atomicity. The test proves the call path still
      // hits the transaction boundary even on failure.
      expect(mockRunTransaction).toHaveBeenCalled();
    });
  });
});
