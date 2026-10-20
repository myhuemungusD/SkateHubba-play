/**
 * Dice pushes end to end inside the functions package: the handler queues a
 * /push_dispatch doc, and the push courier (push/drain.ts) turns that exact
 * doc into the FCM multicast. What this can't cover is FCM itself and the OS
 * banner on a real phone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverDispatch, type DrainDeps } from "../push/drain.js";
import { resetDieSource } from "./dice.js";
import { acceptDice, createDiceGame, nudgeDice, rollDice, sweepExpiredDiceGames } from "./handlers.js";
import { MemoryDb, NOW, actor, queueDice, seedPlayers } from "./testkit.js";

vi.mock("firebase-functions/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const DAY = 24 * 60 * 60 * 1000;

type Sent = Parameters<DrainDeps["send"]>[0];

/** Run every queued dispatch doc through the courier and return what FCM would get. */
async function courier(db: MemoryDb): Promise<Sent[]> {
  const sent: Sent[] = [];
  const deps: DrainDeps = {
    send: async (msg) => {
      sent.push(msg);
      return { failureCount: 0, responses: msg.tokens.map(() => ({ success: true })) };
    },
    prune: async () => undefined,
    warn: () => undefined,
    nowMs: NOW,
  };
  for (const [i, row] of db.added.entries()) {
    expect(row.collection).toBe("push_dispatch");
    const outcome = await deliverDispatch({ id: `d${i}`, data: row.data, delete: async () => undefined }, deps);
    expect(outcome).toBe("sent");
  }
  db.added = [];
  return sent;
}

function expectDicePush(msg: Sent | undefined, token: string, type: string, body: string): void {
  expect(msg).toEqual({
    tokens: [token],
    notification: { title: "Roll Dice", body },
    data: { gameId: "game-1", type, kind: "dice", click_action: "/dice/game-1" },
  });
}

let db: MemoryDb;

beforeEach(() => {
  db = new MemoryDb();
  seedPlayers(db);
  db.seed("pushTargets/u1", { tokens: ["phone-jason"] });
  db.seed("pushTargets/u2", { tokens: ["phone-remy"] });
});

afterEach(() => resetDieSource());

describe("dice push payloads reach the courier intact", () => {
  it("challenge, accept, turn, nudge and reminder", async () => {
    await createDiceGame(db, actor("u1"), "u2", { mode: "craps" });
    expectDicePush(
      (await courier(db))[0],
      "phone-remy",
      "dice_challenge",
      "@jason challenged you to Craps, race to 5.",
    );

    await acceptDice(db, actor("u2", NOW + 1_000), "game-1");
    expectDicePush((await courier(db))[0], "phone-jason", "dice_turn", "@remy accepted. Your roll.");

    queueDice(3, 4);
    await rollDice(db, actor("u1", NOW + 2_000), "game-1");
    expectDicePush((await courier(db))[0], "phone-remy", "dice_turn", "@jason: Natural 7 (+1 pt). 0–1. Your turn.");

    await nudgeDice(db, actor("u1", NOW + 3_000), "game-1");
    expectDicePush((await courier(db))[0], "phone-remy", "dice_turn", "@jason is waiting on your roll.");

    const remindAt = NOW + 2_000 + DAY - 3 * 3600_000;
    await sweepExpiredDiceGames(db, remindAt + 1);
    expectDicePush((await courier(db))[0], "phone-remy", "dice_turn", "About 3 hours left on your roll vs @jason.");
  });

  it("queues nothing for a skater who turned push off", async () => {
    db.seed("users/u2/private/profile", { pushEnabled: false });
    await createDiceGame(db, actor("u1"), "u2");
    expect(await courier(db)).toEqual([]);
  });
});
