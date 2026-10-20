import { describe, expect, it } from "vitest";
import { freshMatch, type DiceMatch } from "./engine.js";
import {
  noticeForAccept,
  noticeForChallenge,
  noticeForNudge,
  noticeForReminder,
  noticesForEnd,
  noticesForRoll,
} from "./notify.js";

const NAMES = { a: "jason", b: "remy" };

function m(overrides: Partial<DiceMatch> = {}): DiceMatch {
  return { ...freshMatch(["a", "b"], "clo", 5), status: "active", accepted: true, ...overrides };
}

describe("challenge and accept", () => {
  it("tells the opponent about a new challenge with the game and target", () => {
    const [n] = noticeForChallenge("g", freshMatch(["a", "b"], "ten", 10000), NAMES);
    expect(n).toMatchObject({ recipientUid: "b", senderUid: "a", type: "dice_challenge" });
    expect(n?.body).toBe("@jason challenged you to 10,000, race to 10,000.");
    expect(n?.dedupeKey).toBe("dice_g_challenge_dice_challenge_b");
  });

  it("tells the challenger it's their roll once accepted", () => {
    const [n] = noticeForAccept("g", m(), NAMES);
    expect(n).toMatchObject({ recipientUid: "a", type: "dice_turn", body: "@remy accepted. Your roll." });
  });

  it("skips a malformed match", () => {
    const broken = { ...m(), seats: ["a"] };
    expect(noticeForChallenge("g", broken, NAMES)).toEqual([]);
    expect(noticeForAccept("g", broken, NAMES)).toEqual([]);
    expect(noticesForEnd("g", broken, "a", NAMES, {})).toEqual([]);
  });
});

describe("noticesForRoll", () => {
  it("stays quiet when the same player keeps rolling", () => {
    expect(noticesForRoll("g", m(), { type: "again" }, "a", "No point", NAMES, {})).toEqual([]);
  });

  it("passes the roll and calls a tie", () => {
    const [adv] = noticesForRoll(
      "g",
      m({ rollCount: 2 }),
      { type: "advance", nextUid: "b" },
      "a",
      "Point 5",
      NAMES,
      {},
    );
    expect(adv).toMatchObject({ recipientUid: "b", body: "@jason rolled Point 5. Your roll." });
    const [tie] = noticesForRoll("g", m(), { type: "tie", nextUid: "a" }, "b", "Point 5", NAMES, {});
    expect(tie?.body).toBe("Tied on Point 5. Roll again.");
  });

  it("tells both C-Lo players who took the round, with the score from each side", () => {
    const after = m({ scores: { a: 3, b: 1 }, rollCount: 6 });
    const out = noticesForRoll(
      "g",
      after,
      { type: "round", winnerUid: "a", points: 3, nextUid: "a" },
      "a",
      "4-5-6",
      NAMES,
      {},
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ recipientUid: "a", body: "@jason took the round (+3 pts). 3–1. Your roll." });
    expect(out[1]).toMatchObject({
      recipientUid: "b",
      type: "dice_result",
      body: "@jason took the round (+3 pts). 1–3.",
    });
    const solo = noticesForRoll(
      "g",
      after,
      { type: "round", winnerUid: null, points: 1, nextUid: "b" },
      "a",
      "x",
      NAMES,
      {},
    );
    expect(solo).toHaveLength(1);
    expect(solo[0]?.body).toContain("+1 pt)");
  });

  it("alternating games tell the next player what happened and that it's their turn", () => {
    const after = m({ mode: "ten", target: 5000, scores: { a: 1250, b: 400 } });
    const [n] = noticesForRoll(
      "g",
      after,
      { type: "round", winnerUid: "a", points: 450, nextUid: "b" },
      "a",
      "Banked 450",
      NAMES,
      {},
    );
    expect(n?.body).toBe("@jason: Banked 450. 400–1,250. Your turn.");
    const [made] = noticesForRoll(
      "g",
      { ...after, mode: "craps", target: 5, scores: { a: 3, b: 1 } },
      { type: "round", winnerUid: "a", points: 2, nextUid: "b" },
      "a",
      "Made the 6",
      NAMES,
      {},
    );
    expect(made?.body).toBe("@jason: Made the 6 (+2 pts). 1–3. Your turn.");
    const [miss] = noticesForRoll(
      "g",
      after,
      { type: "round", winnerUid: null, points: 0, nextUid: "b" },
      "a",
      "Farkle",
      NAMES,
      {},
    );
    expect(miss?.body).toBe("@jason: Farkle. 400–1,250. Your turn.");
  });

  it("announces a finished race with Rep to both players", () => {
    const done = m({ status: "complete", winner: "b", scores: { a: 3, b: 6 } });
    const out = noticesForRoll(
      "g",
      done,
      { type: "round", winnerUid: "b", points: 3, nextUid: "a" },
      "b",
      "4-5-6",
      NAMES,
      { a: -16, b: 16 },
    );
    expect(out.map((n) => n.body)).toEqual(["You won C-Lo 6–3. Rep +16.", "@remy won C-Lo 6–3. Rep −16."]);
    const noRep = noticesForRoll("g", done, { type: "again" }, "b", "x", NAMES, { b: 0 });
    expect(noRep.map((n) => n.body)).toEqual(["You won C-Lo 6–3.", "@remy won C-Lo 6–3."]);
    expect(noticesForRoll("g", { ...done, winner: null }, { type: "again" }, "b", "x", NAMES, {})).toEqual([]);
    expect(noticesForRoll("g", { ...done, seats: ["b"] }, { type: "again" }, "b", "x", NAMES, {})).toEqual([]);
  });

  it("clips a long body and names unknown players", () => {
    const [n] = noticesForRoll("g", m(), { type: "advance", nextUid: "b" }, "a", "x".repeat(400), {}, {});
    expect(n?.body.length).toBe(200);
    expect(n?.body.startsWith("@Someone")).toBe(true);
  });
});

describe("noticesForEnd", () => {
  it("decline, cancel and expiry each reach the right person", () => {
    expect(noticesForEnd("g", m({ status: "declined" }), "b", NAMES, {})[0]).toMatchObject({
      recipientUid: "a",
      body: "@remy passed on your challenge.",
    });
    expect(noticesForEnd("g", m({ status: "expired", endReason: "cancel" }), "a", NAMES, {})[0]).toMatchObject({
      recipientUid: "b",
      body: "@jason called off the challenge.",
    });
    expect(noticesForEnd("g", m({ status: "expired", endReason: "timeout" }), "a", NAMES, {})[0]).toMatchObject({
      recipientUid: "a",
      body: "Your challenge expired before it started.",
    });
  });

  it("words a timeout and a quit, with Rep", () => {
    const quit = noticesForEnd("g", m({ status: "forfeit", winner: "a", endReason: "quit" }), "b", NAMES, {
      a: 16,
      b: -16,
    });
    expect(quit.map((n) => n.body)).toEqual([
      "@remy left the match. You win. Rep +16.",
      "You left the match. Counted as a loss. Rep −16.",
    ]);
    const timeout = noticesForEnd("g", m({ status: "forfeit", winner: "b", endReason: "timeout" }), "b", NAMES, {});
    expect(timeout.map((n) => n.body)).toEqual([
      "@jason ran out of time. You win.",
      "Your turn ran out. Counted as a loss.",
    ]);
  });

  it("sends nothing for an active or winnerless match", () => {
    expect(noticesForEnd("g", m(), "a", NAMES, {})).toEqual([]);
    expect(noticesForEnd("g", m({ status: "forfeit", winner: null }), "a", NAMES, {})).toEqual([]);
    expect(noticesForEnd("g", m({ status: "forfeit", winner: "a", seats: ["a", "a"] }), "a", NAMES, {})).toEqual([]);
  });
});

describe("nudge and reminder", () => {
  it("nudges the roller and reminds them before the deadline", () => {
    const [n] = noticeForNudge("g", m({ current: 1 }), "a", 99, NAMES);
    expect(n).toMatchObject({
      recipientUid: "b",
      body: "@jason is waiting on your roll.",
      dedupeKey: "dice_g_nudge99_dice_turn_b",
    });
    const [r] = noticeForReminder("g", m({ current: 0 }), 500, NAMES);
    expect(r).toMatchObject({ recipientUid: "a", senderUid: "b", body: "About 3 hours left on your roll vs @remy." });
    expect(noticeForNudge("g", m({ current: 5 }), "a", 1, NAMES)).toEqual([]);
    expect(noticeForReminder("g", m({ current: 5 }), 1, NAMES)).toEqual([]);
    expect(noticeForReminder("g", { ...m(), seats: ["a"] }, 1, NAMES)[0]?.senderUid).toBe("a");
  });
});
