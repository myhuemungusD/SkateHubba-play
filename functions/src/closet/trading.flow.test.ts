/**
 * The trade flow end to end through the real callable logic: propose, accept,
 * both confirm, swap. Pins who may move a trade (only its two parties, and
 * only the recipient may accept) and the party field names the client reads
 * and firestore.rules check (fromUid / toUid; see rules-tests/trades.rules.test.ts).
 */
import { describe, expect, it } from "vitest";
import { confirmTrade, proposeTrade, respondTrade } from "./trading.js";
import { actor, copyDoc, errorCode, MemDb, seedUser, seedWallet } from "./testkit.js";

const ALICE = "alice"; // proposer
const BOB = "bob"; // recipient
const EVE = "eve"; // not a party

function world(): MemDb {
  const db = new MemDb();
  for (const uid of [ALICE, BOB, EVE]) {
    seedUser(db, uid);
    seedWallet(db, uid, 100);
  }
  db.seed(`users/${ALICE}/locker/a1`, copyDoc("deck_a"));
  db.seed(`users/${BOB}/locker/b1`, copyDoc("wheels_b"));
  return db;
}

async function offer(db: MemDb): Promise<string> {
  const { tradeId } = await proposeTrade(db, actor(ALICE), { toUid: BOB, give: ["a1"], get: ["b1"] });
  return tradeId;
}

describe("trade flow (callables)", () => {
  it("writes the party fields the rules and the client read", async () => {
    const db = world();
    const id = await offer(db);
    expect(db.doc(`trades/${id}`)).toMatchObject({
      fromUid: ALICE,
      toUid: BOB,
      parties: [ALICE, BOB],
      status: "pending",
      give: [expect.objectContaining({ copyId: "a1" })],
      get: [expect.objectContaining({ copyId: "b1" })],
    });
    expect(db.doc(`trades/${id}`)).not.toHaveProperty("proposerUid");
    expect(db.doc(`trades/${id}`)).not.toHaveProperty("recipientUid");
  });

  it("only the recipient accepts; a stranger can't accept, decline or cancel", async () => {
    const db = world();
    const id = await offer(db);
    for (const response of ["accept", "decline", "cancel"] as const) {
      expect(await errorCode(() => respondTrade(db, actor(EVE), id, response))).toBe("not_party");
    }
    expect(await errorCode(() => respondTrade(db, actor(ALICE), id, "accept"))).toBe("not_party");
    expect(db.doc(`trades/${id}`)?.status).toBe("pending");

    expect(await respondTrade(db, actor(BOB), id, "accept")).toEqual({ tradeId: id, status: "accepted" });
    expect(db.doc(`trades/${id}`)?.status).toBe("accepted");
  });

  it("a stranger can't confirm; both parties confirming swaps the items", async () => {
    const db = world();
    const id = await offer(db);
    await respondTrade(db, actor(BOB), id, "accept");

    expect(await errorCode(() => confirmTrade(db, actor(EVE), id))).toBe("not_party");
    expect(await confirmTrade(db, actor(BOB), id)).toEqual({ tradeId: id, status: "accepted" });
    expect(db.doc(`trades/${id}`)?.confirmedBy).toEqual([BOB]);
    expect(await errorCode(() => confirmTrade(db, actor(BOB), id))).toBe("already_confirmed");

    expect(await confirmTrade(db, actor(ALICE), id)).toEqual({ tradeId: id, status: "completed" });
    expect(db.doc(`users/${BOB}/locker/a1`)).toBeDefined();
    expect(db.doc(`users/${ALICE}/locker/b1`)).toBeDefined();
    expect(db.doc(`users/${ALICE}/locker/a1`)).toBeUndefined();
  });

  it("confirming without a second factor on either side puts the swap on hold", async () => {
    const db = world();
    const id = await offer(db);
    await respondTrade(db, actor(BOB), id, "accept");
    await confirmTrade(db, actor(BOB, { secondFactor: false, provider: "google.com" }), id);
    expect(await confirmTrade(db, actor(ALICE), id)).toEqual({ tradeId: id, status: "held" });
    expect(db.doc(`trades/${id}`)).toMatchObject({ status: "held", confirmedBy: [ALICE, BOB] });
  });

  it("the recipient counters with a new offer back to the proposer", async () => {
    const db = world();
    const id = await offer(db);
    expect(await errorCode(() => proposeTrade(db, actor(EVE), { toUid: ALICE, give: [], get: ["a1"] }, id))).toBe(
      "bad_items",
    );
    db.seed(`users/${EVE}/locker/e1`, copyDoc("deck_e"));
    expect(await errorCode(() => proposeTrade(db, actor(EVE), { toUid: ALICE, give: ["e1"], get: ["a1"] }, id))).toBe(
      "not_party",
    );
    const counter = await proposeTrade(db, actor(BOB), { toUid: ALICE, give: ["b1"], get: ["a1"] }, id);
    expect(db.doc(`trades/${id}`)?.status).toBe("countered");
    expect(db.doc(`trades/${counter.tradeId}`)).toMatchObject({ fromUid: BOB, toUid: ALICE, counterOf: id });
  });
});
