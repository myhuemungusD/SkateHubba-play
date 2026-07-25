import { describe, expect, it } from "vitest";
import { selectPendingRulings } from "../pendingRulings";
import type { GameDoc } from "../../../services/games";
import { activeGame } from "../../../__tests__/harness/mockFactories";

const NOW = 1_700_000_000_000;
const JUDGE = "judge-uid";

/**
 * A game in a phase that needs THIS viewer's ruling. Built on the shared
 * `activeGame` factory so the game-doc shape stays defined in one place.
 */
function makeGame(overrides: Partial<GameDoc> = {}): GameDoc {
  return activeGame({
    id: "g1",
    player1Username: "alice",
    player2Username: "bob",
    currentTurn: JUDGE,
    phase: "disputable",
    currentSetter: "u1",
    currentTrickName: "Kickflip",
    currentTrickVideoUrl: "https://firebasestorage.googleapis.com/set.webm",
    matchVideoUrl: "https://firebasestorage.googleapis.com/match.webm",
    turnDeadline: { toMillis: () => NOW + 3_600_000 } as GameDoc["turnDeadline"],
    turnNumber: 3,
    judgeId: JUDGE,
    judgeUsername: "ref",
    judgeStatus: "accepted",
    ...overrides,
  });
}

describe("selectPendingRulings", () => {
  it("selects a disputable game the viewer must rule on", () => {
    const rulings = selectPendingRulings([makeGame()], JUDGE, NOW);

    expect(rulings).toEqual([
      {
        gameId: "g1",
        kind: "dispute",
        trickName: "Kickflip",
        setterUsername: "alice",
        matcherUsername: "bob",
        setVideoUrl: "https://firebasestorage.googleapis.com/set.webm",
        matchVideoUrl: "https://firebasestorage.googleapis.com/match.webm",
        deadlineMs: NOW + 3_600_000,
      },
    ]);
  });

  it("maps a setReview game to the 'setReview' kind and drops the stale match video", () => {
    const rulings = selectPendingRulings([makeGame({ phase: "setReview" })], JUDGE, NOW);

    expect(rulings[0]?.kind).toBe("setReview");
    // The matcher is disputing the SET — there is no attempt to show, even
    // when a previous turn's URL lingers on the doc.
    expect(rulings[0]?.matchVideoUrl).toBeNull();
    expect(rulings[0]?.setVideoUrl).toBe("https://firebasestorage.googleapis.com/set.webm");
  });

  it("resolves setter/matcher usernames from currentSetter, not player order", () => {
    const rulings = selectPendingRulings([makeGame({ currentSetter: "u2" })], JUDGE, NOW);

    expect(rulings[0]?.setterUsername).toBe("bob");
    expect(rulings[0]?.matcherUsername).toBe("alice");
  });

  it("falls back to 'Trick' when the game has no trick name", () => {
    expect(selectPendingRulings([makeGame({ currentTrickName: null })], JUDGE, NOW)[0]?.trickName).toBe("Trick");
  });

  it.each([
    ["the game is over", { status: "complete" as const }],
    ["the viewer is not the judge", { judgeId: "someone-else" }],
    ["the judge invite is only pending", { judgeStatus: "pending" as const }],
    ["the judge declined", { judgeStatus: "declined" as const }],
    ["no judge was nominated", { judgeId: null, judgeStatus: null }],
    ["it is not the judge's turn", { currentTurn: "u2" }],
    ["the phase needs no ruling (setting)", { phase: "setting" as const }],
    ["the phase needs no ruling (matching)", { phase: "matching" as const }],
  ])("excludes a game when %s", (_label, overrides) => {
    expect(selectPendingRulings([makeGame(overrides)], JUDGE, NOW)).toEqual([]);
  });

  it("excludes an expired turn — the forfeit sweep owns it", () => {
    const expired = makeGame({ turnDeadline: { toMillis: () => NOW - 1 } as GameDoc["turnDeadline"] });
    expect(selectPendingRulings([expired], JUDGE, NOW)).toEqual([]);
  });

  it("keeps a game whose deadline is missing or unreadable", () => {
    const noDeadline = makeGame({ turnDeadline: undefined as unknown as GameDoc["turnDeadline"] });
    const rulings = selectPendingRulings([noDeadline], JUDGE, NOW);

    expect(rulings).toHaveLength(1);
    expect(rulings[0]?.deadlineMs).toBe(0);
  });

  it("orders by soonest deadline, with deadline-less games last", () => {
    const games = [
      makeGame({ id: "later", turnDeadline: { toMillis: () => NOW + 9_000_000 } as GameDoc["turnDeadline"] }),
      makeGame({ id: "none", turnDeadline: undefined as unknown as GameDoc["turnDeadline"] }),
      makeGame({ id: "soonest", turnDeadline: { toMillis: () => NOW + 60_000 } as GameDoc["turnDeadline"] }),
    ];

    expect(selectPendingRulings(games, JUDGE, NOW).map((r) => r.gameId)).toEqual(["soonest", "later", "none"]);
  });

  it("returns an empty list for an empty game set", () => {
    expect(selectPendingRulings([], JUDGE, NOW)).toEqual([]);
  });
});
