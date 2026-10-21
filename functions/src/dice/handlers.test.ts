import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDieSource } from "./dice.js";
import {
  acceptDice,
  bankDice,
  claimDiceTimeout,
  createDiceGame,
  declineDice,
  deliverDicePushes,
  nudgeDice,
  quitDice,
  rematchDice,
  rollDice,
  sweepExpiredDiceGames,
} from "./handlers.js";
import { MemoryDb, NOW, actor, queueDice, seedPlayers } from "./testkit.js";

vi.mock("firebase-functions/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const DAY = 24 * 60 * 60 * 1000;

function game(db: MemoryDb, id = "game-1"): Record<string, unknown> {
  const doc = db.docs.get(`diceGames/${id}`);
  if (!doc) throw new Error(`missing ${id}`);
  return doc;
}

function notices(db: MemoryDb): Array<Record<string, unknown>> {
  return [...db.docs.entries()].filter(([path]) => path.startsWith("notifications/")).map(([, data]) => data);
}

/** Opens and accepts a match; returns the clock after the accept. */
async function started(db: MemoryDb, mode = "clo", target?: number): Promise<number> {
  await createDiceGame(db, actor("u1"), "u2", { mode, target });
  await acceptDice(db, actor("u2", NOW + 1_000), "game-1");
  return NOW + 1_000;
}

let db: MemoryDb;

beforeEach(() => {
  db = new MemoryDb();
  seedPlayers(db);
});

afterEach(() => resetDieSource());

describe("challenge", () => {
  it("opens a pending challenge and notifies the opponent", async () => {
    db.seed("pushTargets/u2", { tokens: ["tok"] });
    const created = await createDiceGame(db, actor("u1"), "u2", { mode: "craps", target: 9 });
    expect(created).toMatchObject({ gameId: "game-1", status: "pending", currentTurn: null, applied: true });
    expect(game(db)).toMatchObject({
      v: 2,
      game: "craps",
      target: 9,
      status: "pending",
      playerUids: ["u1", "u2"],
      player1Username: "jason",
      player2Username: "remy",
      scores: { u1: 0, u2: 0 },
      stake: null,
      turnDeadline: NOW + DAY,
      remindAt: null,
      rematchOf: null,
    });
    expect(notices(db)).toEqual([expect.objectContaining({ recipientUid: "u2", type: "dice_challenge" })]);
    expect(db.added).toHaveLength(1);
  });

  it("defaults to C-Lo, race to 5", async () => {
    await createDiceGame(db, actor("u1"), "u2");
    expect(game(db)).toMatchObject({ game: "clo", target: 5 });
  });

  it("rejects bad modes and targets", async () => {
    await expect(createDiceGame(db, actor("u1"), "u2", { mode: "poker" })).rejects.toMatchObject({ code: "bad_mode" });
    await expect(createDiceGame(db, actor("u1"), "u2", { mode: "ten", target: 5 })).rejects.toMatchObject({
      code: "bad_mode",
    });
  });

  it("rejects an unverified email, a self challenge, a missing user, a ban, and a block", async () => {
    await expect(createDiceGame(db, actor("u1", NOW, false), "u2")).rejects.toMatchObject({ code: "email_unverified" });
    await expect(createDiceGame(db, actor("u1"), "u1")).rejects.toMatchObject({ code: "self_challenge" });
    await expect(createDiceGame(db, actor("u1"), "missing")).rejects.toMatchObject({ code: "not_found" });
    db.seed("bans/u1", { reason: "spam" });
    await expect(createDiceGame(db, actor("u1"), "u2")).rejects.toMatchObject({ code: "banned" });
    db.docs.delete("bans/u1");
    db.seed("users/u2", { username: "remy", banned: true });
    await expect(createDiceGame(db, actor("u1"), "u2")).rejects.toMatchObject({ code: "banned" });
    db.seed("users/u2", { username: "remy" });
    db.seed("users/u2/blocked_users/u1", { at: 1 });
    await expect(createDiceGame(db, actor("u1"), "u2")).rejects.toMatchObject({ code: "blocked" });
  });

  it("refuses a second create inside the cooldown and an eleventh open match (pending counts)", async () => {
    await createDiceGame(db, actor("u1"), "u2");
    await expect(createDiceGame(db, actor("u1", NOW + 1_000), "u2")).rejects.toMatchObject({
      code: "create_cooldown",
      details: { retryAfterMs: 9_000 },
    });
    for (let i = 0; i < 9; i++) db.seed(`diceGames/x${i}`, { player2Uid: "u1", status: i % 2 ? "active" : "pending" });
    await expect(createDiceGame(db, actor("u1", NOW + 60_000), "u2")).rejects.toMatchObject({
      code: "too_many_active",
    });
  });

  it("only the opponent accepts, then the challenger rolls first", async () => {
    await createDiceGame(db, actor("u1"), "u2");
    await expect(acceptDice(db, actor("u1"), "game-1")).rejects.toMatchObject({ code: "not_acceptable" });
    await expect(acceptDice(db, actor("zz"), "game-1")).rejects.toMatchObject({ code: "not_a_player" });
    const accepted = await acceptDice(db, actor("u2", NOW + 5), "game-1");
    expect(accepted).toMatchObject({ status: "active", currentTurn: "u1" });
    expect(game(db)).toMatchObject({
      accepted: true,
      turnDeadline: NOW + 5 + DAY,
      remindAt: NOW + 5 + DAY - 3 * 3600_000,
    });
    expect(notices(db).some((n) => n.recipientUid === "u1" && n.body === "@remy accepted. Your roll.")).toBe(true);
    await expect(acceptDice(db, actor("u2"), "game-1")).rejects.toMatchObject({ code: "not_pending" });
  });

  it("cannot roll before the challenge is accepted", async () => {
    await createDiceGame(db, actor("u1"), "u2");
    queueDice(4, 5, 6);
    await expect(rollDice(db, actor("u1"), "game-1")).rejects.toMatchObject({ code: "game_over" });
  });
});

describe("a full C-Lo match", () => {
  it("plays rounds to the target, scores by hand, logs rounds, and moves records and Rep", async () => {
    let t = await started(db, "clo", 5);
    const roll = async (uid: string, ...dice: number[]) => {
      t += 2_000;
      queueDice(...dice);
      return rollDice(db, actor(uid, t), "game-1");
    };
    const first = await roll("u1", 1, 2, 4);
    expect(first).toMatchObject({ label: "No point", outcome: "reroll", currentTurn: "u1", dice: [1, 2, 4] });
    expect(first.rollId).toEqual(expect.any(String));
    await roll("u1", 4, 5, 6);
    const r1 = await roll("u2", 3, 3, 1);
    expect(r1.scores).toEqual({ u1: 3, u2: 0 });
    expect(r1.currentTurn).toBe("u2");
    await roll("u2", 2, 2, 2);
    const r2 = await roll("u1", 6, 6, 5);
    expect(r2.scores).toEqual({ u1: 3, u2: 2 });
    await roll("u1", 4, 4, 4);
    const done = await roll("u2", 1, 2, 3);
    expect(done).toMatchObject({ status: "complete", winner: "u1", currentTurn: null, scores: { u1: 5, u2: 2 } });

    const doc = game(db);
    expect(doc.rounds).toHaveLength(3);
    expect((doc.rounds as Array<Record<string, unknown>>)[0]).toMatchObject({
      round: 1,
      winner: "u1",
      points: 3,
      label: "4-5-6",
    });
    expect(doc.history).toHaveLength(7);
    expect(doc.repChange).toEqual({ u1: 16, u2: -16 });
    expect(doc.remindAt).toBeNull();
    expect(db.docs.get("diceStats/u1")).toMatchObject({
      wins: 1,
      losses: 0,
      rep: 1016,
      peakRep: 1016,
      streak: 1,
      bestStreak: 1,
      byMode: { clo: { wins: 1, losses: 0 } },
    });
    expect(db.docs.get("diceStats/u2")).toMatchObject({ wins: 0, losses: 1, rep: 984, streak: 0, gamesPlayed: 1 });
    expect(notices(db).some((n) => n.body === "You won C-Lo 5–2. Rep +16.")).toBe(true);
    await expect(roll("u1", 1, 1, 2)).rejects.toMatchObject({ code: "game_over" });
  });

  it("rejects the wrong player, a stranger, a keep list, and a second roll inside the cooldown", async () => {
    const t = await started(db);
    queueDice(1, 3, 5, 1, 3, 5);
    await expect(rollDice(db, actor("u2", t + 2_000), "game-1")).rejects.toMatchObject({ code: "not_your_turn" });
    await expect(rollDice(db, actor("zz", t + 2_000), "game-1")).rejects.toMatchObject({ code: "not_a_player" });
    await expect(rollDice(db, actor("u1", t + 2_000), "game-1", [0])).rejects.toMatchObject({ code: "bad_keep" });
    expect(await rollDice(db, actor("u1", t + 2_000), "game-1")).toMatchObject({ currentTurn: "u1" });
    await expect(rollDice(db, actor("u1", t + 2_100), "game-1")).rejects.toMatchObject({
      code: "slow_down",
      details: { retryAfterMs: 600 },
    });
  });

  it("refuses missing and unreadable games", async () => {
    await expect(rollDice(db, actor("u1"), "nope")).rejects.toMatchObject({ code: "not_found" });
    db.seed("diceGames/bad", { player1Uid: "u1", player2Uid: "u2", status: "lost" });
    await expect(rollDice(db, actor("u1"), "bad")).rejects.toMatchObject({ code: "bad_doc" });
  });

  it("surfaces unexpected engine errors", async () => {
    await started(db);
    queueDice(9, 9, 9);
    await expect(rollDice(db, actor("u1", NOW + 9_000), "game-1")).rejects.toMatchObject({ code: "bad_dice" });
    queueDice();
    await expect(rollDice(db, actor("u1", NOW + 9_000), "game-1")).rejects.toThrow("die queue exhausted");
  });
});

describe("4-5-6, craps and 10,000 through the handler", () => {
  it("4-5-6 takes the round on the spot", async () => {
    const t = await started(db, "s456");
    queueDice(6, 5, 4);
    const r = await rollDice(db, actor("u1", t + 2_000), "game-1");
    expect(r).toMatchObject({ scores: { u1: 3, u2: 0 }, currentTurn: "u2", callout: "Clean" });
  });

  it("craps: point, keep rolling, make it, dice pass", async () => {
    let t = await started(db, "craps");
    const roll = async (uid: string, ...dice: number[]) => {
      t += 2_000;
      queueDice(...dice);
      return rollDice(db, actor(uid, t), "game-1");
    };
    expect(await roll("u1", 2, 2)).toMatchObject({ label: "Point 4", currentTurn: "u1" });
    expect(game(db).point).toBe(4);
    expect(await roll("u1", 5, 6)).toMatchObject({ currentTurn: "u1" });
    expect(await roll("u1", 1, 3)).toMatchObject({ label: "Made the 4", scores: { u1: 3, u2: 0 }, currentTurn: "u2" });
    expect(game(db)).toMatchObject({ point: null, turns: { u1: 1, u2: 0 } });
  });

  it("10,000: keep, roll the rest, bank, and validate keeps on the server", async () => {
    let t = await started(db, "ten");
    const at = () => {
      t += 2_000;
      return actor("u1", t);
    };
    queueDice(1, 5, 2, 3, 3, 6);
    expect(await rollDice(db, at(), "game-1")).toMatchObject({ outcome: "rolled", currentTurn: "u1" });
    await expect(bankDice(db, at(), "game-1", [2])).rejects.toMatchObject({ code: "bad_keep" });
    queueDice(5, 2, 2, 3, 4);
    expect(await rollDice(db, at(), "game-1", [0])).toMatchObject({ dice: [5, 2, 2, 3, 4] });
    expect(game(db).ten).toEqual({ turnScore: 100, kept: [1], rolled: [5, 2, 2, 3, 4] });
    const banked = await bankDice(db, at(), "game-1", [0]);
    expect(banked).toMatchObject({ label: "Banked 150", scores: { u1: 150, u2: 0 }, currentTurn: "u2" });
    await expect(bankDice(db, actor("u2", t + 2_000), "game-1", [])).rejects.toMatchObject({ code: "bad_keep" });
  });

  it("the cooldown only holds back the skater who just rolled", async () => {
    const t = await started(db, "clo");
    queueDice(2, 2, 5);
    await rollDice(db, actor("u1", t + 2_000), "game-1");
    queueDice(3, 3, 6);
    expect(await rollDice(db, actor("u2", t + 2_100), "game-1")).toMatchObject({ applied: true });
  });

  it("10,000: banking right after a roll skips the roll cooldown", async () => {
    const t = await started(db, "ten");
    queueDice(1, 5, 2, 3, 3, 6);
    await rollDice(db, actor("u1", t + 2_000), "game-1");
    await expect(rollDice(db, actor("u1", t + 2_100), "game-1", [0])).rejects.toMatchObject({ code: "slow_down" });
    expect(await bankDice(db, actor("u1", t + 2_100), "game-1", [0, 1])).toMatchObject({ label: "Banked 150" });
  });
});

describe("leaving, declining and timeouts", () => {
  it("opponent declines a challenge, no stats move", async () => {
    await createDiceGame(db, actor("u1"), "u2");
    await expect(declineDice(db, actor("u1"), "game-1")).rejects.toMatchObject({ code: "not_declinable" });
    expect(await declineDice(db, actor("u2"), "game-1")).toMatchObject({ status: "declined" });
    expect(db.docs.has("diceStats/u1")).toBe(false);
    expect(notices(db).some((n) => n.body === "@remy passed on your challenge.")).toBe(true);
  });

  it("challenger cancels a challenge", async () => {
    await createDiceGame(db, actor("u1"), "u2");
    expect(await quitDice(db, actor("u1"), "game-1")).toMatchObject({ status: "expired" });
    expect(game(db).endReason).toBe("cancel");
  });

  it("quitting after accept forfeits and moves records", async () => {
    await started(db);
    expect(await quitDice(db, actor("u2", NOW + 5_000), "game-1")).toMatchObject({ status: "forfeit", winner: "u1" });
    expect(game(db).repChange).toEqual({ u1: 16, u2: -16 });
    expect(db.docs.get("diceStats/u2")).toMatchObject({ losses: 1 });
    await expect(quitDice(db, actor("u2", NOW + 6_000), "game-1")).rejects.toMatchObject({ code: "game_over" });
  });

  it("a timeout is a no-op early, expires an unanswered challenge, and forfeits a started match", async () => {
    await createDiceGame(db, actor("u1"), "u2");
    expect(await claimDiceTimeout(db, actor("u1", NOW + 5), "game-1")).toMatchObject({ applied: false });
    expect(await claimDiceTimeout(db, actor("u2", NOW + DAY), "game-1")).toMatchObject({
      status: "expired",
      applied: true,
    });

    db = new MemoryDb();
    seedPlayers(db);
    await started(db);
    const r = await claimDiceTimeout(db, actor("u2", NOW + 2 * DAY), "game-1");
    expect(r).toMatchObject({ status: "forfeit", winner: "u2" });
    expect(db.docs.get("diceStats/u2")).toMatchObject({ wins: 1 });
  });

  it("a doc with no deadline never times out", async () => {
    await started(db);
    const doc = game(db);
    db.seed("diceGames/game-1", { ...doc, turnDeadline: null });
    expect(await claimDiceTimeout(db, actor("u1", NOW + 99 * DAY), "game-1")).toMatchObject({ applied: false });
  });
});

describe("nudge", () => {
  it("lets the waiting player nudge once an hour", async () => {
    await started(db);
    await expect(nudgeDice(db, actor("u1", NOW + 2_000), "game-1")).rejects.toMatchObject({ code: "your_turn" });
    await nudgeDice(db, actor("u2", NOW + 2_000), "game-1");
    expect(notices(db).some((n) => n.body === "@remy is waiting on your roll." && n.recipientUid === "u1")).toBe(true);
    await expect(nudgeDice(db, actor("u2", NOW + 60_000), "game-1")).rejects.toMatchObject({
      code: "nudge_cooldown",
      details: { retryAfterMs: 3600_000 - 58_000 },
    });
    await nudgeDice(db, actor("u2", NOW + 2_000 + 3600_000), "game-1");
  });

  it("refuses a nudge on a match that isn't being played", async () => {
    await createDiceGame(db, actor("u1"), "u2");
    await expect(nudgeDice(db, actor("u1"), "game-1")).rejects.toMatchObject({ code: "game_over" });
  });
});

describe("rematch", () => {
  it("opens a new challenge with the same game and length, and reuses it on a second tap", async () => {
    await started(db, "ten", 10000);
    await quitDice(db, actor("u1", NOW + 2_000), "game-1");
    const r = await rematchDice(db, actor("u2", NOW + 20_000), "game-1");
    expect(r).toMatchObject({ gameId: "game-2", status: "pending", applied: true });
    expect(game(db, "game-2")).toMatchObject({
      game: "ten",
      target: 10000,
      player1Uid: "u2",
      player2Uid: "u1",
      rematchOf: "game-1",
    });
    expect(game(db).rematchGameId).toBe("game-2");
    expect(await rematchDice(db, actor("u1", NOW + 40_000), "game-1")).toMatchObject({
      gameId: "game-2",
      applied: false,
    });
  });

  it("returns the rematch another tap already opened inside the transaction", async () => {
    await started(db);
    await quitDice(db, actor("u1", NOW + 2_000), "game-1");
    const original = db.get.bind(db);
    let calls = 0;
    db.get = async (path: string) => {
      const doc = await original(path);
      if (path === "diceGames/game-1" && calls++ === 0) return { ...doc, data: { ...doc.data, rematchGameId: null } };
      return doc;
    };
    db.seed("diceGames/game-1", { ...game(db), rematchGameId: "game-9" });
    expect(await rematchDice(db, actor("u2", NOW + 20_000), "game-1")).toMatchObject({
      gameId: "game-9",
      applied: false,
    });
  });

  it("refuses while the match is still on, for strangers, and for unknown games", async () => {
    await started(db);
    await expect(rematchDice(db, actor("u1"), "game-1")).rejects.toMatchObject({ code: "still_playing" });
    await expect(rematchDice(db, actor("zz"), "game-1")).rejects.toMatchObject({ code: "not_a_player" });
    await expect(rematchDice(db, actor("u1"), "nope")).rejects.toMatchObject({ code: "not_found" });
    db.seed("diceGames/bad", { status: "x" });
    await expect(rematchDice(db, actor("u1"), "bad")).rejects.toMatchObject({ code: "bad_doc" });
  });
});

describe("pushes and the sweep", () => {
  it("writes a push only when the recipient allows it and has tokens", async () => {
    const notice = {
      recipientUid: "u2",
      senderUid: "u1",
      type: "dice_turn" as const,
      title: "Roll Dice",
      body: "hi",
      gameId: "g",
      dedupeKey: "k",
    };
    await deliverDicePushes(db, [notice]);
    expect(db.added).toEqual([]);
    db.seed("pushTargets/u2", { tokens: ["a", "", 4, "b"] });
    await deliverDicePushes(db, [notice]);
    expect(db.added[0]?.data).toMatchObject({ tokens: ["a", "b"], data: { kind: "dice", click_action: "/dice/g" } });
    db.seed("users/u2/private/profile", { pushEnabled: false });
    await deliverDicePushes(db, [notice]);
    expect(db.added).toHaveLength(1);
    db.seed("users/u2/private/profile", {});
    db.seed("pushTargets/u2", { tokens: "nope" });
    await deliverDicePushes(db, [notice]);
    expect(db.added).toHaveLength(1);
  });

  it("logs and continues when a push write fails", async () => {
    db.seed("pushTargets/u2", { tokens: ["a"] });
    db.add = async () => {
      throw new Error("down");
    };
    await deliverDicePushes(db, [
      { recipientUid: "u2", senderUid: "u1", type: "dice_turn", title: "t", body: "b", gameId: "g", dedupeKey: "k" },
    ]);
    db.add = async () => {
      throw "weird";
    };
    await deliverDicePushes(db, [
      { recipientUid: "u2", senderUid: "u1", type: "dice_turn", title: "t", body: "b", gameId: "g", dedupeKey: "k" },
    ]);
  });

  it("closes expired active and pending matches and skips broken rows", async () => {
    await started(db);
    db.seed("diceGames/p1", { ...game(db), status: "pending", accepted: false, turnDeadline: NOW + 10 });
    db.seed("diceGames/fresh", { ...game(db), turnDeadline: NOW + 3 * DAY });
    db.seed("diceGames/nouid", { status: "active", turnDeadline: 1 });
    db.seed("diceGames/broken", { status: "active", turnDeadline: 1, player1Uid: "u1", player2Uid: "" });
    expect(await sweepExpiredDiceGames(db, NOW + 2 * DAY)).toBe(2);
    expect(game(db).status).toBe("forfeit");
    expect(game(db, "p1").status).toBe("expired");
    expect(game(db, "fresh").status).toBe("active");
  });

  it("sends one reminder about 3 hours before the deadline", async () => {
    const t = await started(db);
    const deadline = t + DAY;
    const remindAt = deadline - 3 * 3600_000;
    db.seed("pushTargets/u1", { tokens: ["tok"] });
    expect(await sweepExpiredDiceGames(db, remindAt - 1)).toBe(0);
    expect(game(db).remindAt).toBe(remindAt);
    await sweepExpiredDiceGames(db, remindAt + 1);
    expect(game(db).remindAt).toBeNull();
    expect(notices(db).filter((n) => String(n.body).startsWith("About 3 hours left"))).toHaveLength(1);
    await sweepExpiredDiceGames(db, remindAt + 2);
    expect(notices(db).filter((n) => String(n.body).startsWith("About 3 hours left"))).toHaveLength(1);
  });

  it("skips reminders for docs that changed underneath, and past deadlines", async () => {
    await started(db);
    const base = game(db);
    db.seed("diceGames/gone", { ...base, status: "complete", remindAt: 5 });
    db.seed("diceGames/late", { ...base, remindAt: 5, turnDeadline: 6 });
    db.seed("diceGames/nodeadline", { ...base, remindAt: 5, turnDeadline: "x" });
    const original = db.runTransaction.bind(db);
    db.runTransaction = async (fn) => {
      db.seed("diceGames/raced", { ...base, remindAt: null });
      return original(fn);
    };
    db.seed("diceGames/raced", { ...base, remindAt: 5 });
    await sweepExpiredDiceGames(db, 10);
    expect(game(db, "late").remindAt).toBeNull();
    expect(notices(db).filter((n) => String(n.body).startsWith("About 3 hours left"))).toHaveLength(0);
  });

  it("logs a reminder that throws and keeps sweeping", async () => {
    await started(db);
    db.seed("diceGames/r1", { ...game(db), remindAt: 5 });
    db.runTransaction = async () => {
      throw new Error("contention");
    };
    await sweepExpiredDiceGames(db, 10);
    db.runTransaction = async () => {
      throw "odd";
    };
    await sweepExpiredDiceGames(db, 10);
    db.seed("diceGames/old", { ...game(db), turnDeadline: 1 });
    expect(await sweepExpiredDiceGames(db, 10)).toBe(0);
  });
});

describe("legacy v1 matches", () => {
  it("keep playing as a C-Lo race with their rounds counted as points", async () => {
    db.seed("diceGames/old", {
      v: 1,
      game: "clo",
      playerUids: ["u1", "u2"],
      player1Uid: "u1",
      player2Uid: "u2",
      player1Username: "jason",
      player2Username: "remy",
      status: "active",
      currentTurn: "u2",
      round: 5,
      roundsWon: { u1: 4, u2: 0 },
      results: { u1: { dice: [6, 6, 5], outcome: "point", label: "POINT 5", rank: 5 } },
      rollCount: 12,
      winner: null,
      endReason: null,
      history: [],
      turnDeadline: NOW + DAY,
      lastRollAt: null,
    });
    queueDice(1, 1, 2);
    const r = await rollDice(db, actor("u2"), "old");
    expect(r).toMatchObject({ status: "complete", winner: "u1", scores: { u1: 5, u2: 0 } });
    expect(game(db, "old")).toMatchObject({ v: 2, target: 5 });
    expect(game(db, "old").rounds).toHaveLength(1);
  });
});
