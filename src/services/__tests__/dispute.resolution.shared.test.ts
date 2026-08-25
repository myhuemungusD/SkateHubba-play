import { describe, it, expect } from "vitest";

import {
  classifyVerdict,
  decideDisputeResolution,
  decidePendingReviewExpiry,
  type DisputeGameUpdate,
  type DisputeStatDeltas,
} from "../dispute.resolution.shared";
import { TURN_DURATION_MS } from "../turnDuration";
import { DISPUTE_NOW as NOW, makeDisputeGame as baseGame } from "./dispute.resolution.test-helpers";

/** Assert the honor-swap game update: matcher becomes setter, turn advances, no letter. */
function expectHonorSwap(u: DisputeGameUpdate, matcherUid: string): void {
  expect(u.phase).toBe("setting");
  expect(u.currentSetter).toBe(matcherUid);
  expect(u.currentTurn).toBe(matcherUid);
  expect(u.turnNumber).toBe(4);
  expect(u.turnDeadlineMs).toBe(NOW + TURN_DURATION_MS);
  expect(u.p1Letters).toBe(0);
  expect(u.p2Letters).toBe(0);
  expect(u.reviewFor).toBeNull();
  expect(u.reviewDeadline).toBeNull();
  expect(u.appendTurnRecord!.landed).toBe(true);
  expect(u.appendTurnRecord!.letterTo).toBeNull();
}

/** Build the expected stat-delta object for the standard setter=p1 / matcher=p2 game. */
function stats(right: number, wrong: number): DisputeStatDeltas {
  return {
    claimer: { uid: "p2", tricksDisputed: 1 },
    disputer: { uid: "p1", disputesRaised: 1, disputesRight: right, disputesWrong: wrong },
  };
}

describe("classifyVerdict", () => {
  it("returns 'none' when there are zero votes (below quorum)", () => {
    expect(classifyVerdict({ landVotes: 0, bailVotes: 0 })).toBe("none");
  });
  it("returns 'land' on a land majority", () => {
    expect(classifyVerdict({ landVotes: 2, bailVotes: 1 })).toBe("land");
  });
  it("returns 'bail' on a bail majority", () => {
    expect(classifyVerdict({ landVotes: 1, bailVotes: 3 })).toBe("bail");
  });
  it("returns 'tie' on equal non-zero votes", () => {
    expect(classifyVerdict({ landVotes: 2, bailVotes: 2 })).toBe("tie");
  });
});

describe("decideDisputeResolution", () => {
  it.each([
    ["land", { landVotes: 2, bailVotes: 1 }],
    ["bail", { landVotes: 0, bailVotes: 2 }],
    ["tie", { landVotes: 1, bailVotes: 1 }],
    ["none", { landVotes: 0, bailVotes: 0 }],
  ] as const)("records the disputed turn for a %s resolution", (_verdict, tally) => {
    expect(decideDisputeResolution(baseGame(), tally, NOW).gameUpdate.lastResolvedDisputeTurnNumber).toBe(3);
  });

  it("land verdict → honor swap, no letter, disputesWrong+1", () => {
    const d = decideDisputeResolution(baseGame(), { landVotes: 2, bailVotes: 1 }, NOW);

    expect(d.verdict).toBe("land");
    expect(d.winnerUid).toBeNull();

    const u = d.gameUpdate;
    expectHonorSwap(u, "p2");
    expect(u.matchVideoUrl).toBeUndefined();
    expect(u.status).toBeUndefined();

    const rec = u.appendTurnRecord!;
    expect(rec.trickName).toBe("Kickflip");
    expect(rec.setterUid).toBe("p1");
    expect(rec.setterUsername).toBe("alice");
    expect(rec.matcherUid).toBe("p2");
    expect(rec.matcherUsername).toBe("bob");
    expect(rec.matchVideoUrl).toBe("https://vid/match.webm");

    expect(d.statDeltas).toEqual(stats(0, 1));
  });

  it("zero-vote 'none' → same honor swap as land, but no right/wrong stat", () => {
    const d = decideDisputeResolution(baseGame(), { landVotes: 0, bailVotes: 0 }, NOW);

    expect(d.verdict).toBe("none");
    expect(d.winnerUid).toBeNull();
    expectHonorSwap(d.gameUpdate, "p2");

    // Owner-confirmable nuance: raw counts still increment on zero-vote.
    expect(d.statDeltas).toEqual(stats(0, 0));
  });

  it("tie → retry in matching, matcher re-attempts, no letter, no record", () => {
    const d = decideDisputeResolution(baseGame(), { landVotes: 1, bailVotes: 1 }, NOW);

    expect(d.verdict).toBe("tie");
    expect(d.winnerUid).toBeNull();

    const u = d.gameUpdate;
    expect(u.phase).toBe("matching");
    expect(u.currentSetter).toBe("p1"); // unchanged
    expect(u.currentTurn).toBe("p2"); // matcher back on the clock
    expect(u.matchVideoUrl).toBeNull(); // cleared for a fresh attempt
    expect(u.turnDeadlineMs).toBe(NOW + TURN_DURATION_MS);
    expect(u.turnNumber).toBeUndefined(); // turn not resolved
    expect(u.appendTurnRecord).toBeUndefined();
    expect(u.reviewFor).toBeNull();
    expect(u.reviewDeadline).toBeNull();

    expect(d.statDeltas).toEqual(stats(0, 0));
  });

  it("bail (matcher < 5) → matcher takes a letter, setter keeps setting", () => {
    const d = decideDisputeResolution(baseGame({ p2Letters: 1 }), { landVotes: 0, bailVotes: 2 }, NOW);

    expect(d.verdict).toBe("bail");
    expect(d.winnerUid).toBeNull();

    const u = d.gameUpdate;
    expect(u.phase).toBe("setting");
    expect(u.currentSetter).toBe("p1"); // setter unchanged
    expect(u.currentTurn).toBe("p1");
    expect(u.turnNumber).toBe(4);
    expect(u.turnDeadlineMs).toBe(NOW + TURN_DURATION_MS);
    expect(u.p1Letters).toBe(0);
    expect(u.p2Letters).toBe(2); // matcher (p2) took a letter
    expect(u.status).toBeUndefined();

    const rec = u.appendTurnRecord!;
    expect(rec.landed).toBe(false);
    expect(rec.letterTo).toBe("p2");

    expect(d.statDeltas).toEqual(stats(1, 0));
  });

  it("bail completing the game (p2 matcher hits 5) → winner = setter p1", () => {
    const d = decideDisputeResolution(baseGame({ p2Letters: 4 }), { landVotes: 0, bailVotes: 1 }, NOW);

    expect(d.verdict).toBe("bail");
    expect(d.winnerUid).toBe("p1"); // setter/disputer wins

    const u = d.gameUpdate;
    expect(u.status).toBe("complete");
    expect(u.winner).toBe("p1");
    expect(u.p2Letters).toBe(5);
    expect(u.p1Letters).toBe(0);
    expect(u.phase).toBeUndefined(); // terminal — no phase/turn advance
    expect(u.currentSetter).toBeUndefined();
    expect(u.turnDeadlineMs).toBeUndefined();
    expect(u.reviewFor).toBeNull();
    expect(u.reviewDeadline).toBeNull();
    expect(u.appendTurnRecord!.letterTo).toBe("p2");

    expect(d.statDeltas).toEqual(stats(1, 0));
  });

  it("bail completing the game (p1 matcher hits 5) → winner = setter p2", () => {
    // Mirror image: setter=p2 (disputer), matcher=p1 (claimer). Covers the
    // isP1Matcher=true letter branch, the p2-setter username branch, and the
    // opposite winner direction.
    const game = baseGame({
      currentSetter: "p2",
      currentTurn: "p2",
      reviewFor: "p1",
      p1Letters: 4,
      currentTrickName: null,
    });
    const d = decideDisputeResolution(game, { landVotes: 0, bailVotes: 3 }, NOW);

    expect(d.winnerUid).toBe("p2");
    expect(d.gameUpdate.winner).toBe("p2");
    expect(d.gameUpdate.p1Letters).toBe(5);
    expect(d.gameUpdate.p2Letters).toBe(0);
    const rec = d.gameUpdate.appendTurnRecord!;
    expect(rec.letterTo).toBe("p1");
    expect(rec.trickName).toBe("Trick"); // null fallback
    expect(rec.setterUid).toBe("p2");
    expect(rec.setterUsername).toBe("bob");
    expect(rec.matcherUsername).toBe("alice");

    expect(d.statDeltas).toEqual({
      claimer: { uid: "p1", tricksDisputed: 1 },
      disputer: { uid: "p2", disputesRaised: 1, disputesRight: 1, disputesWrong: 0 },
    });
  });

  it("falls back to opponent(currentSetter) when reviewFor is unset", () => {
    const game = baseGame({ reviewFor: undefined });
    const d = decideDisputeResolution(game, { landVotes: 1, bailVotes: 0 }, NOW);
    expect(d.verdict).toBe("land");
    expect(d.gameUpdate.currentSetter).toBe("p2"); // matcher = opponent of p1
    expect(d.statDeltas.claimer.uid).toBe("p2");
  });
});

describe("decidePendingReviewExpiry", () => {
  it("performs the deferred honor swap and writes NO stats", () => {
    const u = decidePendingReviewExpiry(baseGame({ phase: "pendingReview" }), NOW);
    expectHonorSwap(u, "p2");
  });

  it("falls back to opponent(currentSetter) when reviewFor is unset", () => {
    // Setter=p2 exercises the opposite opponentOf branch (matcher = p1).
    const u = decidePendingReviewExpiry(
      baseGame({ phase: "pendingReview", currentSetter: "p2", currentTurn: "p2", reviewFor: undefined }),
      NOW,
    );
    expect(u.currentSetter).toBe("p1");
  });
});
