import { describe, it, expect } from "vitest";

import {
  installGamesTestBeforeEach,
  makeGameSnap,
  makeNotFoundSnap,
  baseGame,
  mockSetDoc,
  mockAddDoc,
  mockBatchCommit,
  mockBatchSet,
  mockTxUpdate,
  mockTxGet,
} from "./games.test-helpers";

import { createGame, acceptJudgeInvite, declineJudgeInvite } from "../games";

installGamesTestBeforeEach();

describe("games service", () => {
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
    // The `createGame` flow uses a client-generated deterministic id
    // (`doc(gamesRef()).id`) + `setDoc(doc(gamesRef(), id), data)` instead of
    // `addDoc`. That means `setDoc` is called twice:
    //   - call 0: writes the game doc
    //   - call 1: writes the lastGameCreatedAt field on the user profile
    // Notifications (opponent challenge, optional judge invite) now commit
    // through writeBatch — see writeNotification's H2 companion-write fix.
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
      // setDoc fires twice: the game write itself and the user profile merge
      // for `lastGameCreatedAt`. The challenge notification + its companion
      // notification_limits doc now ride a single writeBatch (H2 hardening),
      // so addDoc is no longer involved.
      expect(mockSetDoc).toHaveBeenCalledTimes(2);
      expect(mockAddDoc).not.toHaveBeenCalled();
      // The challenge notification → one writeBatch.commit() with two .set()s
      // (notification + companion notification_limits doc).
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
      expect(mockBatchSet).toHaveBeenCalledTimes(2);

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
      // setDoc: game write, user profile merge. (Notification + its
      // companion limit doc now go through writeBatch — see refactor.)
      expect(mockSetDoc).toHaveBeenCalledTimes(2);
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
});
