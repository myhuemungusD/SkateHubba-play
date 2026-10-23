import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import type { GameDoc } from "../../../services/games";
import { recentOpponents } from "../recentOpponents";

const at = (ms: number) => Timestamp.fromMillis(ms);

function game(o: Partial<GameDoc>): GameDoc {
  return {
    id: "g",
    player1Uid: "me",
    player2Uid: "u2",
    player1Username: "me",
    player2Username: "rival",
    p1Letters: 0,
    p2Letters: 0,
    status: "complete",
    currentTurn: "me",
    phase: "setting",
    currentSetter: "me",
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: at(0),
    turnNumber: 1,
    winner: null,
    createdAt: null,
    updatedAt: null,
    ...o,
  } as GameDoc;
}

describe("recentOpponents", () => {
  it("returns nothing for no games", () => {
    expect(recentOpponents([], "me")).toEqual([]);
  });

  it("groups by opponent, counts games and sorts most recent first", () => {
    const rows = recentOpponents(
      [
        game({ id: "a", player2Uid: "u2", player2Username: "rival", updatedAt: at(1_000) }),
        game({ id: "b", player2Uid: "u3", player2Username: "kid", updatedAt: at(5_000) }),
        game({ id: "c", player2Uid: "u2", player2Username: "rival", updatedAt: at(3_000) }),
      ],
      "me",
    );
    expect(rows.map((r) => [r.uid, r.games, r.lastPlayedMs])).toEqual([
      ["u3", 1, 5_000],
      ["u2", 2, 3_000],
    ]);
  });

  it("reads the opponent from either seat and keeps their newest handle", () => {
    const rows = recentOpponents(
      [
        game({
          player1Uid: "u9",
          player1Username: "oldname",
          player2Uid: "me",
          player2Username: "me",
          createdAt: at(10),
        }),
        game({
          player1Uid: "u9",
          player1Username: "newname",
          player2Uid: "me",
          player2Username: "me",
          createdAt: at(20),
        }),
        game({ player1Uid: "u9", player1Username: "older", player2Uid: "me", player2Username: "me", createdAt: at(5) }),
      ],
      "me",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ uid: "u9", username: "newname", games: 3, lastPlayedMs: 20 });
  });

  it("marks verified pros from the game doc", () => {
    const [row] = recentOpponents([game({ player2IsVerifiedPro: true } as Partial<GameDoc>)], "me");
    expect(row.isVerifiedPro).toBe(true);
    const [p1] = recentOpponents(
      [
        game({
          player1Uid: "u5",
          player1Username: "pro",
          player2Uid: "me",
          player1IsVerifiedPro: true,
        } as Partial<GameDoc>),
      ],
      "me",
    );
    expect(p1.isVerifiedPro).toBe(true);
  });

  it("counts the viewer's wins over decided games, ignoring active and winner-less ones", () => {
    const rows = recentOpponents(
      [
        game({ id: "w1", status: "complete", winner: "me", updatedAt: at(1) }),
        game({ id: "w2", status: "forfeit", winner: "me", updatedAt: at(2) } as Partial<GameDoc>),
        game({ id: "l1", status: "complete", winner: "u2", updatedAt: at(3) }),
        game({ id: "a1", status: "active", winner: null, updatedAt: at(4) }),
        game({ id: "v1", status: "complete", winner: null, updatedAt: at(5) }),
      ],
      "me",
    );
    expect(rows[0]).toMatchObject({ games: 5, decided: 3, wins: 2 });
  });

  it("tracks the newest active game per opponent", () => {
    const older = game({ id: "act1", status: "active", updatedAt: at(100) });
    const newer = game({ id: "act2", status: "active", updatedAt: at(200) });
    const done = game({ id: "done", status: "complete", updatedAt: at(300) });
    expect(recentOpponents([older, newer, done], "me")[0].activeGame?.id).toBe("act2");
    expect(recentOpponents([newer, older], "me")[0].activeGame?.id).toBe("act2");
    expect(recentOpponents([done, older], "me")[0].activeGame?.id).toBe("act1");
    expect(recentOpponents([done], "me")[0].activeGame).toBeNull();
  });

  it("skips judge-only games, blocked skaters, self-games and missing opponents", () => {
    const rows = recentOpponents(
      [
        game({ player1Uid: "x", player2Uid: "y" }),
        game({ player2Uid: "blocked", player2Username: "bad" }),
        game({ player2Uid: "me", player2Username: "me" }),
        game({ player2Uid: "", player2Username: "" }),
        game({ player2Uid: "ok", player2Username: "good" }),
      ],
      "me",
      new Set(["blocked"]),
    );
    expect(rows.map((r) => r.uid)).toEqual(["ok"]);
  });

  it("treats a missing or odd timestamp as 0 and caps the list", () => {
    const games = Array.from({ length: 8 }, (_, i) =>
      game({ player2Uid: `u${i}`, player2Username: `s${i}`, updatedAt: i === 0 ? ({} as Timestamp) : at(i) }),
    );
    const rows = recentOpponents(games, "me");
    expect(rows).toHaveLength(5);
    expect(rows[0].uid).toBe("u7");
    expect(recentOpponents(games, "me", new Set(), 10).at(-1)?.lastPlayedMs).toBe(0);
  });
});
