/**
 * Server-layer tests for the erasure cascade (`api/account/_deleteUserData.ts`).
 *
 * This is the code that has to make the privacy promise in
 * `docs/STORE_PRIVACY_ANSWERS.md` true. The client cascade it replaces deleted
 * nothing at all — it ran after the Auth user was gone, so its first query died
 * `permission-denied` — while reporting success. So these tests are less about
 * "does it delete" and more about the properties that make deletion trustworthy:
 *
 *   • SCOPE — the owner's rows go, everyone else's stay. Wrong ownership field
 *     = either orphaned personal data or someone else's data destroyed.
 *   • ORDER — a game's videos are cleared before the doc that names them, so a
 *     crash between the two can't strand binaries nothing can locate.
 *   • CONSISTENCY — a dispute vote and the tally it feeds move together, and a
 *     tally is never driven negative.
 *   • RESUMABILITY — every phase is idempotent, because the endpoint's retry
 *     story depends on it.
 *   • SCALE — Firestore's 500-write batch ceiling and unbounded result sets are
 *     real limits, not theoretical ones.
 *
 * Firestore and Storage are in-memory fakes (see `account-delete.test-helpers`)
 * that record an ordered side-effect log, so ordering is asserted rather than
 * assumed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fp = vi.hoisted(() => ({ documentId: { __fieldPath: "__name__" } }));

// FieldPath is the only runtime import the cascade takes from firebase-admin.
vi.mock("firebase-admin/firestore", () => ({ FieldPath: { documentId: () => fp.documentId } }));

import { deleteUserDataAsAdmin, readUsername } from "../../../api/account/_deleteUserData";
import {
  makeFakeStore,
  seedDocs,
  eventIndex,
  FAKE_BUCKET,
  type DocData,
  type FakeStore,
  type Seed,
} from "./account-delete.test-helpers";

const UID = "u1";
const OTHER = "u2";

/**
 * One account with something in every collection the cascade touches, next to a
 * second account with the mirror image. Anything belonging to `u2` that
 * disappears is a scope bug.
 */
function fixture(): FakeStore {
  const seed: Seed = {
    users: { [UID]: { username: "TonyH" }, [OTHER]: { username: "rival" } },
    "users/u1/private": { profile: { email: "tony@example.com", dob: "1990-01-01" } },
    "users/u1/achievements": { first_win: {}, ten_games: {} },
    // Economy Phase A: server-minted gear lives in its own subcollection.
    // Firestore does NOT cascade into subcollections when the parent doc is
    // deleted, so the sweep has to name it explicitly — u2's copy proves the
    // sweep stays scoped to the account being erased.
    "users/u1/locker": { deck_baker: {}, wheels_spitfire: {} },
    "users/u1/blocked_users": { u3: { blockedAt: 1 } },
    "users/u2/achievements": { first_win: {} },
    "users/u2/locker": { deck_baker: {} },
    usernames: { tonyh: { uid: UID }, rival: { uid: OTHER } },
    games: {
      gActive: { player1Uid: UID, player2Uid: OTHER, status: "active" },
      gDone: { player1Uid: UID, player2Uid: OTHER, status: "completed" },
      gAsP2: { player1Uid: OTHER, player2Uid: UID, status: "forfeited" },
      gTheirs: { player1Uid: OTHER, player2Uid: "u3", status: "completed" },
    },
    clips: { mine: { playerUid: UID, upvoteCount: 2 }, theirs: { playerUid: OTHER, upvoteCount: 4 } },
    disputes: {
      mine: { setterUid: UID, landVotes: 2, bailVotes: 1 },
      theirs: { setterUid: OTHER, landVotes: 1, bailVotes: 0 },
    },
    // Both of my votes sit on content I do NOT own, so each tally must be
    // decremented rather than disappearing with its parent.
    clipVotes: { mine: { uid: UID, clipId: "theirs" }, theirs: { uid: OTHER, clipId: "theirs" } },
    disputeVotes: {
      mine: { uid: UID, disputeId: "theirs", verdict: "land" },
      theirs: { uid: OTHER, disputeId: "theirs", verdict: "bail" },
    },
    notifications: { mine: { recipientUid: UID }, theirs: { recipientUid: OTHER } },
    pushTargets: { [UID]: { tokens: ["tok"] }, [OTHER]: { tokens: ["tok2"] } },
    push_dispatch: { mine: { recipientUid: UID, tokens: ["tok"] }, theirs: { recipientUid: OTHER } },
    nudges: {
      sent: { senderUid: UID, recipientUid: OTHER },
      received: { senderUid: OTHER, recipientUid: UID },
      unrelated: { senderUid: OTHER, recipientUid: "u3" },
    },
    reports: { filed: { reporterUid: UID, reportedUid: OTHER }, against: { reporterUid: OTHER, reportedUid: UID } },
  };
  const objects = [
    "games/gDone/round1.webm",
    "games/gDone/round2.webm",
    "games/gAsP2/round1.mp4",
    "games/gActive/round1.webm",
    "games/gTheirs/round1.webm",
    "users/u1/avatar.webp",
    "users/u2/avatar.webp",
  ];
  return makeFakeStore(seed, objects);
}

/** Sorted survivor paths — the single assertion that proves scope both ways. */
function survivors(store: FakeStore): string[] {
  return [...store.docs.keys()].sort();
}

describe("full cascade over a populated account", () => {
  it("reports per-collection counts", async () => {
    const store = fixture();
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(summary).toEqual({
      games: 2,
      gameVideoObjects: 3,
      clips: 1,
      clipVotes: 1,
      disputes: 1,
      disputeVotes: 1,
      notifications: 1,
      pushTargets: 1,
      pushDispatch: 1,
      nudges: 2,
      reports: 1,
      achievements: 2,
      locker: 2,
      blockedUsers: 1,
      avatarObjects: 1,
      usernameReleased: true,
    });
  });

  it("deletes the owner's documents and nothing else", async () => {
    const store = fixture();
    await deleteUserDataAsAdmin(store.deps, UID);

    expect(survivors(store)).toEqual([
      "clipVotes/theirs",
      "clips/theirs",
      "disputeVotes/theirs",
      "disputes/theirs",
      "games/gActive",
      "games/gTheirs",
      "notifications/theirs",
      "nudges/unrelated",
      "pushTargets/u2",
      "push_dispatch/theirs",
      // A report filed AGAINST this user is another user's moderation
      // submission. Erasing it would make abuse reports removable by the
      // reported party simply by deleting their account.
      "reports/against",
      "usernames/rival",
      "users/u2",
      "users/u2/achievements/first_win",
      "users/u2/locker/deck_baker",
    ]);
  });

  it("deletes a nudge in both directions exactly once", async () => {
    // Sent and received are two scans; a nudge matching both must not be
    // double-written into the batch.
    const store = makeFakeStore({ nudges: { both: { senderUid: UID, recipientUid: UID } } });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    // deleteRefs counts refs, so a duplicated ref would report 2.
    expect(summary.nudges).toBe(1);
    expect(store.docs.has("nudges/both")).toBe(false);
  });

  it("leaves an active game and its videos intact so the opponent is not stranded", async () => {
    const store = fixture();
    await deleteUserDataAsAdmin(store.deps, UID);

    expect(store.docs.has("games/gActive")).toBe(true);
    expect([...store.objects].sort()).toEqual([
      "games/gActive/round1.webm",
      "games/gTheirs/round1.webm",
      "users/u2/avatar.webp",
    ]);
  });

  it("clears a game's video prefix BEFORE deleting the game doc", async () => {
    // Once the doc is gone nothing records which prefix to clear, so a crash
    // between the two would strand the binaries permanently.
    const store = fixture();
    await deleteUserDataAsAdmin(store.deps, UID);

    for (const gameId of ["gDone", "gAsP2"]) {
      const listed = eventIndex(store, `getFiles:games/${gameId}/`);
      const docDeleted = eventIndex(store, `delete:games/${gameId}`);
      expect(listed).toBeGreaterThanOrEqual(0);
      expect(listed).toBeLessThan(docDeleted);
    }
  });

  it("erases the identity surface last, in a single batch", async () => {
    // achievements + locker + blocked_users + private profile + public profile.
    // Identity documents are what a retry needs in order to find everything
    // else, so they must outlive every other phase.
    const store = fixture();
    await deleteUserDataAsAdmin(store.deps, UID);

    // 2 achievements + 2 locker items + 1 blocked user + the private profile
    // + the public one.
    expect(store.commitSizes.at(-1)).toBe(7);
    expect(eventIndex(store, "delete:users/u1")).toBeGreaterThan(eventIndex(store, "delete:notifications/mine"));
    expect(eventIndex(store, "delete:users/u1/private/profile")).toBeGreaterThan(
      eventIndex(store, "delete:reports/filed"),
    );
    expect(eventIndex(store, "tx:delete:usernames/tonyh")).toBeGreaterThan(eventIndex(store, "delete:clips/mine"));
  });

  it("erases the locker subcollection and leaves another account's gear alone", async () => {
    // Regression: users/{uid}/locker was minted by the economy work but never
    // added to the sweep, so erasure left owned-item docs orphaned under a
    // users/{uid} doc that no longer existed.
    const store = fixture();
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(summary.locker).toBe(2);
    expect(store.docs.has("users/u1/locker/deck_baker")).toBe(false);
    expect(store.docs.has("users/u1/locker/wheels_spitfire")).toBe(false);
    expect(store.docs.has("users/u2/locker/deck_baker")).toBe(true);
  });

  it("reads every page from the injected bucket and tolerates missing objects", async () => {
    const store = fixture();
    await deleteUserDataAsAdmin(store.deps, UID);

    expect(new Set(store.bucketsRequested)).toEqual(new Set([FAKE_BUCKET]));
    // ignoreNotFound is what makes a resumed run safe: a half-deleted prefix
    // must not throw and abort the whole cascade.
    expect(store.fileDeletes.every((f) => f.ignoreNotFound)).toBe(true);
  });

  it("orders every scan by document id so the cursor needs no composite index", async () => {
    const store = fixture();
    await deleteUserDataAsAdmin(store.deps, UID);

    expect(store.orderBys.length).toBeGreaterThan(0);
    expect(store.orderBys.every((field) => field === fp.documentId)).toBe(true);
  });

  it("deletes the FCM token mirror, which is a cross-readable device identifier", async () => {
    const store = fixture();
    await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.docs.has(`pushTargets/${UID}`)).toBe(false);
    expect(eventIndex(store, `delete:pushTargets/${UID}`)).toBeGreaterThanOrEqual(0);
  });
});

describe("ownership fields", () => {
  const OWNERSHIP: [string, string][] = [
    ["games", "player1Uid"],
    ["games", "player2Uid"],
    ["clips", "playerUid"],
    ["disputes", "setterUid"],
    ["clipVotes", "uid"],
    ["disputeVotes", "uid"],
    ["notifications", "recipientUid"],
    ["push_dispatch", "recipientUid"],
    ["nudges", "senderUid"],
    ["nudges", "recipientUid"],
    ["reports", "reporterUid"],
  ];

  it.each(OWNERSHIP)("queries %s on %s", async (collection, field) => {
    // A wrong field here is invisible in the summary — it just silently reports
    // zero and leaves the data behind.
    const store = fixture();
    await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.wheres).toContainEqual({ collection, field, op: "==", value: UID });
  });

  it("never filters on anything but the erased uid", async () => {
    const store = fixture();
    await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.wheres.map((w) => `${w.collection}.${w.field}`).sort()).toEqual(
      OWNERSHIP.map(([c, f]) => `${c}.${f}`).sort(),
    );
    expect(store.wheres.every((w) => w.op === "==" && w.value === UID)).toBe(true);
  });
});

/**
 * Both vote collections run through one generic routine, so the shared
 * invariants are asserted once against each shape rather than copied. The
 * parent is always owned by somebody else — a parent of mine would already have
 * been deleted, which is a different (and separately tested) case.
 */
interface VoteKind {
  label: string;
  votes: "clipVotes" | "disputeVotes";
  parents: string;
  counter: string;
  /** Vote payload naming its parent. */
  vote: (parentId: string) => DocData;
  /** Parent doc carrying the tally. */
  parent: (count: unknown) => DocData;
}

const VOTE_KINDS: VoteKind[] = [
  {
    label: "clip upvotes",
    votes: "clipVotes",
    parents: "clips",
    counter: "upvoteCount",
    vote: (clipId) => ({ clipId }),
    parent: (upvoteCount) => ({ playerUid: OTHER, upvoteCount }),
  },
  {
    label: "dispute votes",
    votes: "disputeVotes",
    parents: "disputes",
    counter: "landVotes",
    vote: (disputeId) => ({ disputeId, verdict: "land" }),
    parent: (landVotes) => ({ setterUid: OTHER, landVotes }),
  },
];

describe.each(VOTE_KINDS)("$label tallies", (kind) => {
  /** Run the cascade against a single vote of mine plus the parents it names. */
  async function runVote(vote: DocData, parents: Record<string, DocData> = {}) {
    const store = makeFakeStore({ [kind.votes]: { v: { uid: UID, ...vote } }, [kind.parents]: parents });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);
    return { store, summary: summary[kind.votes] };
  }

  it("decrements the parent tally and deletes the vote", async () => {
    // Deleting the vote alone permanently inflates a count that ranking reads.
    const { store, summary } = await runVote(kind.vote("p"), { p: kind.parent(5) });

    expect(store.txUpdates).toEqual([{ path: `${kind.parents}/p`, data: { [kind.counter]: 4 } }]);
    expect(store.docs.has(`${kind.votes}/v`)).toBe(false);
    expect(summary).toBe(1);
  });

  it("keeps the delete and the decrement in one transaction, read before write", async () => {
    const { store } = await runVote(kind.vote("p"), { p: kind.parent(1) });

    expect(store.events.filter((e) => e.startsWith("tx:"))).toEqual([
      "tx:begin",
      `tx:get:${kind.parents}/p`,
      `tx:delete:${kind.votes}/v`,
      `tx:update:${kind.parents}/p`,
      "tx:commit",
    ]);
  });

  const BAD_PARENT_ID: [string, unknown][] = [
    ["missing", undefined],
    ["empty", ""],
    ["not a string", 42],
  ];

  it.each(BAD_PARENT_ID)("deletes an untargetable vote whose parent id is %s", async (_label, parentId) => {
    const vote = { ...kind.vote("p") };
    const idField = kind.votes === "clipVotes" ? "clipId" : "disputeId";
    if (parentId === undefined) delete vote[idField];
    else vote[idField] = parentId;

    const { store, summary } = await runVote(vote, { p: kind.parent(3) });

    expect(store.docs.has(`${kind.votes}/v`)).toBe(false);
    expect(store.txUpdates).toEqual([]);
    expect(store.docs.get(`${kind.parents}/p`)).toEqual(kind.parent(3));
    expect(summary).toBe(1);
  });

  it("skips the decrement when the parent is already gone", async () => {
    const { store, summary } = await runVote(kind.vote("vanished"));

    expect(store.events).toContain(`tx:get:${kind.parents}/vanished`);
    expect(store.txUpdates).toEqual([]);
    expect(summary).toBe(1);
  });

  const NON_POSITIVE: [string, unknown][] = [
    ["zero", 0],
    ["negative", -3],
    ["missing", undefined],
    ["a string", "2"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ];

  it.each(NON_POSITIVE)("never drives the tally below zero when the count is %s", async (_label, count) => {
    // Only a finite positive count decrements; anything else leaves the field
    // untouched rather than writing -1 or NaN into a public counter.
    const { store, summary } = await runVote(kind.vote("p"), { p: kind.parent(count) });

    expect(store.txUpdates).toEqual([]);
    expect(store.docs.get(`${kind.parents}/p`)).toEqual(kind.parent(count));
    expect(summary).toBe(1);
  });

  it("processes every one of the owner's votes and leaves other people's alone", async () => {
    const store = makeFakeStore({
      [kind.votes]: {
        a: { uid: UID, ...kind.vote("p") },
        b: { uid: UID, ...kind.vote("p") },
        c: { uid: OTHER, ...kind.vote("p") },
      },
      [kind.parents]: { p: kind.parent(5) },
    });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(summary[kind.votes]).toBe(2);
    expect(store.docs.get(`${kind.parents}/p`)).toEqual(kind.parent(3));
    expect(store.docs.has(`${kind.votes}/c`)).toBe(true);
  });
});

describe("dispute verdicts", () => {
  async function runDisputeVote(vote: DocData) {
    const store = makeFakeStore({
      disputeVotes: { v: { uid: UID, disputeId: "d", ...vote } },
      disputes: { d: { setterUid: OTHER, landVotes: 5, bailVotes: 2 } },
    });
    await deleteUserDataAsAdmin(store.deps, UID);
    return store;
  }

  it.each([
    ["land", "landVotes", 4],
    ["bail", "bailVotes", 1],
  ])("a %s vote decrements %s", async (verdict, field, after) => {
    const store = await runDisputeVote({ verdict });
    expect(store.txUpdates).toEqual([{ path: "disputes/d", data: { [field]: after } }]);
  });

  it.each([
    ["missing", undefined],
    ["unknown", "maybe"],
    ["not a string", true],
  ])("deletes a vote whose verdict is %s without touching either tally", async (_label, verdict) => {
    // Untargetable for the tally, but the vote itself is still personal data.
    const store = await runDisputeVote(verdict === undefined ? {} : { verdict });

    expect(store.docs.has("disputeVotes/v")).toBe(false);
    expect(store.txUpdates).toEqual([]);
    expect(store.docs.get("disputes/d")).toEqual({ setterUid: OTHER, landVotes: 5, bailVotes: 2 });
  });
});

describe("username reservation", () => {
  const NOT_A_USERNAME: [string, unknown][] = [
    ["a number", 42],
    ["empty", ""],
    ["whitespace", "   "],
    ["absent", undefined],
    ["null", null],
    ["an object", { value: "tonyh" }],
  ];

  it.each(NOT_A_USERNAME)("releases nothing when the stored username is %s", async (_label, username) => {
    const store = makeFakeStore({ users: { [UID]: { username } }, usernames: { tonyh: { uid: UID } } });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(summary.usernameReleased).toBe(false);
    expect(store.docs.has("usernames/tonyh")).toBe(true);
  });

  it("normalizes the stored username before releasing it", async () => {
    const store = makeFakeStore({
      users: { [UID]: { username: "  TonyH  " } },
      usernames: { tonyh: { uid: UID }, TonyH: { uid: "impostor" } },
    });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(summary.usernameReleased).toBe(true);
    expect(store.docs.has("usernames/tonyh")).toBe(false);
    // Reservation ids are lowercase; a differently-cased doc is somebody else's.
    expect(store.docs.has("usernames/TonyH")).toBe(true);
  });

  it("takes the username from the profile doc, not from any other reservation", async () => {
    // The uid is the only input. If the reservation to free could ever be named
    // by a caller, one account could release another's username.
    const store = makeFakeStore({
      users: { [UID]: { username: "tonyh" } },
      usernames: { tonyh: { uid: UID }, rival: { uid: OTHER } },
    });
    await deleteUserDataAsAdmin(store.deps, UID);
    expect(survivors(store)).toEqual(["usernames/rival"]);
  });

  it("releases nothing when the profile doc is already gone (a resumed run)", async () => {
    const store = makeFakeStore({ usernames: { tonyh: { uid: UID } } });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(summary.usernameReleased).toBe(false);
    expect(store.docs.has("usernames/tonyh")).toBe(true);
  });

  it("readUsername returns null for a missing profile and the normalized value otherwise", async () => {
    const store = makeFakeStore({ users: { [UID]: { username: "TONYH" } } });
    await expect(readUsername(store.deps.db, UID)).resolves.toBe("tonyh");
    await expect(readUsername(store.deps.db, "nobody")).resolves.toBeNull();
  });

  it("refuses to release a reservation held by somebody else", async () => {
    // The hijack primitive this guard closes: `firestore.rules` lets anyone
    // create `users/{me}` claiming ANY format-valid username without holding
    // the reservation. Admin credentials bypass the rule that saved the client
    // cascade by accident, so deletion would otherwise free a victim's name for
    // the attacker to claim.
    const store = makeFakeStore({
      users: { [UID]: { username: "victim" } },
      usernames: { victim: { uid: "the-real-owner" } },
    });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(summary.usernameReleased).toBe(false);
    expect(store.docs.get("usernames/victim")).toEqual({ uid: "the-real-owner" });
  });

  it("checks ownership and deletes inside one transaction", async () => {
    // Read and delete must be atomic, or another account could claim the
    // reservation between the check and the delete — the same hijack through a
    // narrower window.
    const store = makeFakeStore({ users: { [UID]: { username: "tonyh" } }, usernames: { tonyh: { uid: UID } } });
    await deleteUserDataAsAdmin(store.deps, UID);

    expect(store.events.filter((e) => e.startsWith("tx:"))).toEqual([
      "tx:begin",
      "tx:get:usernames/tonyh",
      "tx:delete:usernames/tonyh",
      "tx:commit",
    ]);
  });

  it("releases nothing when the reservation carries no uid at all", async () => {
    const store = makeFakeStore({ users: { [UID]: { username: "tonyh" } }, usernames: { tonyh: {} } });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(summary.usernameReleased).toBe(false);
    expect(store.docs.has("usernames/tonyh")).toBe(true);
  });

  it("reports false when the reservation was already released by an earlier run", async () => {
    const store = makeFakeStore({ users: { [UID]: { username: "tonyh" } } });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(summary.usernameReleased).toBe(false);
    expect(store.events).toContain("tx:get:usernames/tonyh");
  });
});

describe("storage resilience", () => {
  const RETRYABLE = [429, 500, 502, 503, 504];

  /** One finished game with one video, so exactly one object is deleted. */
  function oneObjectStore(): FakeStore {
    return makeFakeStore({ games: { g: { player1Uid: UID, player2Uid: OTHER, status: "completed" } } }, [
      "games/g/round1.webm",
    ]);
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Drive the cascade to completion, letting the retry backoff timers fire. */
  async function runWithTimers(store: FakeStore): Promise<PromiseSettledResult<unknown>> {
    const running = deleteUserDataAsAdmin(store.deps, UID);
    const settled = Promise.allSettled([running]);
    await vi.runAllTimersAsync();
    return (await settled)[0];
  }

  it.each(RETRYABLE)("retries a transient %s and succeeds", async (code) => {
    const store = oneObjectStore();
    store.failFileDelete = (_name, attempt) => (attempt === 0 ? { code } : null);

    const result = await runWithTimers(store);

    expect(result.status).toBe("fulfilled");
    expect(store.fileDeleteAttempts.filter((n) => n === "games/g/round1.webm")).toHaveLength(2);
    expect(store.objects.has("games/g/round1.webm")).toBe(false);
  });

  it.each([403, 404, undefined])("does not retry a permanent failure (%s) and aborts the cascade", async (code) => {
    // A permissions or bad-bucket failure must throw: continuing would erase
    // the Firestore records and leave the binaries — silent data retention.
    const store = oneObjectStore();
    store.failFileDelete = () => ({ code });

    const result = await runWithTimers(store);

    expect(result.status).toBe("rejected");
    expect(store.fileDeleteAttempts).toHaveLength(1);
    expect(store.docs.has("games/g")).toBe(true);
  });

  it("gives up after the attempt limit on a persistently transient failure", async () => {
    const store = oneObjectStore();
    store.failFileDelete = () => ({ code: 503 });

    const result = await runWithTimers(store);

    expect(result.status).toBe("rejected");
    expect(store.fileDeleteAttempts).toHaveLength(3);
  });

  it("bounds how many objects it deletes at once", async () => {
    // A heavy account can hold hundreds of objects; an unbounded fan-out
    // invites a GCS rate limit, and this phase runs first — a 429 here aborts
    // the cascade before a single document is touched, and every retry would
    // replay the same burst.
    const objects = Array.from({ length: 45 }, (_, i) => `games/g/clip${String(i).padStart(3, "0")}.webm`);
    const store = makeFakeStore({ games: { g: { player1Uid: UID, player2Uid: OTHER, status: "completed" } } }, objects);

    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(summary.gameVideoObjects).toBe(45);
    expect(store.maxConcurrentFileDeletes).toBeLessThanOrEqual(20);
    expect(store.maxConcurrentFileDeletes).toBeGreaterThan(1);
    expect(store.objects.size).toBe(0);
  });
});

describe("scale", () => {
  it("splits more than 400 deletes across batches, under the 500-write ceiling", async () => {
    const store = makeFakeStore({ notifications: seedDocs(401, () => ({ recipientUid: UID })) });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(summary.notifications).toBe(401);
    expect(store.commitSizes.slice(0, 2)).toEqual([400, 1]);
    expect([...store.docs.keys()].filter((p) => p.startsWith("notifications/"))).toEqual([]);
  });

  it("commits once when the count fits in a single batch", async () => {
    const store = makeFakeStore({ notifications: seedDocs(400, () => ({ recipientUid: UID })) });
    await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.commitSizes[0]).toBe(400);
  });

  it("fetches another page when a query returns a full page", async () => {
    // A full page means "there may be more". Assuming one get() returns
    // everything would silently orphan the tail of a heavy account.
    const store = makeFakeStore({ clips: seedDocs(500, () => ({ playerUid: UID })) });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(summary.clips).toBe(500);
    expect(store.pageRequests.filter((c) => c === "clips")).toHaveLength(2);
  });

  it("pages through a result set larger than one page", async () => {
    const store = makeFakeStore({ clips: seedDocs(501, () => ({ playerUid: UID })) });
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(summary.clips).toBe(501);
    expect(store.pageRequests.filter((c) => c === "clips")).toHaveLength(2);
    expect(store.commitSizes.slice(0, 2)).toEqual([400, 101]);
  });

  it("stops after one page when the result set is short", async () => {
    const store = makeFakeStore({ clips: seedDocs(499, () => ({ playerUid: UID })) });
    await deleteUserDataAsAdmin(store.deps, UID);
    expect(store.pageRequests.filter((c) => c === "clips")).toHaveLength(1);
  });
});

describe("idempotency", () => {
  it("runs clean over an account that has nothing left", async () => {
    const store = makeFakeStore();
    const summary = await deleteUserDataAsAdmin(store.deps, UID);

    expect(summary).toEqual({
      games: 0,
      gameVideoObjects: 0,
      clips: 0,
      clipVotes: 0,
      disputes: 0,
      disputeVotes: 0,
      notifications: 0,
      // Unconditional: the mirror doc is deleted blind rather than read first,
      // so the count is a "we tried", not a "we found one".
      pushTargets: 1,
      pushDispatch: 0,
      nudges: 0,
      reports: 0,
      achievements: 0,
      locker: 0,
      blockedUsers: 0,
      avatarObjects: 0,
      usernameReleased: false,
    });
  });

  it("is safe to re-run after a complete pass", async () => {
    // The endpoint's retry story depends on this: a failed run must resume, not
    // double-delete or throw.
    const store = fixture();
    await deleteUserDataAsAdmin(store.deps, UID);
    const before = survivors(store);
    const second = await deleteUserDataAsAdmin(store.deps, UID);

    expect(second.games).toBe(0);
    expect(second.usernameReleased).toBe(false);
    expect(survivors(store)).toEqual(before);
  });
});

describe("fail-loud", () => {
  it("propagates a batch failure instead of reporting a partial success", async () => {
    // The caller must not delete the Auth user unless this resolves — a
    // swallowed error here is how the old client cascade lied about success.
    const store = fixture();
    store.failNextCommit = "DEADLINE_EXCEEDED";
    await expect(deleteUserDataAsAdmin(store.deps, UID)).rejects.toThrow("DEADLINE_EXCEEDED");
  });

  it("propagates a Storage failure before the game doc that names the prefix is lost", async () => {
    const store = fixture();
    store.failGetFilesPrefix = "games/";
    await expect(deleteUserDataAsAdmin(store.deps, UID)).rejects.toThrow(/storage list failed/);
    expect(store.docs.has("games/gDone")).toBe(true);
    expect(store.docs.has("users/u1")).toBe(true);
  });
});
