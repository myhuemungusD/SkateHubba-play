import { describe, expect, it } from "vitest";
import { diceGame, diceRoll } from "../../../__tests__/harness/diceFixtures";
import { cloLabel, cloPoints, needLine, tenLiveDice, tenScore, tenSelection } from "../diceRules";
import {
  MODE_COPY,
  endReasonLine,
  endTitle,
  fmt,
  isOpen,
  opponentName,
  opponentUid,
  targetLabel,
  timeLeft,
} from "../diceCopy";
import { rowOf, sectionOf } from "../hubRows";
import { cueFor, diceCount, localFromResult, rollAnnouncement, shownRoll, sideOf, tenPlan } from "../tableState";

describe("C-Lo hands", () => {
  it.each([
    [[4, 6, 5], "4-5-6", 3],
    [[3, 1, 2], "1-2-3", 1],
    [[3, 3, 3], "Trips 3s", 2],
    [[2, 2, 5], "Point 5", 1],
    [[1, 6, 6], "Point 1", 1],
    [[1, 3, 5], "No point", 1],
  ])("%j reads as %s", (dice, label, points) => {
    expect(cloLabel(dice)).toBe(label);
    expect(cloPoints(dice)).toBe(points);
  });
});

describe("10,000 scoring", () => {
  it.each([
    [[1, 1, 1, 1, 1, 1], 8000],
    [[1, 2, 3, 4, 5, 6], 1500],
    [[2, 2, 3, 3, 4, 4], 1000],
    [[2, 2, 2, 2, 2], 800],
    [[3, 3, 3, 3], 600],
    [[1, 1, 1, 5], 1050],
    [[5, 2, 3], 50],
    [[2, 3, 4, 6, 6, 3], 0],
  ])("%j scores %i", (dice, score) => {
    expect(tenScore(dice).score).toBe(score);
  });

  it("only allows keeps where every die scores", () => {
    expect(tenSelection([1, 2, 5, 3, 4, 6], [])).toEqual({ score: 0, valid: false });
    expect(tenSelection([1, 2, 5, 3, 4, 6], [0, 2])).toEqual({ score: 150, valid: true });
    expect(tenSelection([1, 2, 5, 3, 4, 6], [0, 1])).toEqual({ score: 100, valid: false });
    expect(tenSelection([1, 2], [5])).toEqual({ score: 0, valid: false });
    expect([...tenLiveDice([1, 2, 5, 3, 3, 3])]).toEqual([0, 2, 3, 4, 5]);
  });
});

describe("needLine", () => {
  it("guides craps by phase", () => {
    expect(needLine(diceGame({ mode: "craps" }), "u1")).toContain("Come-out");
    expect(needLine(diceGame({ mode: "craps", point: 4 }), "u1")).toContain("for 3 points");
    expect(needLine(diceGame({ mode: "craps", point: 6 }), "u1")).toContain("for 2 points");
  });

  it("guides 10,000 by phase", () => {
    expect(needLine(diceGame({ mode: "ten" }), "u1")).toContain("Roll six");
    expect(needLine(diceGame({ mode: "ten", ten: { turnScore: 0, kept: [], rolled: [1] } }), "u1")).toContain(
      "Tap scoring",
    );
    expect(needLine(diceGame({ mode: "ten", ten: { turnScore: 500, kept: [], rolled: [] } }), "u1")).toContain(
      "Hot dice",
    );
  });

  it("names the hand to beat in C-Lo", () => {
    const vs = (dice: number[]) => needLine(diceGame({ results: { u2: dice } }), "u1");
    expect(vs([4, 5, 6])).toContain("Only another 4-5-6");
    expect(vs([1, 2, 3])).toContain("Any point");
    expect(vs([2, 2, 2])).toContain("higher trips");
    expect(vs([2, 2, 5])).toContain("higher point");
    expect(needLine(diceGame({ player1Uid: "u2", player2Uid: "u1", results: { u2: [2, 2, 5] } }), "u1")).toContain(
      "Point 5",
    );
    expect(needLine(diceGame({ mode: "s456" }), "u1")).toContain("on the spot");
    expect(needLine(diceGame(), "u1")).toContain("Throw until");
  });
});

describe("copy helpers", () => {
  it("formats numbers, targets and clocks", () => {
    expect(fmt(10000)).toBe("10,000");
    expect(targetLabel(5000)).toBe("Race to 5,000");
    expect(timeLeft(10_000, 0)).toBe("<1m left");
    expect(timeLeft(5 * 3_600_000, 0)).toBe("5h left");
    expect(timeLeft(30 * 60_000, 0)).toBe("30m left");
    expect(isOpen("pending")).toBe(true);
    expect(isOpen("complete")).toBe(false);
    expect(MODE_COPY.ten.dice).toBe(6);
  });

  it("picks the other seat", () => {
    expect(opponentUid("u1", "u2", "u1")).toBe("u2");
    expect(opponentUid("u1", "u2", "u2")).toBe("u1");
    expect(opponentName("u1", "jay", "remy", "u1")).toBe("remy");
    expect(opponentName("u1", "jay", "remy", "u2")).toBe("jay");
  });

  it("titles every ending from both seats", () => {
    expect(endTitle(diceGame({ status: "declined" }), "u1")).toBe("Challenge declined");
    expect(endTitle(diceGame({ status: "declined" }), "u2")).toBe("You passed");
    expect(endTitle(diceGame({ status: "expired", endReason: "cancel" }), "u1")).toBe("Challenge called off");
    expect(endTitle(diceGame({ status: "expired", endReason: "timeout" }), "u1")).toBe("Challenge expired");
    expect(endTitle(diceGame({ status: "complete", winner: "u1" }), "u1")).toBe("You won");
    expect(endTitle(diceGame({ status: "complete", winner: "u1" }), "u2")).toBe("You lost");
  });

  it("explains every end reason", () => {
    expect(endReasonLine("target", true, "fox")).toBe("You reached the target first.");
    expect(endReasonLine("target", false, "fox")).toContain("@fox");
    expect(endReasonLine("timeout", true, "fox")).toContain("ran out of time");
    expect(endReasonLine("timeout", false, "fox")).toBe("Your turn ran out.");
    expect(endReasonLine("quit", true, "fox")).toContain("left the match");
    expect(endReasonLine("quit", false, "fox")).toBe("You left the match.");
    expect(endReasonLine("decline", false, "fox")).toContain("Records don't change");
    expect(endReasonLine("cancel", false, "fox")).toContain("Records don't change");
    expect(endReasonLine(null, false, "fox")).toContain("Nobody rolled");
  });
});

describe("hub rows", () => {
  const now = 0;
  it("sorts by whose move it is", () => {
    expect(sectionOf(diceGame({ status: "pending" }), "u2")).toBe("move");
    expect(sectionOf(diceGame({ status: "pending" }), "u1")).toBe("wait");
    expect(sectionOf(diceGame(), "u1")).toBe("move");
    expect(sectionOf(diceGame(), "u2")).toBe("wait");
    expect(sectionOf(diceGame({ status: "complete" }), "u1")).toBe("done");
  });

  it("describes every state in plain words", () => {
    const at = (g: Parameters<typeof rowOf>[0], uid = "u1") => rowOf(g, uid, now);
    expect(at(diceGame({ status: "pending" }), "u2")).toMatchObject({
      status: expect.stringContaining("Challenged you"),
      tone: "act",
      score: null,
    });
    expect(at(diceGame({ status: "pending" })).status).toContain("Waiting for them");
    expect(at(diceGame({ scores: { u1: 3, u2: 1 } }))).toMatchObject({
      status: expect.stringContaining("Your roll"),
      score: "3 – 1",
    });
    expect(at(diceGame(), "u2").status).toContain("Their roll");
    expect(at(diceGame({ status: "declined" })).status).toBe("Declined");
    expect(at(diceGame({ status: "declined" }), "u2").status).toBe("You passed");
    expect(at(diceGame({ status: "expired", endReason: "cancel" })).status).toBe("Called off");
    expect(at(diceGame({ status: "expired" })).status).toBe("Expired");
    expect(at(diceGame({ status: "complete", winner: "u1", repChange: { u1: 16, u2: -16 } }))).toMatchObject({
      status: "Won · +16 Rep",
      tone: "won",
    });
    expect(at(diceGame({ status: "complete", winner: "u1", repChange: { u1: 16, u2: -16 } }), "u2").status).toBe(
      "Lost · −16 Rep",
    );
    expect(at(diceGame({ status: "forfeit", winner: "u1" })).status).toBe("Won by forfeit");
    expect(at(diceGame({ status: "forfeit", winner: "u1" }), "u2").status).toBe("Lost by forfeit");
    expect(at(diceGame({ player2Username: "" })).name).toBe("skater");
    expect(at(diceGame({ scores: {} })).score).toBe("0 – 0");
  });
});

describe("table state", () => {
  it("shows our callable roll until the snapshot moves", () => {
    const game = diceGame({ lastRoll: diceRoll({ rollId: "old" }) });
    const local = localFromResult(
      {
        gameId: "g1",
        status: "active",
        label: "Trips 2s",
        outcome: "win",
        callout: null,
        dice: [2, 2, 2],
        rollId: "new",
        currentTurn: "u2",
        scores: {},
        winner: null,
        applied: true,
      },
      "u1",
      "old",
    );
    expect(shownRoll(game, local)?.rollId).toBe("new");
    expect(shownRoll(diceGame({ lastRoll: diceRoll({ rollId: "new" }) }), local)?.rollId).toBe("new");
    expect(shownRoll(diceGame({ lastRoll: diceRoll({ rollId: "later" }) }), local)?.rollId).toBe("later");
    expect(shownRoll(game, null)?.rollId).toBe("old");
    expect(
      localFromResult(
        {
          gameId: "g",
          status: "active",
          label: null,
          outcome: null,
          callout: null,
          dice: null,
          rollId: null,
          currentTurn: null,
          scores: {},
          winner: null,
          applied: true,
        },
        "u1",
        null,
      ),
    ).toBeNull();
    const bare = localFromResult(
      {
        gameId: "g",
        status: "active",
        label: null,
        outcome: null,
        callout: null,
        dice: [1],
        rollId: "x",
        currentTurn: null,
        scores: {},
        winner: null,
        applied: true,
      },
      "u1",
      null,
    );
    expect(bare?.roll).toMatchObject({ label: "", outcome: "" });
  });

  it("counts dice per game", () => {
    expect(diceCount(diceGame())).toBe(3);
    expect(diceCount(diceGame({ mode: "craps" }))).toBe(2);
    expect(diceCount(diceGame({ mode: "ten", ten: { turnScore: 0, kept: [1, 5], rolled: [] } }))).toBe(4);
  });

  it("builds both scoreboard sides", () => {
    const you = sideOf(diceGame({ scores: { u1: 2, u2: 0 }, results: { u1: [3, 3, 3] } }), "u1", "u1");
    expect(you).toMatchObject({ name: "kit", isYou: true, score: 2, toMove: true, hand: { label: "Trips 3s" } });
    expect(sideOf(diceGame(), "u2", "u1")).toMatchObject({ name: "fox", isYou: false, toMove: false, hand: null });
    expect(sideOf(diceGame({ player1Uid: "u2", player2Uid: "u1", player2Username: "kit" }), "u1", "u1").name).toBe(
      "kit",
    );
    expect(sideOf(diceGame({ mode: "ten", ten: { turnScore: 450, kept: [], rolled: [] } }), "u1", "u1").note).toBe(
      "450 on the line",
    );
    expect(sideOf(diceGame({ mode: "craps", point: 8 }), "u1", "u1").note).toBe("Shooting for 8");
    expect(sideOf(diceGame({ scores: {} }), "u1", "u1").score).toBe(0);
  });

  it("previews a 10,000 keep", () => {
    const game = diceGame({ mode: "ten", ten: { turnScore: 300, kept: [1, 5], rolled: [1, 2, 3, 4] } });
    expect(tenPlan(game, [0])).toMatchObject({ valid: true, bankTotal: 400, nextCount: 3 });
    expect(tenPlan(game, [1])).toMatchObject({ valid: false, bankTotal: 300 });
    const hot = diceGame({ mode: "ten", ten: { turnScore: 0, kept: [1, 1], rolled: [5, 5, 5, 1] } });
    expect(tenPlan(hot, [0, 1, 2, 3]).nextCount).toBe(6);
  });

  it("announces rolls and picks cues", () => {
    const game = diceGame({ scores: { u1: 2, u2: 1 } });
    expect(rollAnnouncement(game, diceRoll(), "u1")).toBe("You rolled 2, 2, 5. Point 5. Score 2 to 1.");
    expect(rollAnnouncement(game, diceRoll({ uid: "u2" }), "u1")).toContain("@fox rolled");
    expect(rollAnnouncement(diceGame({ scores: {} }), diceRoll(), "u2")).toContain("Score 0 to 0");
    expect(cueFor(diceRoll({ callout: "Bail" }))).toBe("bail");
    expect(cueFor(diceRoll({ callout: "Clean" }))).toBe("big");
    expect(cueFor(diceRoll({ outcome: "made" }))).toBe("big");
    expect(cueFor(diceRoll({ outcome: "natural" }))).toBe("big");
    expect(cueFor(diceRoll())).toBe("settle");
  });
});
