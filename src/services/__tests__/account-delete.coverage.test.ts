/**
 * Account-deletion COVERAGE tests (Apple 5.1.1(v)).
 *
 * 1. Every Firestore collection in firestore.rules and every Storage folder in
 *    storage.rules must be listed in `api/account/_userDataRegistry.ts` with
 *    what deletion does to it. A new collection that nobody classified fails
 *    here, before it can ship user data that deletion never reaches.
 * 2. One account with a doc in EVERY "delete" or "anonymize" collection is
 *    erased, and afterwards nothing outside the "retain" list still names its
 *    uid, as a value, a map key or a path segment.
 * 3. The behaviour of the shared-record phases (dice, trades, serials, spots)
 *    in detail: what is anonymized, what is unwound, what is deleted.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

const fp = vi.hoisted(() => ({ documentId: { __fieldPath: "__name__" } }));
vi.mock("firebase-admin/firestore", () => ({
  FieldPath: { documentId: () => fp.documentId },
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}));

import { deleteUserDataAsAdmin, OTHER_USER_SUBCOLLECTIONS } from "../../../api/account/_deleteUserData";
import { FIRESTORE_ERASURE, STORAGE_ERASURE } from "../../../api/account/_userDataRegistry";
import { DELETED_NAME, DELETED_UID, scrubUid } from "../../../api/account/_anonymize";
import { TRADE_FEE } from "../../../api/account/_closetErasure";
import { makeFakeStore, type DocData, type Seed } from "./account-delete.test-helpers";
import { MEDIA, OTHER, RETAINED_SAMPLES, SAMPLES, UID } from "./account-delete.samples.test-helpers";

// ── Rules parsing ──────────────────────────────────────────────────────────

/**
 * Collection paths declared in a rules file, with every id segment written as
 * `{}`: `match /users/{uid}/wallet/{id}` becomes `users/{}/wallet`. Nested
 * `match` blocks are joined with their parents by tracking brace depth.
 */
function rulesCollections(source: string): Set<string> {
  const text = source.replace(/\/\/[^\n]*/g, "");
  const stack: { depth: number; path: string }[] = [];
  const out = new Set<string>();
  let depth = 0;
  for (const m of text.matchAll(/match\s+(\/\S+)\s*\{|\{|\}/g)) {
    if (m[1] !== undefined) {
      depth += 1;
      stack.push({ depth, path: m[1] });
      const full = stack.map((s) => s.path).join("");
      const segs = full
        .replace(/^\/databases\/\{database\}\/documents/, "")
        .replace(/^\/b\/\{bucket\}\/o/, "")
        .split("/")
        .filter((s) => s.length > 0)
        .map((s) => (s.startsWith("{") ? "{}" : s));
      if (segs.length === 0) continue;
      out.add((segs.length % 2 === 0 ? segs.slice(0, -1) : segs).join("/"));
    } else if (m[0] === "{") {
      depth += 1;
    } else {
      while (stack.length > 0 && stack[stack.length - 1].depth === depth) stack.pop();
      depth -= 1;
    }
  }
  return out;
}

/** Collections only the Cloud Functions write, so they have no rules block. */
const FUNCTIONS_ONLY = ["xpPairs", "users/{}/closetLimits"];

/** users/{uid} subcollections the orchestrator counts on their own. */
const COUNTED_USER_SUBCOLLECTIONS = ["achievements", "locker", "xpMarkers", "blocked_users"];

describe("every collection is classified", () => {
  const firestore = rulesCollections(readFileSync("firestore.rules", "utf8"));

  it("finds the collections (parser sanity check)", () => {
    expect(firestore.has("users")).toBe(true);
    expect(firestore.has("users/{}/wallet")).toBe(true);
    expect(firestore.has("spots/{}/messages")).toBe(true);
    expect(firestore.has("spotPresence/{}/here")).toBe(true);
    expect(firestore.size).toBeGreaterThan(50);
  });

  it("lists every firestore.rules collection in _userDataRegistry.ts", () => {
    const missing = [...firestore].filter((c) => !(c in FIRESTORE_ERASURE));
    expect(missing).toEqual([]);
  });

  it("has no stale registry entries", () => {
    const known = new Set([...firestore, ...FUNCTIONS_ONLY]);
    expect(Object.keys(FIRESTORE_ERASURE).filter((c) => !known.has(c))).toEqual([]);
  });

  it("gives every retained collection a reason", () => {
    for (const entry of Object.values(FIRESTORE_ERASURE)) expect(entry.why.length).toBeGreaterThan(5);
  });

  it("names every deleted users/{uid} subcollection in the identity phase", () => {
    const handled = new Set<string>([...COUNTED_USER_SUBCOLLECTIONS, ...OTHER_USER_SUBCOLLECTIONS]);
    const userSubs = Object.entries(FIRESTORE_ERASURE)
      .filter(([path]) => path.startsWith("users/{}/"))
      .map(([path, entry]) => ({ name: path.slice("users/{}/".length), action: entry.action }));
    for (const { name, action } of userSubs) {
      expect(action).toBe("delete");
      expect(handled.has(name)).toBe(true);
    }
  });

  it("lists every storage.rules folder", () => {
    const storage = rulesCollections(readFileSync("storage.rules", "utf8"));
    const folders = new Set([...storage].map((p) => p.split("/")[0]).filter((f) => f !== "{}"));
    expect([...folders].filter((f) => !(f in STORAGE_ERASURE))).toEqual([]);
  });
});

// ── Full erasure over one doc per collection ───────────────────────────────

function mergeSeeds(seeds: Seed[]): Seed {
  const out: Seed = {};
  for (const seed of seeds) {
    for (const [col, docs] of Object.entries(seed)) out[col] = { ...(out[col] ?? {}), ...docs };
  }
  return out;
}

/** True when `uid` appears anywhere in `value`, as a value or a map key. */
function mentionsUid(value: unknown, uid: string): boolean {
  if (value === uid) return true;
  if (Array.isArray(value)) return value.some((item) => mentionsUid(item, uid));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, inner]) => key === uid || mentionsUid(inner, uid));
}

describe("erasing an account with data everywhere", () => {
  const actionable = Object.entries(FIRESTORE_ERASURE)
    .filter(([, e]) => e.action === "delete" || e.action === "anonymize")
    .map(([path]) => path);

  it("has a sample doc for every deleted or anonymized collection", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(actionable.sort());
  });

  it("leaves nothing that names the uid outside the retained collections", async () => {
    const store = makeFakeStore(mergeSeeds([...Object.values(SAMPLES), RETAINED_SAMPLES]), MEDIA);
    await deleteUserDataAsAdmin(store.deps, UID);

    const retained = new Set(Object.keys(RETAINED_SAMPLES));
    const leftovers = [...store.docs.entries()]
      .filter(([path]) => !retained.has(path.split("/")[0]))
      .filter(([path, data]) => path.split("/").includes(UID) || mentionsUid(data, UID))
      .map(([path]) => path);
    expect(leftovers).toEqual([]);

    // Retained on purpose, untouched.
    for (const [col, docs] of Object.entries(RETAINED_SAMPLES)) {
      for (const id of Object.keys(docs)) expect(store.docs.has(`${col}/${id}`)).toBe(true);
    }
    expect([...store.objects].sort()).toEqual(["approvedClips/u2/c9.mp4", "users/u2/avatar.webp"]);
  });

  it("keeps each anonymized record for the other skater", async () => {
    const store = makeFakeStore(mergeSeeds(Object.values(SAMPLES)));
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(store.docs.get("diceGames/dDone")).toMatchObject({
      playerUids: [DELETED_UID, OTHER],
      player1Uid: DELETED_UID,
      player1Username: DELETED_NAME,
      player2Username: "rival",
      winner: DELETED_UID,
      scores: { [DELETED_UID]: 3, [OTHER]: 1 },
      history: [{ uid: DELETED_UID, dice: [4, 5, 6] }],
    });
    expect(store.docs.get("trades/tDone")).toMatchObject({ fromUid: DELETED_UID, toUid: OTHER, note: "" });
    expect(store.docs.get("serials/deck_7")).toEqual({
      ownerUid: DELETED_UID,
      history: [{ uid: OTHER }, { uid: DELETED_UID }],
    });
    // Traded away: still scrubbed so the uid is gone from history.
    expect(store.docs.get("serials/wheels_3")).toEqual({
      ownerUid: OTHER,
      history: [
        { uid: DELETED_UID, at: 1, reason: "mint" },
        { uid: OTHER, at: 2, reason: "trade", tradeId: "tDone" },
      ],
    });
    expect(store.docs.get("spots/sMine")).toEqual({ createdBy: DELETED_UID, name: "Hubba", checkinCount: 9 });
    expect(store.docs.get("privateSpots/pCrew")).toEqual({ createdBy: OTHER, crewUids: ["u3"] });
    expect(store.docs.has("privateSpots/pMine")).toBe(false);
    expect(store.docs.has("drops/w42/claims/u2")).toBe(true);
    expect(store.docs.has("clips/theirClip")).toBe(true);

    expect(summary.diceGamesAnonymized).toBe(1);
    expect(summary.closet).toEqual({
      tradesSettled: 1,
      tradesAnonymized: 2,
      tradesDeleted: 0,
      serials: 2,
      dropRecords: 2,
    });
    expect(summary.content).toEqual({
      spotMessages: 1,
      comments: 2,
      spotPresence: 1,
      mapDocs: 4,
      privateSpots: 1,
      spotsAnonymized: 1,
      crewListsUpdated: 1,
      spotMessageReports: 1,
      wttVotes: 1,
      notificationsSent: 1,
      proContent: 6,
      rateLimits: 4,
      mediaObjects: 0,
    });
    expect(summary.userSubcollectionDocs).toBe(9);
  });

  it("is safe to run twice", async () => {
    const store = makeFakeStore(mergeSeeds(Object.values(SAMPLES)), MEDIA);
    await deleteUserDataAsAdmin(store.deps, UID);
    const after = [...store.docs.entries()];
    const second = await deleteUserDataAsAdmin(store.deps, UID);
    expect([...store.docs.entries()]).toEqual(after);
    expect(second.closet.tradesSettled).toBe(0);
    expect(second.content.mediaObjects).toBe(0);
  });
});

// ── Shared-record details ──────────────────────────────────────────────────

describe("Roll Dice anonymization", () => {
  it("closes a pending challenge the same way as an unstarted match", async () => {
    const store = makeFakeStore({
      diceGames: {
        sent: { player1Uid: UID, player2Uid: OTHER, status: "pending" },
        got: { player1Uid: OTHER, player2Uid: UID, status: "pending" },
      },
    });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);
    expect(summary.diceGames).toBe(2);
    expect(store.docs.get("diceGames/sent")).toMatchObject({ status: "expired", endReason: "quit", winner: null });
    expect(store.docs.get("diceGames/got")).toMatchObject({ status: "declined", endReason: "decline" });
  });

  it("reads the winner's stats before writing anything in the transaction", async () => {
    const store = makeFakeStore({
      diceGames: { live: { player1Uid: UID, player2Uid: OTHER, status: "active", rollCount: 2, mode: "clo" } },
      diceStats: { [OTHER]: { wins: 1, losses: 0, gamesPlayed: 1 }, [UID]: { wins: 0, losses: 2, rep: 1000 } },
    });
    await deleteUserDataAsAdmin(store.deps, UID);
    const statsRead = store.events.indexOf("tx:get:diceStats/u2");
    const firstWrite = store.events.findIndex((e) => /^tx:(set|update|delete):/.test(e));
    expect(statsRead).toBeGreaterThanOrEqual(0);
    expect(statsRead).toBeLessThan(firstWrite);
    // Mirrors writeStats: streak, bestStreak, byMode and Rep move too (not just wins).
    expect(store.docs.get("diceStats/u2")).toMatchObject({
      wins: 2,
      gamesPlayed: 2,
      streak: 1,
      bestStreak: 1,
      byMode: { clo: { wins: 1, losses: 0 } },
      rep: 1016,
      peakRep: 1016,
    });
    // Reads both sides before any write (survivor + departing, for the Rep swing).
    expect(store.events.indexOf("tx:get:diceStats/u1")).toBeGreaterThanOrEqual(0);
    expect(store.events.indexOf("tx:get:diceStats/u1")).toBeLessThan(firstWrite);
  });

  it("deletes a match when the other seat already belongs to a deleted account", async () => {
    const store = makeFakeStore({
      diceGames: {
        both: { player1Uid: DELETED_UID, player2Uid: UID, status: "complete" },
        self: { player1Uid: UID, player2Uid: UID, status: "complete" },
      },
    });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.docs.has("diceGames/both")).toBe(false);
    expect(store.docs.has("diceGames/self")).toBe(false);
    expect(summary.diceGamesDeleted).toBe(2);
  });

  it("never credits a win to the tombstone", async () => {
    const store = makeFakeStore({
      diceGames: { odd: { player1Uid: UID, player2Uid: DELETED_UID, status: "active", rollCount: 1 } },
    });
    await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.docs.has(`diceStats/${DELETED_UID}`)).toBe(false);
    expect(store.docs.has("diceGames/odd")).toBe(false);
  });

  it("skips a match that vanished between the scan and the transaction", async () => {
    const store = makeFakeStore({ diceGames: { gone: { player1Uid: UID, player2Uid: OTHER, status: "complete" } } });
    const realTx = store.db.runTransaction.bind(store.db);
    let first = true;
    store.db.runTransaction = (fn) => {
      if (first) {
        first = false;
        store.docs.delete("diceGames/gone");
      }
      return realTx(fn);
    };
    const summary = await deleteUserDataAsAdmin(store.deps, UID);
    expect(summary.diceGamesAnonymized + summary.diceGamesDeleted).toBe(0);
  });
});

describe("TRADE_FEE stays in sync with the closet economy", () => {
  it("matches functions/src/closet/economy.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "functions/src/closet/economy.ts"), "utf8");
    const match = src.match(/export const TRADE_FEE = (\d+);/);
    expect(match?.[1]).toBe(String(TRADE_FEE));
  });
});

describe("closet trades", () => {
  function heldTrade(extra: DocData = {}): Seed {
    return {
      trades: {
        t1: {
          fromUid: UID,
          toUid: OTHER,
          status: "held",
          give: [{ copyId: "mine_1" }],
          get: [{ copyId: "theirs_1" }, { copyId: "theirs_2" }, { bad: true }],
          ...extra,
        },
      },
      "users/u1/locker": { mine_1: { lockedByTrade: "t1" } },
      "users/u2/locker": { theirs_1: { lockedByTrade: "t1" }, theirs_2: { lockedByTrade: "tOther" } },
      "users/u2/wallet": { main: { balance: 5, earnedBal: 5, boughtBal: 0 } },
    };
  }

  it("unwinds a held trade for the other skater: unlock their items, refund their fee", async () => {
    const store = makeFakeStore(heldTrade());
    await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.docs.get("users/u2/locker/theirs_1")).toEqual({ lockedByTrade: null });
    // Locked by a different trade: not ours to release.
    expect(store.docs.get("users/u2/locker/theirs_2")).toEqual({ lockedByTrade: "tOther" });
    expect(store.docs.get("users/u2/wallet/main")).toMatchObject({
      balance: 5 + TRADE_FEE,
      earnedBal: 5 + TRADE_FEE,
      boughtBal: 0,
    });
    expect(store.docs.get("users/u2/ledger/trade_refund_t1")).toMatchObject({
      kind: "credit",
      amount: TRADE_FEE,
      reason: "trade_fee_refund",
      ref: "t1",
      balanceAfter: 5 + TRADE_FEE,
    });
    expect(store.docs.get("trades/t1")).toMatchObject({
      status: "failed",
      failReason: "account_deleted",
      fromUid: DELETED_UID,
      toUid: OTHER,
    });
  });

  it("never refunds twice when the refund row already exists", async () => {
    const seed = heldTrade();
    seed["users/u2/ledger"] = { trade_refund_t1: { amount: TRADE_FEE } };
    const store = makeFakeStore(seed);
    await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.docs.get("users/u2/wallet/main")).toMatchObject({ balance: 5 });
  });

  it("refunds into an empty wallet when the other skater has none yet", async () => {
    const seed = heldTrade({ fromUid: OTHER, toUid: UID, give: [{ copyId: "theirs_1" }], get: [] });
    delete seed["users/u2/wallet"];
    const store = makeFakeStore(seed);
    await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.docs.get("users/u2/wallet/main")).toMatchObject({ balance: TRADE_FEE, earnedBal: TRADE_FEE });
    expect(store.docs.get("users/u2/locker/theirs_1")).toEqual({ lockedByTrade: null });
    // They proposed it, so the note was theirs and stays.
    expect(store.docs.get("trades/t1")).not.toHaveProperty("note", "");
  });

  it("cancels pending and accepted offers without touching any wallet", async () => {
    const store = makeFakeStore({
      trades: {
        p: { fromUid: OTHER, toUid: UID, status: "pending", note: "yours?" },
        a: { fromUid: UID, toUid: OTHER, status: "accepted", note: "mine" },
      },
    });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.docs.get("trades/p")).toMatchObject({ status: "cancelled", toUid: DELETED_UID, note: "yours?" });
    expect(store.docs.get("trades/a")).toMatchObject({ status: "cancelled", fromUid: DELETED_UID, note: "" });
    expect(store.docs.has("users/u2/wallet/main")).toBe(false);
    expect(summary.closet.tradesSettled).toBe(2);
  });

  it("deletes a trade when the other side is already gone", async () => {
    const store = makeFakeStore({
      trades: {
        gone: { fromUid: DELETED_UID, toUid: UID, status: "held", give: [], get: [] },
        broken: { fromUid: UID, status: "completed" },
      },
    });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.docs.has("trades/gone")).toBe(false);
    expect(store.docs.has("trades/broken")).toBe(false);
    expect(store.docs.has(`users/${DELETED_UID}/wallet/main`)).toBe(false);
    expect(summary.closet.tradesDeleted).toBe(2);
  });

  it("tolerates trade items with no list at all", async () => {
    const store = makeFakeStore({ trades: { t: { fromUid: OTHER, toUid: UID, status: "held" } } });
    await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.docs.get("trades/t")).toMatchObject({ status: "failed" });
  });

  it("skips a trade that vanished between the scan and the transaction", async () => {
    const store = makeFakeStore({ trades: { t: { fromUid: UID, toUid: OTHER, status: "completed" } } });
    const realTx = store.db.runTransaction.bind(store.db);
    store.db.runTransaction = (fn) => {
      store.docs.delete("trades/t");
      return realTx(fn);
    };
    const summary = await deleteUserDataAsAdmin(store.deps, UID);
    expect(summary.closet.tradesAnonymized + summary.closet.tradesDeleted).toBe(0);
  });
});

describe("spots and crews", () => {
  it("removes the uid from crew lists and leaves malformed ones alone", async () => {
    const store = makeFakeStore({ privateSpots: { p: { createdBy: OTHER, crewUids: [UID] } } });
    // A malformed list never matches array-contains, so it is left alone.
    store.docs.set("privateSpots/q", { createdBy: OTHER, crewUids: "not-a-list" });
    await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.docs.get("privateSpots/p")).toEqual({ createdBy: OTHER, crewUids: [] });
    expect(store.docs.get("privateSpots/q")).toEqual({ createdBy: OTHER, crewUids: "not-a-list" });
  });

  it("only deletes this account's chat and comments", async () => {
    const store = makeFakeStore({
      "spots/s/messages": { mine: { userId: UID }, theirs: { userId: OTHER } },
      "spots/s/comments": { mine: { userId: UID }, theirs: { userId: OTHER } },
      "clips/c/comments": { theirs: { userId: OTHER } },
    });
    await deleteUserDataAsAdmin(store.deps, UID);
    expect([...store.docs.keys()].sort()).toEqual([
      "clips/c/comments/theirs",
      "spots/s/comments/theirs",
      "spots/s/messages/theirs",
    ]);
  });
});

describe("scrubUid", () => {
  it("passes typed values (Timestamps, GeoPoints) through untouched", () => {
    class Stamp {
      constructor(readonly ms: number) {}
    }
    const at = new Stamp(5);
    const out = scrubUid({ at, who: UID, nested: [{ [UID]: 1 }], bare: Object.create(null) }, UID) as DocData;
    expect(out.at).toBe(at);
    expect(out.who).toBe(DELETED_UID);
    expect(out.nested).toEqual([{ [DELETED_UID]: 1 }]);
    expect(scrubUid(null, UID)).toBeNull();
  });
});
