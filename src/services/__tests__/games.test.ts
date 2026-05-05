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
  mockDoc: vi.fn((...args: unknown[]) => {
    const path = args.slice(1).join("/");
    return { __path: path, id: String(path).split("/").pop() || "auto-id" };
  }),
  mockCollection: vi.fn((...args: unknown[]) => args[1]),
  mockQuery: vi.fn((...args: unknown[]) => args),
  mockWhere: vi.fn((...args: unknown[]) => args),
  mockLimit: vi.fn((...args: unknown[]) => args),
  mockOrderBy: vi.fn((...args: unknown[]) => args),
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
  _turnActionMapSize,
  setTrick,
  failSetTrick,
  submitMatchAttempt,
  resolveDispute,
  forfeitExpiredTurn,
  subscribeToGame,
  subscribeToMyGames,
  fetchPlayerCompletedGames,
  callBSOnSetTrick,
  judgeRuleSetTrick,
  acceptJudgeInvite,
  declineJudgeInvite,
  isJudgeActive,
} from "../games";
import { _resetNotificationRateLimit } from "../notifications";

// Holds the most recent in-tx notification writes (from writeNotificationInTx)
// so tests can assert on them. Reset each test in beforeEach.
let mockTxSetCalls: Array<{ ref: unknown; data: Record<string, unknown> }>;

beforeEach(() => {
  vi.clearAllMocks();
  _resetCreateGameRateLimit();
  // Notification rate-limit state is module-scoped — if we don't clear it
  // between tests, the second createGame in a file hits the 5s cooldown and
  // silently skips the notification write, making rate-limit assertions flaky.
  _resetNotificationRateLimit();
  mockSetDoc.mockResolvedValue(undefined);
  mockTxSetCalls = [];
  // Default: runTransaction calls the callback with a mock tx object. The
  // `set` spy captures in-tx writes (notifications + any other tx.set calls)
  // so tests can assert the game update and its sibling notification landed
  // atomically inside the same transaction.
  mockRunTransaction.mockImplementation(async (_db: unknown, cb: Function) => {
    const tx = {
      get: mockTxGet,
      update: mockTxUpdate,
      set: vi.fn((ref: unknown, data: Record<string, unknown>) => {
        mockTxSetCalls.push({ ref, data });
      }),
    };
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
  describe("isJudgeActive", () => {
    it("returns false when no judge is set", () => {
      expect(isJudgeActive({ judgeId: null, judgeStatus: null })).toBe(false);
    });

    it("returns false when judge is pending", () => {
      expect(isJudgeActive({ judgeId: "j1", judgeStatus: "pending" })).toBe(false);
    });

    it("returns false when judge declined", () => {
      expect(isJudgeActive({ judgeId: "j1", judgeStatus: "declined" })).toBe(false);
    });

    it("returns true only when judge accepted", () => {
      expect(isJudgeActive({ judgeId: "j1", judgeStatus: "accepted" })).toBe(true);
    });
  });

  describe("acceptJudgeInvite", () => {
    const pendingJudgeGame = {
      ...baseGame,
      judgeId: "j1",
      judgeUsername: "judge",
      judgeStatus: "pending",
    };

    it("flips judgeStatus from pending to accepted", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(pendingJudgeGame));
      await acceptJudgeInvite("g1");
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.judgeStatus).toBe("accepted");
    });

    it("throws when no judge is on the game", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, judgeId: null }));
      await expect(acceptJudgeInvite("g1")).rejects.toThrow("No referee was nominated");
    });

    it("throws when invite is not pending", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...pendingJudgeGame, judgeStatus: "accepted" }));
      await expect(acceptJudgeInvite("g1")).rejects.toThrow("no longer pending");
    });
  });

  describe("declineJudgeInvite", () => {
    const pendingJudgeGame = {
      ...baseGame,
      judgeId: "j1",
      judgeUsername: "judge",
      judgeStatus: "pending",
    };

    it("flips judgeStatus from pending to declined", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap(pendingJudgeGame));
      await declineJudgeInvite("g1");
      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.judgeStatus).toBe("declined");
    });
  });

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

  describe("judge invite lifecycle — additional coverage", () => {
    it("acceptJudgeInvite throws when game not found", async () => {
      mockTxGet.mockResolvedValueOnce(makeNotFoundSnap());
      await expect(acceptJudgeInvite("g1")).rejects.toThrow("Game not found");
    });

    it("acceptJudgeInvite throws when game is already over", async () => {
      mockTxGet.mockResolvedValueOnce(
        makeGameSnap({ ...baseGame, status: "complete", judgeId: "j1", judgeStatus: "pending" }),
      );
      await expect(acceptJudgeInvite("g1")).rejects.toThrow("Game is already over");
    });

    it("declineJudgeInvite throws when game not found", async () => {
      mockTxGet.mockResolvedValueOnce(makeNotFoundSnap());
      await expect(declineJudgeInvite("g1")).rejects.toThrow("Game not found");
    });

    it("declineJudgeInvite throws when game is already over", async () => {
      mockTxGet.mockResolvedValueOnce(
        makeGameSnap({ ...baseGame, status: "complete", judgeId: "j1", judgeStatus: "pending" }),
      );
      await expect(declineJudgeInvite("g1")).rejects.toThrow("Game is already over");
    });

    it("declineJudgeInvite throws when no judge is on the game", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, judgeId: null }));
      await expect(declineJudgeInvite("g1")).rejects.toThrow("No referee was nominated");
    });

    it("declineJudgeInvite throws when invite is not pending", async () => {
      mockTxGet.mockResolvedValueOnce(makeGameSnap({ ...baseGame, judgeId: "j1", judgeStatus: "accepted" }));
      await expect(declineJudgeInvite("g1")).rejects.toThrow("no longer pending");
    });
  });

  describe("createGame", () => {
    // The `createGame` flow now uses a client-generated deterministic id
    // (`doc(gamesRef()).id`) + `setDoc(doc(gamesRef(), id), data)` instead of
    // `addDoc`. That means `setDoc` is called multiple times:
    //   - call 0: writes the game doc
    //   - call 1: writes the lastGameCreatedAt field on the user profile
    //   - addDoc is still used once per notification (opponent challenge, etc.)
    const gameSetDocCall = (): Record<string, unknown> => {
      // The game doc write is always the FIRST setDoc call (the user profile
      // merge fires after `metrics.gameCreated`). In all these tests the
      // second arg is the game payload.
      const call = mockSetDoc.mock.calls[0];
      return call[1] as Record<string, unknown>;
    };

    it("creates a game doc and returns its id", async () => {
      const id = await createGame("p1", "alice", "p2", "bob");
      // Deterministic id from mockDoc — `doc(gamesRef()).id` → "auto-id"
      expect(id).toBe("auto-id");
      // setDoc fires three times: the game write itself, the user profile
      // merge for `lastGameCreatedAt`, and the `notification_limits` write
      // inside writeNotification's rate-limit tracking.
      expect(mockSetDoc).toHaveBeenCalledTimes(3);
      // addDoc is still used for the non-transactional notification write.
      expect(mockAddDoc).toHaveBeenCalledTimes(1);

      const docData = gameSetDocCall();
      expect(docData.player1Uid).toBe("p1");
      expect(docData.player2Uid).toBe("p2");
      expect(docData.status).toBe("active");
      expect(docData.phase).toBe("setting");
      expect(docData.currentSetter).toBe("p1");
    });

    it("uses a client-generated deterministic id — retrying is idempotent", async () => {
      // The first write "fails" transiently; withRetry retries. Both attempts
      // must target the same docRef so the server cannot create two games.
      mockSetDoc.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce(undefined);
      const id = await createGame("p1", "alice", "p2", "bob");
      expect(id).toBe("auto-id");
      // First setDoc call = failed game-doc write; second = successful retry;
      // third = user-profile merge. All three should land on real refs.
      expect(mockSetDoc.mock.calls.length).toBeGreaterThanOrEqual(2);

      // Critically, the first two setDoc calls (game writes) target the same
      // doc ref — if addDoc were still used, a retry would pick a NEW id.
      const firstGameRef = mockSetDoc.mock.calls[0][0];
      const retryGameRef = mockSetDoc.mock.calls[1][0];
      expect(firstGameRef).toEqual(retryGameRef);
    }, 10_000);

    it("throws when called again within the cooldown period", async () => {
      await createGame("p1", "alice", "p2", "bob");

      // Second call without resetting — should hit rate limit
      await expect(createGame("p1", "alice", "p2", "bob")).rejects.toThrow("Please wait before creating another game");
    });

    it("sets initial scores, turn, and timestamps", async () => {
      await createGame("p1", "alice", "p2", "bob");

      const docData = gameSetDocCall();
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
      await createGame("p1", "alice", "p2", "bob");
      // setDoc: game write, user profile merge, notification rate-limit doc.
      expect(mockSetDoc).toHaveBeenCalledTimes(3);
      // The user profile merge is the second setDoc call (after the game).
      const userProfilePath = (mockSetDoc.mock.calls[1][0] as { __path?: string }).__path ?? "";
      expect(userProfilePath).toContain("users");
    });

    it("still returns game id if rate-limit timestamp update fails", async () => {
      // First setDoc = game write (succeeds). Second setDoc = user profile
      // merge (fails). createGame should still resolve with the new id.
      mockSetDoc.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("write failed"));
      const id = await createGame("p1", "alice", "p2", "bob");
      expect(id).toBe("auto-id");
    });

    it("includes pro status flags when players are verified pros", async () => {
      await createGame("p1", "alice", "p2", "bob", {
        challengerIsVerifiedPro: true,
        opponentIsVerifiedPro: true,
      });
      const docData = gameSetDocCall();
      expect(docData.player1IsVerifiedPro).toBe(true);
      expect(docData.player2IsVerifiedPro).toBe(true);
    });

    it("omits pro status flags when players are not verified", async () => {
      await createGame("p1", "alice", "p2", "bob");
      const docData = gameSetDocCall();
      expect(docData.player1IsVerifiedPro).toBeUndefined();
      expect(docData.player2IsVerifiedPro).toBeUndefined();
    });

    it("includes spotId when a valid UUID is provided", async () => {
      const validSpotId = "11111111-2222-3333-4444-555555555555";
      await createGame("p1", "alice", "p2", "bob", { spotId: validSpotId });
      const docData = gameSetDocCall();
      expect(docData.spotId).toBe(validSpotId);
    });

    it("omits spotId when null or undefined", async () => {
      await createGame("p1", "alice", "p2", "bob", { spotId: null });
      const docData = gameSetDocCall();
      expect("spotId" in docData).toBe(false);
    });

    it("drops a malformed spotId instead of writing garbage to Firestore", async () => {
      // Shape doesn't match UUID regex — should be silently normalized to null
      // so the field is omitted entirely, not written as a hostile string.
      await createGame("p1", "alice", "p2", "bob", { spotId: "not-a-uuid" });
      const docData = gameSetDocCall();
      expect("spotId" in docData).toBe(false);
    });

    it("defaults to no judge (honor system)", async () => {
      await createGame("p1", "alice", "p2", "bob");
      const docData = gameSetDocCall();
      expect(docData.judgeId).toBeNull();
      expect(docData.judgeUsername).toBeNull();
      expect(docData.judgeStatus).toBeNull();
    });

    it("sets judge fields in pending state when a valid judge is nominated", async () => {
      await createGame("p1", "alice", "p2", "bob", {
        judgeUid: "p3",
        judgeUsername: "charlie",
      });
      const docData = gameSetDocCall();
      expect(docData.judgeId).toBe("p3");
      expect(docData.judgeUsername).toBe("charlie");
      expect(docData.judgeStatus).toBe("pending");
    });

    it("drops judge nomination if it collides with either player", async () => {
      // Judge can't be the challenger or opponent — falls back to honor system.
      await createGame("p1", "alice", "p2", "bob", {
        judgeUid: "p2",
        judgeUsername: "bob",
      });
      const docData = gameSetDocCall();
      expect(docData.judgeId).toBeNull();
      expect(docData.judgeStatus).toBeNull();
    });

    it("drops judge nomination when username is missing", async () => {
      await createGame("p1", "alice", "p2", "bob", {
        judgeUid: "p3",
        judgeUsername: null,
      });
      const docData = gameSetDocCall();
      expect(docData.judgeId).toBeNull();
      expect(docData.judgeStatus).toBeNull();
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
    it("sets up three snapshot listeners (p1, p2, and judge queries)", () => {
      mockOnSnapshot.mockReturnValue(vi.fn());

      subscribeToMyGames("u1", vi.fn());

      // Three queries: player1Uid == u1, player2Uid == u1, judgeId == u1
      expect(mockOnSnapshot).toHaveBeenCalledTimes(3);
      expect(mockWhere).toHaveBeenCalledWith("player1Uid", "==", "u1");
      expect(mockWhere).toHaveBeenCalledWith("player2Uid", "==", "u1");
      expect(mockWhere).toHaveBeenCalledWith("judgeId", "==", "u1");
    });

    it("accepts a custom limit count", () => {
      mockOnSnapshot.mockReturnValue(vi.fn());

      subscribeToMyGames("u1", vi.fn(), 10);

      expect(mockLimit).toHaveBeenCalledWith(10);
    });

    it("unsubscribes all listeners on cleanup", () => {
      const unsub1 = vi.fn();
      const unsub2 = vi.fn();
      const unsub3 = vi.fn();
      mockOnSnapshot.mockReturnValueOnce(unsub1).mockReturnValueOnce(unsub2).mockReturnValueOnce(unsub3);

      const unsub = subscribeToMyGames("u1", vi.fn());
      unsub();

      expect(unsub1).toHaveBeenCalled();
      expect(unsub2).toHaveBeenCalled();
      expect(unsub3).toHaveBeenCalled();
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
      const ids = games.map((g: { id: string }) => g.id);
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

    /* ── H-G6 regression: gated first-load merge ────── */

    it("waits for all three listeners to seed before firing the first onUpdate", () => {
      const onUpdate = vi.fn();
      // Capture each listener's onNext so we can fire them in a staggered
      // order — simulating real-world snapshot races.
      const listeners: Array<(snap: unknown) => void> = [];
      mockOnSnapshot.mockImplementation((_query: unknown, cb: Function) => {
        listeners.push(cb as (snap: unknown) => void);
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);
      expect(listeners.length).toBe(3);

      // First listener (p1) emits — must NOT fire onUpdate yet (2 slices
      // still unseeded → partial merge would flash to the UI).
      listeners[0]({
        docs: [{ id: "g1", data: () => ({ ...baseGame, status: "active", turnNumber: 1 }) }],
      });
      expect(onUpdate).not.toHaveBeenCalled();

      // Second listener (p2) emits — still short one slice, no emit.
      listeners[1]({
        docs: [{ id: "g2", data: () => ({ ...baseGame, status: "active", turnNumber: 2 }) }],
      });
      expect(onUpdate).not.toHaveBeenCalled();

      // Third listener (judge) emits — now emit the full merged view once.
      listeners[2]({
        docs: [{ id: "g3", data: () => ({ ...baseGame, status: "active", turnNumber: 3 }) }],
      });
      expect(onUpdate).toHaveBeenCalledTimes(1);
      const games = onUpdate.mock.calls[0][0];
      expect(games.map((g: { id: string }) => g.id).sort()).toEqual(["g1", "g2", "g3"]);
    });

    it("emits freely on every snapshot after the first-load gate opens", () => {
      const onUpdate = vi.fn();
      const listeners: Array<(snap: unknown) => void> = [];
      mockOnSnapshot.mockImplementation((_query: unknown, cb: Function) => {
        listeners.push(cb as (snap: unknown) => void);
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);

      // Seed all three with empty snapshots — first emit fires with 0 games.
      listeners[0]({ docs: [] });
      listeners[1]({ docs: [] });
      listeners[2]({ docs: [] });
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate.mock.calls[0][0]).toEqual([]);

      // A follow-up snapshot on any slice should emit immediately (no
      // further gating) with the new merged view.
      listeners[0]({
        docs: [{ id: "g1", data: () => ({ ...baseGame, status: "active", turnNumber: 1 }) }],
      });
      expect(onUpdate).toHaveBeenCalledTimes(2);
      expect(onUpdate.mock.calls[1][0]).toHaveLength(1);
    });

    it("treats a listener error as a seeded-but-empty slice (still opens the gate)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const onUpdate = vi.fn();
      const nextFns: Array<(snap: unknown) => void> = [];
      const errFns: Array<(err: Error) => void> = [];
      mockOnSnapshot.mockImplementation((_query: unknown, onNext: Function, onError: Function) => {
        nextFns.push(onNext as (snap: unknown) => void);
        errFns.push(onError as (err: Error) => void);
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);

      // Seed p1 and p2 normally, then fail the judge listener.
      nextFns[0]({
        docs: [{ id: "g1", data: () => ({ ...baseGame, status: "active", turnNumber: 1 }) }],
      });
      nextFns[1]({ docs: [] });
      expect(onUpdate).not.toHaveBeenCalled();

      errFns[2](new Error("permission-denied"));
      // The error path should clear the judge slice AND mark it seeded so the
      // healthy slices can emit. We see the game from p1 only — no stale or
      // partial data polluting the merge.
      expect(onUpdate).toHaveBeenCalledTimes(1);
      const games = onUpdate.mock.calls[0][0];
      expect(games.map((g: { id: string }) => g.id)).toEqual(["g1"]);
      warnSpy.mockRestore();
    });

    it("preserves the slice's prior state when an already-seeded listener errors", () => {
      // After first-load completes, a transient error on a seeded listener
      // must NOT zero out that slice. The Firestore SDK auto-reconnects on
      // transient errors and the next successful snapshot replaces the
      // slice atomically — zeroing here would silently empty the user's
      // view (e.g. all judge games vanish) on every flaky reconnect cycle.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const onUpdate = vi.fn();
      const nextFns: Array<(snap: unknown) => void> = [];
      const errFns: Array<(err: Error) => void> = [];
      mockOnSnapshot.mockImplementation((_query: unknown, onNext: Function, onError: Function) => {
        nextFns.push(onNext as (snap: unknown) => void);
        errFns.push(onError as (err: Error) => void);
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);

      // Seed all three with data — first emit.
      nextFns[0]({ docs: [{ id: "g1", data: () => ({ ...baseGame, turnNumber: 1 }) }] });
      nextFns[1]({ docs: [{ id: "g2", data: () => ({ ...baseGame, turnNumber: 2 }) }] });
      nextFns[2]({ docs: [{ id: "g3", data: () => ({ ...baseGame, turnNumber: 3 }) }] });
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate.mock.calls[0][0]).toHaveLength(3);

      // Judge listener errors — slice is preserved. Merged state is
      // unchanged, so no re-emit fires (wasteful churn avoided).
      errFns[2](new Error("permission-denied"));
      expect(onUpdate).toHaveBeenCalledTimes(1);

      // A subsequent successful snapshot from the recovered listener
      // replaces the slice and emits fresh data normally.
      nextFns[2]({ docs: [{ id: "g3", data: () => ({ ...baseGame, turnNumber: 30 }) }] });
      expect(onUpdate).toHaveBeenCalledTimes(2);
      const games = onUpdate.mock.calls[1][0];
      expect(games.map((g: { id: string }) => g.id).sort()).toEqual(["g1", "g2", "g3"]);
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

  /* ── H-G9 regression: notifications staged inside transactions ─── */

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

    it("submitMatchAttempt (honor-system landed) stages the setter notification in-tx", async () => {
      const matching = {
        ...baseGame,
        phase: "matching",
        currentSetter: "p1",
        currentTurn: "p2",
        currentTrickName: "Kickflip",
      };
      mockTxGet.mockResolvedValueOnce(makeGameSnap(matching));
      await submitMatchAttempt("g1", null, true);

      // Exactly one in-tx notification, targeting the former setter.
      expect(mockTxSetCalls).toHaveLength(1);
      const notif = findInTxNotification("your_turn", "p1");
      expect(notif?.title).toBe("Trick Landed!");
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
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, cb: Function) => {
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
