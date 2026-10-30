/**
 * Edge paths of the shared-record erasure phases (api/account/_skateErasure.ts,
 * _diceErasure.ts, _closetErasure.ts), driven straight through each phase.
 *
 * The cascade tests cover the common shapes. These cover what happens when the
 * account sits in the OTHER seat, when a record changes between the scan and
 * the transaction (the race every phase re-reads for), and when a record is
 * malformed. Each one is a way a deleted account could otherwise be left named
 * in someone else's game, or a survivor could be wrongly credited.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldPath: { documentId: () => ({ __fieldPath: "__name__" }) },
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}));

import type { Firestore } from "firebase-admin/firestore";
import { anonymizeJudgedGames, anonymizedSkateGame, eraseActiveSkateGames } from "../../../api/account/_skateErasure";
import { eraseDiceGames } from "../../../api/account/_diceErasure";
import { eraseCloset } from "../../../api/account/_closetErasure";
import { eraseOwnedContent } from "../../../api/account/_ownedContent";
import { DELETED_NAME, DELETED_UID } from "../../../api/account/_anonymize";
import { makeFakeStore, type DocData, type FakeStore, type Seed } from "./account-delete.test-helpers";

const UID = "uidLeaving000000000000000001";
const OTHER = "uidStaying000000000000000002";
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);

function storeOf(seed: Seed, objects: string[] = []): FakeStore {
  return makeFakeStore(seed, objects);
}

function dbOf(store: FakeStore): Firestore {
  return store.deps.db;
}

/** Run `mutate` once, just before the first transaction starts: the scan-vs-transaction race. */
function beforeFirstTx(store: FakeStore, mutate: () => void): void {
  const realTx = store.db.runTransaction.bind(store.db);
  let pending = true;
  store.db.runTransaction = (fn) => {
    if (pending) {
      pending = false;
      mutate();
    }
    return realTx(fn);
  };
}

/**
 * Make the transaction read of `path` return an existing snapshot with no
 * data, the shape a defensive `data() ?? {}` guards against.
 */
function emptyTxRead(store: FakeStore, path: string): void {
  const realTx = store.db.runTransaction.bind(store.db);
  store.db.runTransaction = (fn) =>
    realTx((tx) =>
      fn({
        ...tx,
        get: async (ref) => {
          const snap = await tx.get(ref);
          return ref.path === path ? { ...snap, exists: true, data: () => undefined } : snap;
        },
      }),
    );
}

/**
 * Make every query on `collection` return its hits with `patch` merged into
 * the snapshot data (the stored docs are unchanged), for guards against a
 * query hit whose fields don't match what the query matched on.
 */
function patchQueryHits(store: FakeStore, collection: string, patch: DocData): void {
  type Chain = Record<string, unknown> & { get: () => Promise<{ docs: { data: () => DocData }[] }> };
  const wrap = (q: Chain): Chain =>
    new Proxy(q, {
      get(target, key) {
        if (key === "get") {
          return async () => {
            const snap = await target.get();
            return { ...snap, docs: snap.docs.map((d) => ({ ...d, data: () => ({ ...d.data(), ...patch }) })) };
          };
        }
        const value = target[key as string];
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const out = (value as (...a: unknown[]) => unknown).apply(target, args);
          return out && typeof out === "object" && "get" in out ? wrap(out as Chain) : out;
        };
      },
    });
  const realCollection = store.db.collection.bind(store.db);
  store.db.collection = ((name: string) =>
    name === collection
      ? wrap(realCollection(name) as unknown as Chain)
      : realCollection(name)) as typeof store.db.collection;
}

function activeGame(extra: DocData = {}): DocData {
  return {
    player1Uid: OTHER,
    player2Uid: UID,
    player1Username: "stays",
    player2Username: "leaves",
    status: "active",
    ...extra,
  };
}

describe("active S.K.A.T.E. games: edge paths", () => {
  it("forfeits to player 1 when the departing account is player 2, and unlinks only its own turn videos", async () => {
    const game = activeGame({
      currentSetter: OTHER,
      currentTurn: UID,
      matchVideoUrl: "https://x/o/games%2Fg1%2Fturn-2%2Fmatch.webm",
      turnHistory: [
        {
          setterUid: OTHER,
          setterUsername: "stays",
          matcherUid: UID,
          matcherUsername: "leaves",
          setVideoUrl: "s",
          matchVideoUrl: "m",
        },
      ],
    });
    const store = storeOf({ games: { g1: game } }, [
      `games/g1/turn-1/match-${UID}.mp4`,
      `games/g1/turn-1/set-${OTHER}.mp4`,
    ]);
    const counts = await eraseActiveSkateGames(store.deps, UID, ["g1", "g1"], NOW);

    expect(counts).toEqual({ forfeited: 1, anonymized: 1, deleted: 0, videoObjects: 1 });
    const kept = store.docs.get("games/g1") as DocData;
    expect(kept).toMatchObject({
      status: "forfeit",
      winner: OTHER,
      player2Uid: DELETED_UID,
      player2Username: DELETED_NAME,
    });
    // The departing matcher's legacy (uid-less) match upload is unlinked by role.
    expect(kept.matchVideoUrl).toBeNull();
    expect((kept.turnHistory as DocData[])[0]).toMatchObject({
      matcherUsername: DELETED_NAME,
      matchVideoUrl: null,
      setterUsername: "stays",
      setVideoUrl: "s",
    });
    expect([...store.objects]).toEqual([`games/g1/turn-1/set-${OTHER}.mp4`]);
  });

  it("skips an id whose game no longer exists", async () => {
    const store = storeOf({});
    const counts = await eraseActiveSkateGames(store.deps, UID, ["gone"], NOW);
    expect(counts).toEqual({ forfeited: 0, anonymized: 0, deleted: 0, videoObjects: 0 });
  });

  it("deletes a game whose other seat is malformed (no real opponent to keep it for)", async () => {
    const store = storeOf({ games: { g1: { player1Uid: UID, player2Uid: 42, status: "active" } } });
    const counts = await eraseActiveSkateGames(store.deps, UID, ["g1"], NOW);
    expect(counts.deleted).toBe(1);
    expect(store.docs.has("games/g1")).toBe(false);
  });

  it("treats a game with no data as having no opponent and deletes it", async () => {
    const store = storeOf({ games: { g1: activeGame() } });
    const realCollection = store.db.collection;
    store.db.collection = (name: string) => {
      const col = realCollection(name);
      return {
        ...col,
        doc: (id: string) => {
          const ref = col.doc(id);
          return { ...ref, get: async () => ({ ...(await ref.get()), data: () => undefined }) };
        },
      };
    };
    const counts = await eraseActiveSkateGames(store.deps, UID, ["g1"], NOW);
    expect(counts.deleted).toBe(1);
  });

  it("does nothing when the game vanishes between the read and the transaction", async () => {
    const store = storeOf({ games: { g1: activeGame() } });
    beforeFirstTx(store, () => store.docs.delete("games/g1"));
    const counts = await eraseActiveSkateGames(store.deps, UID, ["g1"], NOW);
    expect(counts).toEqual({ forfeited: 0, anonymized: 0, deleted: 0, videoObjects: 0 });
    expect(store.docs.has("games/g1")).toBe(false);
  });

  it("leaves the game alone when the account is no longer seated by the time the transaction runs", async () => {
    const store = storeOf({ games: { g1: activeGame() } });
    beforeFirstTx(store, () => store.docs.set("games/g1", activeGame({ player2Uid: "uidSomeoneElse" })));
    const counts = await eraseActiveSkateGames(store.deps, UID, ["g1"], NOW);
    expect(counts.anonymized).toBe(0);
    expect(store.docs.get("games/g1")).toMatchObject({ player2Uid: "uidSomeoneElse", status: "active" });
  });

  it("anonymizes without forfeiting when the game already finished before the transaction", async () => {
    const store = storeOf({ games: { g1: activeGame() } });
    beforeFirstTx(store, () => store.docs.set("games/g1", activeGame({ status: "complete", winner: OTHER })));
    const counts = await eraseActiveSkateGames(store.deps, UID, ["g1"], NOW);
    expect(counts).toMatchObject({ forfeited: 0, anonymized: 1 });
    expect(store.docs.get("games/g1")).toMatchObject({ status: "complete", winner: OTHER, player2Uid: DELETED_UID });
  });

  it("re-reads an empty transaction snapshot as having no opponent and leaves it", async () => {
    const store = storeOf({ games: { g1: activeGame() } });
    emptyTxRead(store, "games/g1");
    const counts = await eraseActiveSkateGames(store.deps, UID, ["g1"], NOW);
    expect(counts).toEqual({ forfeited: 0, anonymized: 0, deleted: 0, videoObjects: 0 });
    // "Leaves it": the stored game is exactly as seeded, nothing written or deleted.
    expect(store.docs.get("games/g1")).toEqual(activeGame());
  });

  it("keeps the match video when the departing account is the current setter (its set clip is unlinked instead)", () => {
    const out = anonymizedSkateGame(
      activeGame({ currentSetter: UID, currentTurn: UID, currentTrickVideoUrl: "set", matchVideoUrl: "m" }),
      UID,
    );
    expect(out).toMatchObject({ currentTrickVideoUrl: null, matchVideoUrl: "m" });
  });
});

describe("judged S.K.A.T.E. games: edge paths", () => {
  const judged = (extra: DocData = {}): DocData => ({
    player1Uid: OTHER,
    player2Uid: "uidThird00000000000000000003",
    judgeId: UID,
    judgeUsername: "leaves",
    ...extra,
  });

  it("skips a judged game that vanished before the transaction", async () => {
    const store = storeOf({ games: { j1: judged() } });
    beforeFirstTx(store, () => store.docs.delete("games/j1"));
    expect(await anonymizeJudgedGames(dbOf(store), UID)).toBe(0);
  });

  it("leaves the game untouched when another judge took over before the transaction", async () => {
    const store = storeOf({ games: { j1: judged() } });
    beforeFirstTx(store, () => store.docs.set("games/j1", judged({ judgeId: OTHER, judgeUsername: "new" })));
    expect(await anonymizeJudgedGames(dbOf(store), UID)).toBe(0);
    expect(store.docs.get("games/j1")).toMatchObject({ judgeId: OTHER, judgeUsername: "new" });
  });

  it.each(["player1Uid", "player2Uid"])("leaves it to the player phase when the judge is also %s", async (seat) => {
    const store = storeOf({ games: { j1: judged({ [seat]: UID }) } });
    expect(await anonymizeJudgedGames(dbOf(store), UID)).toBe(0);
    expect(store.docs.get("games/j1")).toMatchObject({ judgeId: UID });
  });

  it("treats an empty transaction snapshot as no longer judged by the account", async () => {
    const store = storeOf({ games: { j1: judged() } });
    emptyTxRead(store, "games/j1");
    expect(await anonymizeJudgedGames(dbOf(store), UID)).toBe(0);
    expect(store.docs.get("games/j1")).toEqual(judged());
  });
});

describe("Roll Dice: edge paths", () => {
  it("forfeits a match that is started only by rounds won, crediting the survivor with no prior stats", async () => {
    const store = storeOf({
      diceGames: {
        m1: {
          player1Uid: OTHER,
          player2Uid: UID,
          status: "active",
          round: 1,
          rollCount: 0,
          results: {},
          roundsWon: { [OTHER]: 0, [UID]: 1 },
        },
      },
    });
    const counts = await eraseDiceGames(dbOf(store), UID, NOW);
    expect(counts).toEqual({ closed: 1, anonymized: 1, deleted: 0 });
    expect(store.docs.get("diceGames/m1")).toMatchObject({ status: "forfeit", winner: OTHER, player2Uid: DELETED_UID });
    // Neither side had a diceStats doc: the survivor starts from zero, mode "unknown".
    expect(store.docs.get(`diceStats/${OTHER}`)).toMatchObject({
      wins: 1,
      losses: 0,
      gamesPlayed: 1,
      byMode: { unknown: { wins: 1, losses: 0 } },
    });
  });

  it("treats a match with results on record as started", async () => {
    const store = storeOf({
      diceGames: { m1: { player1Uid: UID, player2Uid: OTHER, status: "active", results: { r1: { winner: OTHER } } } },
    });
    await eraseDiceGames(dbOf(store), UID, NOW);
    expect(store.docs.get("diceGames/m1")).toMatchObject({ status: "forfeit", winner: OTHER });
  });

  it.each([
    ["no roundsWon", {}],
    ["a malformed roundsWon", { roundsWon: "x" }],
    ["roundsWon all zero", { roundsWon: { a: 0, b: "1" } }],
  ])("treats a match with %s as unstarted (no winner, no stats)", async (_label, extra) => {
    const store = storeOf({ diceGames: { m1: { player1Uid: OTHER, player2Uid: UID, status: "active", ...extra } } });
    await eraseDiceGames(dbOf(store), UID, NOW);
    expect(store.docs.get("diceGames/m1")).toMatchObject({ status: "declined", winner: null });
    expect(store.docs.has(`diceStats/${OTHER}`)).toBe(false);
  });

  it("adds to the survivor's existing per-mode row and keeps the other modes", async () => {
    const store = storeOf({
      diceGames: { m1: { player1Uid: UID, player2Uid: OTHER, status: "active", rollCount: 3, mode: "clo" } },
      diceStats: { [OTHER]: { wins: 4, byMode: { clo: { wins: 2, losses: 1 }, bo3: { wins: 1, losses: 0 } } } },
    });
    await eraseDiceGames(dbOf(store), UID, NOW);
    expect(store.docs.get(`diceStats/${OTHER}`)).toMatchObject({
      wins: 5,
      byMode: { clo: { wins: 3, losses: 1 }, bo3: { wins: 1, losses: 0 } },
    });
  });

  it("deletes a match whose transaction snapshot is empty (no one left to keep it for)", async () => {
    const store = storeOf({ diceGames: { m1: { player1Uid: UID, player2Uid: OTHER, status: "complete" } } });
    emptyTxRead(store, "diceGames/m1");
    const counts = await eraseDiceGames(dbOf(store), UID, NOW);
    expect(counts).toEqual({ closed: 0, anonymized: 0, deleted: 1 });
    expect(store.docs.has("diceGames/m1")).toBe(false);
  });
});

describe("closet: edge paths", () => {
  it("handles a trade the account sent to itself once, and deletes it", async () => {
    const store = storeOf({ trades: { t1: { fromUid: UID, toUid: UID, status: "pending" } } });
    const counts = await eraseCloset(dbOf(store), UID, NOW);
    expect(counts.tradesDeleted).toBe(1);
    expect(store.docs.has("trades/t1")).toBe(false);
  });

  it("deletes a received trade whose sender field is malformed", async () => {
    const store = storeOf({ trades: { t1: { fromUid: 7, toUid: UID, status: "pending" } } });
    const counts = await eraseCloset(dbOf(store), UID, NOW);
    expect(counts.tradesDeleted).toBe(1);
    expect(store.docs.has("trades/t1")).toBe(false);
  });

  it("deletes a trade whose transaction snapshot is empty", async () => {
    const store = storeOf({ trades: { t1: { fromUid: UID, toUid: OTHER, status: "pending" } } });
    emptyTxRead(store, "trades/t1");
    const counts = await eraseCloset(dbOf(store), UID, NOW);
    expect(counts.tradesDeleted).toBe(1);
    expect(store.docs.has("trades/t1")).toBe(false);
  });

  it("leaves serial rows that name someone else, with or without a history list", async () => {
    const store = storeOf({
      serials: { s1: { ownerUid: OTHER }, s2: { ownerUid: OTHER, history: [null, "x", { uid: OTHER }] } },
    });
    const counts = await eraseCloset(dbOf(store), UID, NOW);
    expect(counts.serials).toBe(0);
    expect(store.docs.get("serials/s1")).toEqual({ ownerUid: OTHER });
    expect(store.docs.get("serials/s2")).toEqual({ ownerUid: OTHER, history: [null, "x", { uid: OTHER }] });
  });
});

describe("private-spot crews: edge paths", () => {
  it("clears the crew list when a matched hit carries a crewUids that is not a list", async () => {
    // Targets the `Array.isArray(list) ? … : []` fallback in eraseOwnedContent
    // (api/account/_ownedContent.ts, the privateSpots crew rewrite). Real
    // Firestore only returns array-contains hits for real arrays, so this
    // branch is a defensive guard that no real query reaches. The fake models
    // it by patching the hits the privateSpots query returns: the stored doc
    // matches, the snapshot the code reads says "corrupt". No read counting,
    // so it does not depend on how many times the code reads the field.
    const store = storeOf({ privateSpots: { p1: { name: "ledge", crewUids: [UID, OTHER] } } });
    patchQueryHits(store, "privateSpots", { crewUids: "corrupt" });
    const counts = await eraseOwnedContent(store.deps, UID);
    expect(counts.crewListsUpdated).toBe(1);
    expect(store.docs.get("privateSpots/p1")).toEqual({ name: "ledge", crewUids: [] });
  });
});
