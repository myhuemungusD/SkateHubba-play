import { describe, expect, it } from "vitest";
import { applyCloRoll, applyDecline, applyQuit, applyTimeout, freshMatch } from "./engine.js";
import { noticesForEnd, noticesForRoll } from "./notify.js";

const names = { u1: "jason", u2: "remy" };

describe("noticesForRoll", () => {
  it("stays quiet on a re-roll", () => {
    const before = freshMatch(["u1", "u2"]);
    const applied = applyCloRoll(before, "u1", [1, 3, 5]);
    expect(noticesForRoll("g1", before, applied.state, applied.effect, "u1", applied.label, names)).toEqual([]);
  });

  it("sends the opponent a challenge the first time a result lands", () => {
    const before = freshMatch(["u1", "u2"]);
    const applied = applyCloRoll(before, "u1", [2, 2, 5]);
    const notices = noticesForRoll("g1", before, applied.state, applied.effect, "u1", applied.label, names);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      recipientUid: "u2",
      type: "dice_challenge",
      body: "@jason rolled POINT 5 — your roll",
    });
    expect(notices[0]?.dedupeKey.startsWith("dice_g1_")).toBe(true);
  });

  it("uses a turn notice after the opening roll", () => {
    let state = freshMatch(["u1", "u2"]);
    state = applyCloRoll(state, "u1", [2, 2, 3]).state;
    state = applyCloRoll(state, "u2", [2, 2, 6]).state;
    const before = state;
    const applied = applyCloRoll(before, "u1", [1, 1, 4]);
    const notices = noticesForRoll("g1", before, applied.state, applied.effect, "u1", applied.label, names);
    expect(notices[0]?.type).toBe("dice_turn");
  });

  it("tells both players when a round is taken", () => {
    const before = applyCloRoll(freshMatch(["u1", "u2"]), "u1", [2, 2, 3]).state;
    const applied = applyCloRoll(before, "u2", [4, 5, 6]);
    const notices = noticesForRoll("g1", before, applied.state, applied.effect, "u2", applied.label, names);
    expect(notices.map((n) => n.type).sort()).toEqual(["dice_result", "dice_turn"]);
    expect(notices.find((n) => n.recipientUid === "u1")?.body).toContain("Your roll");
    expect(notices.find((n) => n.recipientUid === "u2")?.body).toContain("took the round");
  });

  it("tells the first tied seat to roll again", () => {
    const before = applyCloRoll(freshMatch(["u1", "u2"]), "u1", [2, 2, 5]).state;
    const applied = applyCloRoll(before, "u2", [3, 3, 5]);
    const notices = noticesForRoll("g1", before, applied.state, applied.effect, "u2", applied.label, names);
    expect(applied.effect.type).toBe("tie");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      recipientUid: "u1",
      type: "dice_turn",
      body: "Tied on POINT 5 — roll again",
    });
  });

  it("clips a very long body", () => {
    const before = freshMatch(["u1", "u2"]);
    const applied = applyCloRoll(before, "u1", [2, 2, 5]);
    const longNames = { u1: "j".repeat(300), u2: "remy" };
    const notices = noticesForRoll("g1", before, applied.state, applied.effect, "u1", applied.label, longNames);
    expect(notices[0]?.body.length).toBeLessThanOrEqual(200);
    expect(notices[0]?.title.length).toBeLessThanOrEqual(80);
  });
});

describe("noticesForEnd", () => {
  it("tells the challenger about a decline and nobody else", () => {
    const state = applyDecline(freshMatch(["u1", "u2"]), "u2");
    const notices = noticesForEnd("g1", state, "u2", names);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ recipientUid: "u1", body: "@remy declined." });
  });

  it("tells both players who won a forfeit", () => {
    const started = applyCloRoll(freshMatch(["u1", "u2"]), "u1", [2, 2, 5]).state;
    const state = applyQuit(started, "u1");
    const notices = noticesForEnd("g1", state, "u1", names);
    expect(notices.map((n) => n.recipientUid).sort()).toEqual(["u1", "u2"]);
    expect(notices.find((n) => n.recipientUid === "u2")?.body).toBe("You got the win.");
    expect(notices.find((n) => n.recipientUid === "u1")?.body).toBe("You left the match.");
  });

  it("words a timeout differently from a quit", () => {
    const started = applyCloRoll(freshMatch(["u1", "u2"]), "u1", [1, 3, 5]).state;
    const state = applyTimeout(started, 10, 10);
    expect(state).not.toBeNull();
    const notices = noticesForEnd("g1", state!, "u2", names);
    expect(notices.find((n) => n.recipientUid === "u2")?.body).toBe("Their turn expired. You got the win.");
    expect(notices.find((n) => n.recipientUid === "u1")?.body).toBe("Your turn expired.");
  });

  it("sends nothing when a match expires before anyone rolls", () => {
    const state = applyTimeout(freshMatch(["u1", "u2"]), 10, 10);
    expect(noticesForEnd("g1", state!, "u1", names)).toEqual([]);
  });
});
