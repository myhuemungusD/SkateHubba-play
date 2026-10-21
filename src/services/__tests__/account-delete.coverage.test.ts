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

const UID = "u1";
const OTHER = "u2";

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

/**
 * Sample docs for every "delete" and "anonymize" collection, each owned by or
 * naming UID. The keys must match the registry exactly, so classifying a new
 * collection as deleted also forces a sample here.
 */
const SAMPLES: Record<string, Seed> = {
  users: { users: { [UID]: { username: "tonyh" }, [OTHER]: { username: "rival" } } },
  "users/{}/private": { "users/u1/private": { profile: { email: "t@example.com" }, wtt: { streak: 3 } } },
  "users/{}/achievements": { "users/u1/achievements": { a: {} } },
  "users/{}/blocked_users": { "users/u1/blocked_users": { u3: {} } },
  "users/{}/xpMarkers": { "users/u1/xpMarkers": { m: {} } },
  "users/{}/passport": { "users/u1/passport": { s1: { scope: "public" } } },
  "users/{}/checkins": { "users/u1/checkins": { c1: { spotId: "s1" } } },
  "users/{}/profileCustom": { "users/u1/profileCustom": { main: { bio: "hi" } } },
  usernames: { usernames: { tonyh: { uid: UID } } },
  "users/{}/locker": { "users/u1/locker": { deck_1: { lockedByTrade: "tHeld" } } },
  "users/{}/wallet": { "users/u1/wallet": { main: { balance: 50 } } },
  "users/{}/ledger": { "users/u1/ledger": { tx1: { amount: 50 } } },
  "users/{}/closetLimits": { "users/u1/closetLimits": { daily: { offers: 1 } } },
  "users/{}/closetDesigns": { "users/u1/closetDesigns": { d0: { shared: true } } },
  trades: {
    trades: {
      tDone: { fromUid: UID, toUid: OTHER, parties: [UID, OTHER], status: "completed", note: "deal?" },
      tHeld: {
        fromUid: OTHER,
        toUid: UID,
        parties: [OTHER, UID],
        status: "held",
        give: [{ copyId: "wheels_1" }],
        get: [{ copyId: "deck_1" }],
        secondFactor: { [UID]: false, [OTHER]: true },
      },
    },
    "users/u2/locker": { wheels_1: { lockedByTrade: "tHeld" } },
  },
  serials: { serials: { deck_7: { ownerUid: UID, history: [{ uid: OTHER }, { uid: UID }] } } },
  "drops/{}/claims": { drops: { w42: { name: "week 42" } }, "drops/w42/claims": { [UID]: {}, [OTHER]: {} } },
  "drops/{}/entries": { "drops/w42/entries": { [UID]: {} } },
  games: { games: { gDone: { player1Uid: UID, player2Uid: OTHER, status: "completed" } } },
  diceGames: {
    diceGames: {
      dDone: {
        playerUids: [UID, OTHER],
        player1Uid: UID,
        player2Uid: OTHER,
        player1Username: "tonyh",
        player2Username: "rival",
        status: "complete",
        winner: UID,
        scores: { [UID]: 3, [OTHER]: 1 },
        history: [{ uid: UID, dice: [4, 5, 6] }],
      },
    },
  },
  diceStats: { diceStats: { [UID]: { wins: 1 } } },
  diceCreateLimits: { diceCreateLimits: { [UID]: { lastCreateAt: 1 } } },
  nudges: { nudges: { n1: { senderUid: UID, recipientUid: OTHER } } },
  nudge_limits: { nudge_limits: { u1_g1: { senderUid: UID } } },
  clips: { clips: { c1: { playerUid: UID } } },
  "clips/{}/comments": {
    clips: { theirClip: { playerUid: OTHER } },
    "clips/theirClip/comments": { k1: { userId: UID } },
  },
  clipVotes: { clipVotes: { v1: { uid: UID, clipId: "theirClip" } } },
  disputes: { disputes: { x1: { setterUid: UID } } },
  disputeVotes: { disputeVotes: { v1: { uid: UID, disputeId: "nope", verdict: "land" } } },
  trainingLabels: { trainingLabels: { l1: { ownerUid: UID } } },
  trainingRevocations: { trainingRevocations: { [UID]: { revokedAt: 1 } } },
  wttVotes: { wttVotes: { theirClip_u1: { uid: UID, clipId: "theirClip" } } },
  spots: { spots: { sMine: { createdBy: UID, name: "Hubba", checkinCount: 9 } } },
  "spots/{}/comments": { "spots/sMine/comments": { k1: { userId: UID, content: "sick" } } },
  "spots/{}/messages": { "spots/sMine/messages": { m1: { userId: UID, content: "who's here" } } },
  privateSpots: {
    privateSpots: {
      pMine: { createdBy: UID, crewUids: [] },
      pCrew: { createdBy: OTHER, crewUids: [UID, "u3"] },
    },
  },
  spotMessageReports: { spotMessageReports: { r1: { reportedBy: UID } } },
  "spotPresence/{}/here": { "spotPresence/sMine/here": { [UID]: { uid: UID, username: "tonyh" } } },
  mapState: { mapState: { [UID]: { lastFix: [1, 2] } } },
  passportSettings: { passportSettings: { [UID]: { public: true } } },
  skaterActivity: { skaterActivity: { [UID]: { uid: UID, visible: true } } },
  onlineStatus: { onlineStatus: { [UID]: { hidden: false } } },
  notifications: { notifications: { n1: { recipientUid: UID } } },
  notification_limits: { notification_limits: { l1: { senderUid: UID } } },
  pushTargets: { pushTargets: { [UID]: { tokens: ["t"] } } },
  push_dispatch: { push_dispatch: { p1: { recipientUid: UID } } },
  push_dispatch_limits: { push_dispatch_limits: { l1: { senderUid: UID } } },
  reports: { reports: { r1: { reporterUid: UID, reportedUid: OTHER } } },
  reports_limits: { reports_limits: { u1_u2: { reporterUid: UID } } },
  moderationStatements: { moderationStatements: { s1: { subjectUid: UID } } },
  appeals: { appeals: { a1: { appellantUid: UID } } },
  proReviews: { proReviews: { c_u1: { uid: UID } } },
  proChallenges: { proChallenges: { ch1: { proUid: UID } } },
  proChallengeEntries: { proChallengeEntries: { ch9_u1: { uid: UID } } },
  proProps: { proProps: { p1: { fromUid: UID, toUid: OTHER }, p2: { fromUid: OTHER, toUid: UID } } },
  proFeatured: { proFeatured: { theirClip: { proUid: UID } } },
};

/** Retained collections seeded too, to prove they are left alone. */
const RETAINED_SAMPLES: Seed = {
  bans: { [UID]: { reason: "spam" } },
  closetAudit: { a1: { targetUid: UID } },
  adminAudit: { a1: { targetId: UID } },
  xpPairs: { u1_u2: { utcDay: 1, count: 2 } },
  proGold: { theirClip: { uid: UID } },
  proBlessings: { b1: { blesserUid: OTHER, targetUid: UID } },
};

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

const MEDIA = [
  "games/gDone/round1.webm",
  "users/u1/avatar.webp",
  "users/u1/banner.webp",
  "closetDesigns/u1/d0.png",
  "userClips/u1/c1.mp4",
  "approvedClips/u1/c1.mp4",
  "users/u2/avatar.webp",
  "approvedClips/u2/c9.mp4",
];

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
      serials: 1,
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
      diceGames: { live: { player1Uid: UID, player2Uid: OTHER, status: "active", rollCount: 2 } },
      diceStats: { [OTHER]: { wins: 1, losses: 0, gamesPlayed: 1 } },
    });
    await deleteUserDataAsAdmin(store.deps, UID);
    const statsRead = store.events.indexOf("tx:get:diceStats/u2");
    const firstWrite = store.events.findIndex((e) => /^tx:(set|update|delete):/.test(e));
    expect(statsRead).toBeGreaterThanOrEqual(0);
    expect(statsRead).toBeLessThan(firstWrite);
    expect(store.docs.get("diceStats/u2")).toMatchObject({ wins: 2, gamesPlayed: 2 });
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
