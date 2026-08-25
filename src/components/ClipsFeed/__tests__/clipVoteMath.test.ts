import { describe, it, expect } from "vitest";
import type { ClipVoteState } from "../../../services/clips.upvotes";
import { NO_VOTE, applyVote, nextVoteFor, sameVoteState } from "../clipVoteMath";

function state(up: number, down: number, myVote: 1 | -1 | null): ClipVoteState {
  return { upvoteCount: up, downvoteCount: down, myVote };
}

describe("nextVoteFor", () => {
  it("casts the pressed vote when the viewer has none", () => {
    expect(nextVoteFor(state(0, 0, null), 1)).toBe(1);
    expect(nextVoteFor(state(0, 0, null), -1)).toBe(-1);
  });

  it("withdraws when the viewer taps the thumb they already gave", () => {
    expect(nextVoteFor(state(1, 0, 1), 1)).toBeNull();
    expect(nextVoteFor(state(0, 1, -1), -1)).toBeNull();
  });

  it("flips when the viewer taps the opposite thumb", () => {
    expect(nextVoteFor(state(1, 0, 1), -1)).toBe(-1);
    expect(nextVoteFor(state(0, 1, -1), 1)).toBe(1);
  });
});

describe("applyVote", () => {
  it("increments the matching counter on a fresh vote", () => {
    expect(applyVote(state(4, 2, null), 1)).toEqual(state(5, 2, 1));
    expect(applyVote(state(4, 2, null), -1)).toEqual(state(4, 3, -1));
  });

  it("decrements on withdrawal", () => {
    expect(applyVote(state(5, 2, 1), null)).toEqual(state(4, 2, null));
    expect(applyVote(state(4, 3, -1), null)).toEqual(state(4, 2, null));
  });

  it("moves the tally across BOTH counters on a flip — the case a naive add/remove double-counts", () => {
    expect(applyVote(state(5, 2, 1), -1)).toEqual(state(4, 3, -1));
    expect(applyVote(state(4, 3, -1), 1)).toEqual(state(5, 2, 1));
  });

  it("is a no-op when the requested vote is the one already held", () => {
    expect(applyVote(state(5, 2, 1), 1)).toEqual(state(5, 2, 1));
  });

  it("clamps at zero rather than rendering a negative tally", () => {
    // Aggregate lagging the vote docs — a real state for backfilled clips.
    expect(applyVote(state(0, 0, 1), null)).toEqual(state(0, 0, null));
    expect(applyVote(state(0, 0, -1), 1)).toEqual(state(1, 0, 1));
  });

  it("leaves NO_VOTE untouched (the shared default is not mutated)", () => {
    applyVote(NO_VOTE, 1);
    expect(NO_VOTE).toEqual({ upvoteCount: 0, downvoteCount: 0, myVote: null });
  });
});

describe("sameVoteState", () => {
  it("is true only when every field matches", () => {
    expect(sameVoteState(state(1, 2, 1), state(1, 2, 1))).toBe(true);
    expect(sameVoteState(state(1, 2, 1), state(2, 2, 1))).toBe(false);
    expect(sameVoteState(state(1, 2, 1), state(1, 3, 1))).toBe(false);
    expect(sameVoteState(state(1, 2, 1), state(1, 2, -1))).toBe(false);
  });
});
