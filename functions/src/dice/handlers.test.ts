import { beforeEach, describe, expect, it, vi } from "vitest";
import { FieldValue } from "firebase-admin/firestore";
import { setDieSource, resetDieSource } from "./dice.js";
import {
  claimDiceTimeout,
  createDiceGame,
  declineDice,
  DiceActionError,
  quitDice,
  rollDice,
  sweepExpiredDiceGames,
} from "./handlers.js";
import type { DiceDb, DiceDoc, DiceQuery, DiceTx } from "./store.js";

vi.mock("firebase-functions/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const NOW = 1_700_000_000_000;

class MemoryDb implements DiceDb {
  docs = new Map<string, Record<string, unknown>>();
  added: Array<{ collection: string; data: Record<string, unknown> }> = [];
  private seq = 0;

  seed(path: string, data: Record<string, unknown>): void {
    this.docs.set(path, { ...data });
  }

  async get(path: string): Promise<DiceDoc> {
    const data = this.docs.get(path);
    const id = path.split("/").pop() ?? path;
    return { id, data: data ? { ...data } : undefined };
  }

  async query(q: DiceQuery): Promise<DiceDoc[]> {
    const prefix = `${q.collection}/`;
    const matches: DiceDoc[] = [];
    for (const [path, data] of this.docs) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.includes("/")) continue;
      const ok = q.filters.every((filter) => {
        const value = data[filter.field];
        if (filter.op === "==") return value === filter.value;
        return typeof value === "number" && typeof filter.value === "number" && value < filter.value;
      });
      if (ok) matches.push({ id: rest, data: { ...data } });
    }
    return q.limit === undefined ? matches : matches.slice(0, q.limit);
  }

  async add(collection: string, data: Record<string, unknown>): Promise<void> {
    this.added.push({ collection, data });
  }

  newId(): string {
    this.seq += 1;
    return `game-${this.seq}`;
  }

  async runTransaction<T>(fn: (tx: DiceTx) => Promise<T>): Promise<T> {
    const snapshot = new Map(this.docs);
    const tx: DiceTx = {
      get: (path) => this.get(path),
      query: (q) => this.query(q),
      set: (path, data, merge) => {
        const prev = merge ? this.docs.get(path) : undefined;
        this.docs.set(path, { ...(prev ?? {}), ...data });
      },
      update: (path, data) => {
        const prev = this.docs.get(path);
        if (!prev) throw new Error(`missing ${path}`);
        this.docs.set(path, { ...prev, ...data });
      },
    };
    try {
      return await fn(tx);
    } catch (err) {
      this.docs = snapshot;
      throw err;
    }
  }
}

function seedPlayers(db: MemoryDb): void {
  db.seed("users/u1", { username: "jason" });
  db.seed("users/u2", { username: "remy" });
}

function actor(uid: string, nowMs = NOW, emailVerified = true) {
  return { uid, nowMs, emailVerified };
}

function queueDice(...values: number[]): void {
  let i = 0;
  setDieSource(() => {
    if (i >= values.length) throw new Error("die queue exhausted");
    return values[i++]!;
  });
}

describe("createDiceGame", () => {
  let db: MemoryDb;

  beforeEach(() => {
    db = new MemoryDb();
    seedPlayers(db);
  });

  it("opens a match on the challenger's turn and does not notify anyone", async () => {
    const created = await createDiceGame(db, actor("u1"), "u2");
    expect(created).toMatchObject({ gameId: "game-1", status: "active", currentTurn: "u1", applied: true });
    const doc = db.docs.get("diceGames/game-1");
    expect(doc).toMatchObject({
      game: "clo",
      playerUids: ["u1", "u2"],
      player1Username: "jason",
      player2Username: "remy",
      stake: null,
      turnDeadline: NOW + 24 * 60 * 60 * 1000,
    });
    expect(db.added).toEqual([]);
    expect([...db.docs.keys()].some((path) => path.startsWith("notifications/"))).toBe(false);
  });

  it("rejects an unverified email, a self challenge, a missing user, a ban, and a block", async () => {
    await expect(createDiceGame(db, actor("u1", NOW, false), "u2")).rejects.toMatchObject({ code: "email_unverified" });
    await expect(createDiceGame(db, actor("u1"), "u1")).rejects.toMatchObject({ code: "self_challenge" });
    await expect(createDiceGame(db, actor("u1"), "missing")).rejects.toMatchObject({ code: "not_found" });

    db.seed("bans/u1", { reason: "spam" });
    await expect(createDiceGame(db, actor("u1"), "u2")).rejects.toMatchObject({ code: "banned" });
    db.docs.delete("bans/u1");

    db.seed("users/u2/blocked_users/u1", { at: 1 });
    await expect(createDiceGame(db, actor("u1"), "u2")).rejects.toMatchObject({ code: "blocked" });
  });

  it("refuses a second create inside the cooldown and an eleventh active game", async () => {
    await createDiceGame(db, actor("u1"), "u2");
    await expect(createDiceGame(db, actor("u1", NOW + 1_000), "u2")).rejects.toMatchObject({ code: "slow_down" });

    db.docs.delete("diceCreateLimits/u1");
    for (let i = 0; i < 9; i++) {
      db.seed(`diceGames/extra-${i}`, { player1Uid: "u1", player2Uid: "u2", status: "active" });
    }
    await expect(createDiceGame(db, actor("u1", NOW + 20_000), "u2")).rejects.toMatchObject({
      code: "too_many_active",
    });
  });
});

describe("roll, quit, decline, timeout", () => {
  let db: MemoryDb;
  let gameId: string;

  beforeEach(async () => {
    db = new MemoryDb();
    seedPlayers(db);
    resetDieSource();
    const created = await createDiceGame(db, actor("u1"), "u2");
    gameId = created.gameId;
  });

  it("rejects the opponent rolling first, and a roll after the match is over", async () => {
    queueDice(2, 2, 5);
    await expect(rollDice(db, actor("u2"), gameId)).rejects.toMatchObject({ code: "not_your_turn" });
    await quitDice(db, actor("u1"), gameId);
    queueDice(2, 2, 5);
    await expect(rollDice(db, actor("u1"), gameId)).rejects.toMatchObject({ code: "game_over" });
  });

  it("keeps the turn on a re-roll and passes it when a point lands", async () => {
    queueDice(1, 3, 5);
    const reroll = await rollDice(db, actor("u1"), gameId);
    expect(reroll).toMatchObject({ label: "RE-ROLL", currentTurn: "u1", status: "active" });
    expect(db.added).toEqual([]);

    queueDice(2, 2, 5);
    const point = await rollDice(db, actor("u1", NOW + 2_000), gameId);
    expect(point).toMatchObject({ label: "POINT 5", currentTurn: "u2" });
    const note = [...db.docs.entries()].find(([path]) => path.startsWith("notifications/"));
    expect(note?.[1]).toMatchObject({
      type: "dice_challenge",
      recipientUid: "u2",
      body: "@jason rolled POINT 5 — your roll",
    });
  });

  it("rejects a second roll inside one second", async () => {
    queueDice(1, 3, 5, 2, 2, 4);
    await rollDice(db, actor("u1"), gameId);
    await expect(rollDice(db, actor("u1", NOW + 100), gameId)).rejects.toMatchObject({ code: "slow_down" });
  });

  it("counts a won round on the match and does not touch lifetime stats yet", async () => {
    queueDice(2, 2, 3);
    await rollDice(db, actor("u1"), gameId);
    queueDice(4, 5, 6);
    const won = await rollDice(db, actor("u2", NOW + 2_000), gameId);
    expect(won.status).toBe("active");
    expect(won.roundsWon).toEqual({ u1: 0, u2: 1 });
    expect(won.currentTurn).toBe("u1");
    expect(db.docs.has("diceStats/u1")).toBe(false);
    expect(db.docs.has("diceStats/u2")).toBe(false);
  });

  it("a decline before anyone settles writes no stats", async () => {
    const declined = await declineDice(db, actor("u2"), gameId);
    expect(declined).toMatchObject({ status: "declined", winner: null });
    expect(db.docs.has("diceStats/u1")).toBe(false);
    expect([...db.docs.values()].some((doc) => doc.type === "dice_result" && doc.recipientUid === "u1")).toBe(true);
  });

  it("quitting after a roll forfeits to the player who stayed and records the win", async () => {
    queueDice(2, 2, 5);
    await rollDice(db, actor("u1"), gameId);
    const left = await quitDice(db, actor("u1", NOW + 2_000), gameId);
    expect(left).toMatchObject({ status: "forfeit", winner: "u2" });
    expect(db.docs.get("diceStats/u2")).toMatchObject({ wins: 1, losses: 0, gamesPlayed: 1 });
    expect(db.docs.get("diceStats/u1")).toMatchObject({ wins: 0, losses: 1, gamesPlayed: 1 });
  });

  it("an unstarted timeout expires with no stats, a started one forfeits", async () => {
    const early = await claimDiceTimeout(db, actor("u2", NOW + 24 * 60 * 60 * 1000 + 1), gameId);
    expect(early).toMatchObject({ status: "expired", applied: true, winner: null });
    expect(db.docs.has("diceStats/u2")).toBe(false);

    const again = new MemoryDb();
    seedPlayers(again);
    const created = await createDiceGame(again, actor("u1"), "u2");
    queueDice(1, 3, 5);
    await rollDice(again, actor("u1"), created.gameId);
    const late = await claimDiceTimeout(again, actor("u2", NOW + 24 * 60 * 60 * 1000 + 5), created.gameId);
    expect(late).toMatchObject({ status: "forfeit", winner: "u2", applied: true });
    expect(again.docs.get("diceStats/u2")).toMatchObject({ wins: 1 });
  });

  it("claimTimeout is a no-op before the deadline", async () => {
    const pending = await claimDiceTimeout(db, actor("u1", NOW + 1_000), gameId);
    expect(pending.applied).toBe(false);
    expect(pending.status).toBe("active");
  });

  it("a stranger cannot roll", async () => {
    db.seed("users/u3", { username: "ace" });
    await expect(rollDice(db, actor("u3"), gameId)).rejects.toMatchObject({ code: "not_a_player" });
  });
});

describe("pushes and the sweep", () => {
  it("writes a dice push when the recipient allows it and has tokens", async () => {
    const db = new MemoryDb();
    seedPlayers(db);
    db.seed("users/u2/private/profile", { pushEnabled: true });
    db.seed("pushTargets/u2", { tokens: ["tok-1", ""] });
    const created = await createDiceGame(db, actor("u1"), "u2");
    queueDice(2, 2, 5);
    await rollDice(db, actor("u1"), created.gameId);
    expect(db.added).toHaveLength(1);
    expect(db.added[0]?.data).toMatchObject({
      tokens: ["tok-1"],
      recipientUid: "u2",
      data: { kind: "dice", gameId: created.gameId, click_action: `/dice/${created.gameId}` },
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  it("skips the push when the recipient turned notifications off", async () => {
    const db = new MemoryDb();
    seedPlayers(db);
    db.seed("users/u2/private/profile", { pushEnabled: false });
    db.seed("pushTargets/u2", { tokens: ["tok-1"] });
    const created = await createDiceGame(db, actor("u1"), "u2");
    queueDice(2, 2, 5);
    await rollDice(db, actor("u1"), created.gameId);
    expect(db.added).toEqual([]);
  });

  it("the sweep closes only games whose deadline has passed", async () => {
    const db = new MemoryDb();
    seedPlayers(db);
    const fresh = await createDiceGame(db, actor("u1"), "u2");
    db.seed("diceGames/old", {
      player1Uid: "u1",
      player2Uid: "u2",
      player1Username: "jason",
      player2Username: "remy",
      status: "active",
      currentTurn: "u1",
      round: 1,
      roundsWon: { u1: 0, u2: 0 },
      results: {},
      rollCount: 0,
      winner: null,
      endReason: null,
      turnDeadline: NOW - 1,
    });
    const closed = await sweepExpiredDiceGames(db, NOW + 1_000);
    expect(closed).toBe(1);
    expect(db.docs.get("diceGames/old")?.status).toBe("expired");
    expect(db.docs.get(`diceGames/${fresh.gameId}`)?.status).toBe("active");
  });

  it("logs and continues when one swept game cannot be closed", async () => {
    const db = new MemoryDb();
    db.seed("diceGames/bad", {
      player1Uid: "u1",
      status: "active",
      turnDeadline: NOW - 1,
    });
    const closed = await sweepExpiredDiceGames(db, NOW);
    expect(closed).toBe(0);
  });
});

describe("DiceActionError", () => {
  it("carries a stable code", () => {
    const err = new DiceActionError("slow_down");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("slow_down");
  });
});
