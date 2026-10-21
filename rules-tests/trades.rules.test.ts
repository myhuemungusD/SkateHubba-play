/**
 * Closet trades — firestore.rules `match /trades/{tradeId}`.
 *
 * The closet callables (functions/src/closet/trading.ts) write every trade
 * with `fromUid` (proposer), `toUid` (recipient) and `parties`. The rule used
 * to check `proposerUid` / `recipientUid`, fields no writer sets, so neither
 * party could read their own trade. These tests seed the real schema.
 *
 * Accepting is NOT a client write. The recipient calls the respondTrade
 * callable, then both parties call confirmTrade (Admin SDK, rules don't
 * apply; who may do it is pinned in functions/src/closet/trading.flow.test.ts).
 * What the client needs from the rules is the reads around that flow: the
 * trade list (src/services/closet.trading.ts fetchUserTrades) and a single
 * get, at every status the callables move the trade through.
 *
 * Reads: only the two parties, by get or by a list query scoped to their
 * own party field. Writes: none from any client, admins included. Trades
 * move only through the callables (Admin SDK).
 *
 * Run: npm run test:rules (trades suite).
 */
import { describe, it, expect } from "vitest";
import { assertSucceeds, assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, getDocs, limit, orderBy, query, where, type Firestore } from "firebase/firestore";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { setupRulesTestEnv, authedContext } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-trades";

const ALICE = "alice-uid"; // proposer (fromUid)
const BOB = "bob-uid"; // recipient (toUid)
const STRANGER = "stranger-uid";
const ADMIN = "admin-uid";
const TRADE = "trade-real";
const LEGACY = "trade-legacy-fields";
const TOMBSTONED = "trade-tombstoned";

/** A trade exactly as proposeTrade writes it. */
function realTrade(fromUid: string, toUid: string, status = "pending"): Record<string, unknown> {
  const now = new Date();
  return {
    fromUid,
    toUid,
    parties: [fromUid, toUid],
    give: [{ copyId: "c1", defId: "deck-og", rarity: "rare" }],
    get: [{ copyId: "c2", defId: "wheels-og", rarity: "rare" }],
    note: null,
    imbalanced: false,
    status,
    confirmedBy: [],
    secondFactor: {},
    counterOf: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + 7 * 86400 * 1000),
  };
}

const getEnv = setupRulesTestEnv(PROJECT_ID, async (env: RulesTestEnvironment) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "trades", TRADE), realTrade(ALICE, BOB));
    // The old field names grant nothing: no writer sets them.
    await setDoc(doc(db, "trades", LEGACY), { proposerUid: ALICE, recipientUid: BOB, status: "pending" });
    // After account deletion one side is the tombstone (api/account/_closetErasure.ts).
    await setDoc(doc(db, "trades", TOMBSTONED), realTrade("deleted-user", BOB, "cancelled"));
    // A trade between two other skaters, so list queries have something to leak.
    await setDoc(doc(db, "trades", "trade-others"), realTrade(STRANGER, "someone-else"));
  });
});

function dbAs(uid: string | null): Firestore {
  const env = getEnv();
  return (uid === null ? env.unauthenticatedContext() : authedContext(env, uid)).firestore();
}

function adminDb(): Firestore {
  return getEnv().authenticatedContext(ADMIN, { email_verified: true, admin: true }).firestore();
}

describe("trades: reading", () => {
  it("the proposer (fromUid) reads the trade", async () => {
    const snap = await assertSucceeds(getDoc(doc(dbAs(ALICE), "trades", TRADE)));
    expect(snap.data()?.fromUid).toBe(ALICE);
  });

  it("the recipient (toUid) reads the trade", async () => {
    const snap = await assertSucceeds(getDoc(doc(dbAs(BOB), "trades", TRADE)));
    expect(snap.data()?.toUid).toBe(BOB);
  });

  it("a stranger is denied", async () => {
    await assertFails(getDoc(doc(dbAs(STRANGER), "trades", TRADE)));
  });

  it("a signed-out visitor is denied", async () => {
    await assertFails(getDoc(doc(dbAs(null), "trades", TRADE)));
  });

  it("an admin client is denied too (operators use the audit log)", async () => {
    await assertFails(getDoc(doc(adminDb(), "trades", TRADE)));
  });

  it("the old proposerUid / recipientUid fields grant no access", async () => {
    await assertFails(getDoc(doc(dbAs(ALICE), "trades", LEGACY)));
    await assertFails(getDoc(doc(dbAs(BOB), "trades", LEGACY)));
  });

  it("the surviving party still reads a trade whose other side was deleted", async () => {
    await assertSucceeds(getDoc(doc(dbAs(BOB), "trades", TOMBSTONED)));
    await assertFails(getDoc(doc(dbAs(STRANGER), "trades", TOMBSTONED)));
  });

  it("a party lists their trades by their own party field", async () => {
    const sent = await assertSucceeds(getDocs(query(collection(dbAs(ALICE), "trades"), where("fromUid", "==", ALICE))));
    expect(sent.docs.map((d) => d.id)).toEqual([TRADE]);
    const received = await assertSucceeds(getDocs(query(collection(dbAs(BOB), "trades"), where("toUid", "==", BOB))));
    expect(received.docs.map((d) => d.id).sort()).toEqual([TRADE, TOMBSTONED].sort());
  });

  it("a list query that could return someone else's trade is denied", async () => {
    await assertFails(getDocs(collection(dbAs(ALICE), "trades")));
    await assertFails(getDocs(query(collection(dbAs(ALICE), "trades"), where("fromUid", "==", STRANGER))));
    await assertFails(getDocs(query(collection(dbAs(ALICE), "trades"), where("status", "==", "pending"))));
    await assertFails(getDocs(query(collection(dbAs(STRANGER), "trades"), where("toUid", "==", BOB))));
  });
});

describe("trades: no client writes", () => {
  const writers: Array<[string, () => Firestore]> = [
    ["the proposer", () => dbAs(ALICE)],
    ["the recipient", () => dbAs(BOB)],
    ["a stranger", () => dbAs(STRANGER)],
    ["an admin client", adminDb],
    ["a signed-out visitor", () => dbAs(null)],
  ];

  it.each(writers)("%s cannot create a trade, even with the real shape", async (_who, db) => {
    await assertFails(setDoc(doc(db(), "trades", "forged"), realTrade(ALICE, BOB)));
  });

  it.each(writers)("%s cannot change a trade's status", async (_who, db) => {
    await assertFails(updateDoc(doc(db(), "trades", TRADE), { status: "accepted" }));
  });

  it.each(writers)("%s cannot rewrite who the parties are", async (_who, db) => {
    await assertFails(updateDoc(doc(db(), "trades", TRADE), { toUid: STRANGER, parties: [ALICE, STRANGER] }));
  });

  it.each(writers)(
    "%s cannot touch the server-only fields (confirmedBy, secondFactor, releaseAt)",
    async (_who, db) => {
      await assertFails(updateDoc(doc(db(), "trades", TRADE), { confirmedBy: [ALICE, BOB] }));
      await assertFails(updateDoc(doc(db(), "trades", TRADE), { secondFactor: { [ALICE]: true } }));
      await assertFails(updateDoc(doc(db(), "trades", TRADE), { releaseAt: new Date() }));
    },
  );

  it.each(writers)("%s cannot delete a trade", async (_who, db) => {
    await assertFails(deleteDoc(doc(db(), "trades", TRADE)));
  });
});

/** The two queries fetchUserTrades runs, exactly. */
function myTrades(db: Firestore, field: "fromUid" | "toUid", uid: string) {
  return getDocs(query(collection(db, "trades"), where(field, "==", uid), orderBy("createdAt", "desc"), limit(50)));
}

/** Each state the callables leave a trade in on the accept path (functions/src/closet/trading.ts). */
const ACCEPT_PATH: Array<[string, Record<string, unknown>]> = [
  ["offered (proposeTrade)", {}],
  ["accepted by the recipient (respondTrade accept)", { status: "accepted" }],
  ["confirmed by one side (confirmTrade)", { status: "accepted", confirmedBy: [BOB], secondFactor: { [BOB]: true } }],
  [
    "on hold (second confirm, no 2-step)",
    { status: "held", confirmedBy: [ALICE, BOB], secondFactor: { [ALICE]: true, [BOB]: false }, releaseAt: new Date() },
  ],
  ["completed (second confirm)", { status: "completed", confirmedBy: [ALICE, BOB], completedAt: new Date() }],
];

describe("trades: accepting (server path) and the client reads it depends on", () => {
  it.each(ACCEPT_PATH)("%s: both parties load it, a stranger can't", async (_step, patch) => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "trades", TRADE), patch);
    });
    for (const uid of [ALICE, BOB]) {
      const snap = await assertSucceeds(getDoc(doc(dbAs(uid), "trades", TRADE)));
      expect(snap.data()?.status).toBe(patch.status ?? "pending");
    }
    const sent = await assertSucceeds(myTrades(dbAs(ALICE), "fromUid", ALICE));
    expect(sent.docs.map((d) => d.id)).toContain(TRADE);
    const received = await assertSucceeds(myTrades(dbAs(BOB), "toUid", BOB));
    expect(received.docs.map((d) => d.id)).toContain(TRADE);

    await assertFails(getDoc(doc(dbAs(STRANGER), "trades", TRADE)));
    await assertFails(myTrades(dbAs(STRANGER), "toUid", BOB));
    const own = await assertSucceeds(myTrades(dbAs(STRANGER), "toUid", STRANGER));
    expect(own.docs).toHaveLength(0);
  });

  it("nobody can accept or confirm by writing the trade directly", async () => {
    for (const uid of [BOB, ALICE, STRANGER]) {
      await assertFails(updateDoc(doc(dbAs(uid), "trades", TRADE), { status: "accepted" }));
      await assertFails(updateDoc(doc(dbAs(uid), "trades", TRADE), { confirmedBy: [uid] }));
      await assertFails(updateDoc(doc(dbAs(uid), "trades", TRADE), { status: "completed" }));
    }
  });
});
