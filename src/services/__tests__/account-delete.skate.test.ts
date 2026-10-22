/**
 * Active S.K.A.T.E. games during account deletion (security audit
 * 2026-10-21, H4). An active game used to keep the deleted account's uid,
 * username and turn videos forever.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldPath: { documentId: () => ({ __fieldPath: "__name__" }) },
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}));

import { deleteUserDataAsAdmin } from "../../../api/account/_deleteUserData";
import { anonymizedSkateGame } from "../../../api/account/_skateErasure";
import { makeFakeStore, eventIndex } from "./account-delete.test-helpers";

const UID = "uidAlice0000000000000000001";
const OTHER = "uidBob000000000000000000002";
const JUDGE = "uidJudge0000000000000000003";
const URL = (gameId: string, turn: number, role: string, uid: string) =>
  `https://firebasestorage.googleapis.com/v0/b/b/o/games%2F${gameId}%2Fturn-${turn}%2F${role}-${uid}.webm?alt=media`;

function activeGame(): Record<string, unknown> {
  return {
    player1Uid: UID,
    player2Uid: OTHER,
    player1Username: "alice",
    player2Username: "bob",
    player1IsVerifiedPro: true,
    status: "active",
    currentTurn: OTHER,
    currentSetter: UID,
    currentTrickVideoUrl: URL("g1", 2, "set", UID),
    matchVideoUrl: null,
    p1Letters: 1,
    turnHistory: [
      {
        turnNumber: 1,
        setterUid: UID,
        setterUsername: "alice",
        matcherUid: OTHER,
        matcherUsername: "bob",
        setVideoUrl: URL("g1", 1, "set", UID),
        matchVideoUrl: URL("g1", 1, "match", OTHER),
        landed: false,
      },
    ],
  };
}

describe("active S.K.A.T.E. games on account deletion", () => {
  it("forfeits the game to the opponent and leaves no trace of the account in the doc", async () => {
    const store = makeFakeStore({ games: { g1: activeGame() } }, [
      `games/g1/turn-1/set-${UID}.webm`,
      `games/g1/turn-1/match-${OTHER}.webm`,
      `games/g1/turn-2/set-${UID}.webm`,
    ]);
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    const game = store.docs.get("games/g1") as Record<string, unknown>;
    expect(game).toMatchObject({
      status: "forfeit",
      winner: OTHER,
      player1Uid: "deleted-user",
      player1Username: "deleted skater",
      player1IsVerifiedPro: false,
      player2Uid: OTHER,
      player2Username: "bob",
      currentTrickVideoUrl: null,
    });
    const serialized = JSON.stringify(game);
    expect(serialized).not.toContain(UID);
    expect(serialized).not.toContain("alice");
    // The opponent's own video and link survive.
    expect((game.turnHistory as Record<string, unknown>[])[0]).toMatchObject({
      setterUsername: "deleted skater",
      setVideoUrl: null,
      matchVideoUrl: URL("g1", 1, "match", OTHER),
    });
    expect([...store.objects]).toEqual([`games/g1/turn-1/match-${OTHER}.webm`]);
    expect(summary.skateGamesForfeited).toBe(1);
    expect(summary.skateGamesAnonymized).toBe(1);
    expect(summary.gameVideoObjects).toBe(2);
  });

  it("deletes the account's videos BEFORE the doc stops naming it (so a retry can still find them)", async () => {
    const store = makeFakeStore({ games: { g1: activeGame() } }, [`games/g1/turn-1/set-${UID}.webm`]);
    await deleteUserDataAsAdmin(store.deps, UID);
    expect(eventIndex(store, "getFiles:games/g1/")).toBeLessThan(eventIndex(store, "tx:set:games/g1"));
  });

  it("deletes the game outright when the opponent already deleted their account", async () => {
    const game = { ...activeGame(), player2Uid: "deleted-user", player2Username: "deleted skater" };
    const store = makeFakeStore({ games: { g1: game } }, [
      `games/g1/turn-1/set-${UID}.webm`,
      "games/g1/turn-1/match-deleted.webm",
    ]);
    const summary = await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.docs.has("games/g1")).toBe(false);
    expect([...store.objects]).toEqual([]);
    expect(summary.games).toBe(1);
  });

  it("tombstones the account as judge in a game it did not play", async () => {
    const game = {
      ...activeGame(),
      player1Uid: OTHER,
      player2Uid: "uidCarol",
      judgeId: UID,
      judgeUsername: "alice",
      judgeStatus: "accepted",
    };
    const store = makeFakeStore({ games: { g2: game } });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);
    const kept = store.docs.get("games/g2") as Record<string, unknown>;
    expect(kept).toMatchObject({ judgeId: "deleted-user", judgeUsername: "deleted skater", status: "active" });
    expect(summary.skateGamesJudgedAnonymized).toBe(1);
  });

  it("is idempotent: a second run finds nothing left to do", async () => {
    const store = makeFakeStore({ games: { g1: activeGame() } });
    await deleteUserDataAsAdmin(store.deps, UID);
    const first = store.docs.get("games/g1");
    const summary = await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.docs.get("games/g1")).toEqual(first);
    expect(summary.skateGamesAnonymized).toBe(0);
  });

  it("unlinks a legacy (uid-less) setter video by role", () => {
    const out = anonymizedSkateGame(
      { ...activeGame(), currentTrickVideoUrl: "https://x/o/games%2Fg1%2Fturn-2%2Fset.webm" },
      UID,
    );
    expect(out.currentTrickVideoUrl).toBeNull();
  });

  it("leaves a JUDGE uid that is not the departing account untouched", () => {
    const out = anonymizedSkateGame({ ...activeGame(), judgeId: JUDGE, judgeUsername: "judy" }, UID);
    expect(out).toMatchObject({ judgeId: JUDGE, judgeUsername: "judy" });
  });

  it("keeps non-plain values (timestamps) and odd turn entries intact", () => {
    const when = new Date(0);
    const out = anonymizedSkateGame(
      { ...activeGame(), updatedAt: when, turnHistory: [null, "x", [UID]], tags: [`${UID}-tag`, "ok"] },
      UID,
    );
    expect(out.updatedAt).toBe(when);
    expect(out.turnHistory).toEqual([null, "x", ["deleted-user"]]);
    expect(out.tags).toEqual([null, "ok"]);
  });
});
