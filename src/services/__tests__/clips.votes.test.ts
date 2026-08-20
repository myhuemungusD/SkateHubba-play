/**
 * Up/down vote engine — `src/services/clips.votes.ts`.
 *
 * Lives apart from `clips.test.ts` (which covers the feed, the landed-clip
 * writes and the cascade) because the vote model is its own contract: one
 * vote doc per (clip, user) with a signed `value`, and a pair of clip
 * counters that must stay consistent with it inside a single transaction.
 * The assertions here are mostly about WHICH counter moves and by how much.
 *
 * Uses the shared firestore harness rather than a bespoke one — see
 * `firestoreDoc.test-helpers.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeleteDoc, mockDocumentId, mockGetDocs, mockRunTransaction, mockWhere } from "./firestoreDoc.test-helpers";
import { absent, captureTx, present, type CapturedTx } from "./txCapture.test-helpers";

import {
  AlreadyVotedError,
  NotVotedError,
  SelfVoteError,
  castClipVote,
  fetchClipVoteState,
  removeClipVote,
  type ClipForVoteHydration,
} from "../clips.votes";
import { fetchClipUpvoteState, removeUpvote, upvoteClip } from "../clips.upvotes";
import { logger } from "../logger";

/** On-disk clip body as the in-transaction read sees it. */
type ClipDisk = "missing" | Record<string, unknown>;
/** On-disk vote body; `null` means the vote doc does not exist. */
type VoteDisk = null | Record<string, unknown>;

/**
 * Drive one `runTransaction`, routing `tx.get` by the ref's `__path`
 * prefix. The captured tx records write ORDER, which is what proves a flip
 * is delete-then-set rather than an (illegal) in-place update.
 */
function wireTx(vote: VoteDisk, clip: ClipDisk): { observed: () => CapturedTx } {
  return captureTx(mockRunTransaction, (path) => {
    if (path.startsWith("clipVotes/")) return vote === null ? absent() : present(vote);
    if (path.startsWith("clips/")) return clip === "missing" ? absent() : present(clip);
    throw new Error(`Unexpected ref path in tx.get: ${path}`);
  });
}

function hydrationClip(overrides: Partial<ClipForVoteHydration> = {}): ClipForVoteHydration {
  return { id: "c1", upvoteCount: 0, downvoteCount: 0, playerUid: "someone-else", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── castClipVote: first vote ───────────────────────────────── */

describe("castClipVote (no existing vote)", () => {
  it("creates the vote doc with its value and bumps ONLY upvoteCount on +1", async () => {
    const cap = wireTx(null, { playerUid: "author", upvoteCount: 4, downvoteCount: 2 });

    const state = await castClipVote("me", "c1", 1);

    expect(state).toEqual({ upvoteCount: 5, downvoteCount: 2, myVote: 1 });
    const tx = cap.observed();
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ __path: "clipVotes/me_c1" }), {
      uid: "me",
      clipId: "c1",
      value: 1,
      createdAt: "SERVER_TS",
    });
    expect(tx.update).toHaveBeenCalledWith(expect.objectContaining({ __path: "clips/c1" }), { upvoteCount: 5 });
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("bumps ONLY downvoteCount on -1", async () => {
    const cap = wireTx(null, { playerUid: "author", upvoteCount: 4, downvoteCount: 2 });

    const state = await castClipVote("me", "c1", -1);

    expect(state).toEqual({ upvoteCount: 4, downvoteCount: 3, myVote: -1 });
    expect(cap.observed().update).toHaveBeenCalledWith(expect.anything(), { downvoteCount: 3 });
  });

  it("treats missing counters on a legacy clip as 0", async () => {
    wireTx(null, { playerUid: "author" });

    await expect(castClipVote("me", "c1", 1)).resolves.toEqual({ upvoteCount: 1, downvoteCount: 0, myVote: 1 });
  });

  it("coerces a corrupt counter to 0 rather than writing NaN", async () => {
    wireTx(null, { playerUid: "author", upvoteCount: "broken", downvoteCount: -3 });

    await expect(castClipVote("me", "c1", -1)).resolves.toEqual({ upvoteCount: 0, downvoteCount: 1, myVote: -1 });
  });

  it("still stages the write when the clip doc has vanished (rules make the final call)", async () => {
    const cap = wireTx(null, "missing");

    await expect(castClipVote("me", "c1", 1)).resolves.toEqual({ upvoteCount: 1, downvoteCount: 0, myVote: 1 });
    expect(cap.observed().set).toHaveBeenCalled();
  });
});

/* ── castClipVote: repeats, flips and self-votes ─────────────── */

describe("castClipVote (existing vote)", () => {
  it("throws AlreadyVotedError and writes nothing when the direction is unchanged", async () => {
    const cap = wireTx({ value: 1 }, { playerUid: "author", upvoteCount: 4 });

    const err: unknown = await castClipVote("me", "c1", 1).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AlreadyVotedError);
    expect((err as AlreadyVotedError).value).toBe(1);
    expect((err as Error).message).toBe("already_voted:c1:1");
    const tx = cap.observed();
    expect(tx.set).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("reads a legacy vote doc with no `value` as an upvote", async () => {
    wireTx({ uid: "me", clipId: "c1" }, { playerUid: "author", upvoteCount: 4 });

    await expect(castClipVote("me", "c1", 1)).rejects.toBeInstanceOf(AlreadyVotedError);
  });

  it("flips down→up as delete-then-create with both counter deltas in one transaction", async () => {
    const cap = wireTx({ value: -1 }, { playerUid: "author", upvoteCount: 4, downvoteCount: 2 });

    const state = await castClipVote("me", "c1", 1);

    expect(state).toEqual({ upvoteCount: 5, downvoteCount: 1, myVote: 1 });
    const tx = cap.observed();
    // Vote docs are immutable, so the flip must be a delete followed by a
    // fresh create — never an update.
    expect(tx.order).toEqual(["delete", "set", "update"]);
    expect(tx.update).toHaveBeenCalledWith(expect.anything(), { upvoteCount: 5, downvoteCount: 1 });
    expect(tx.set).toHaveBeenCalledWith(expect.anything(), {
      uid: "me",
      clipId: "c1",
      value: 1,
      createdAt: "SERVER_TS",
    });
  });

  it("flips up→down the same way", async () => {
    const cap = wireTx({ value: 1 }, { playerUid: "author", upvoteCount: 4, downvoteCount: 2 });

    const state = await castClipVote("me", "c1", -1);

    expect(state).toEqual({ upvoteCount: 3, downvoteCount: 3, myVote: -1 });
    expect(cap.observed().update).toHaveBeenCalledWith(expect.anything(), { downvoteCount: 3, upvoteCount: 3 });
  });

  it("omits a decrement that would push a drifted counter below zero", async () => {
    const cap = wireTx({ value: -1 }, { playerUid: "author", upvoteCount: 4, downvoteCount: 0 });

    const state = await castClipVote("me", "c1", 1);

    // The +1 side still applies; the impossible -1 side is dropped rather
    // than sinking the whole flip on the rule's `>= 0` floor.
    expect(state).toEqual({ upvoteCount: 5, downvoteCount: 0, myVote: 1 });
    expect(cap.observed().update).toHaveBeenCalledWith(expect.anything(), { upvoteCount: 5 });
  });

  it("rejects a self-vote in both directions before staging anything", async () => {
    const up = wireTx(null, { playerUid: "me", upvoteCount: 1 });
    await expect(castClipVote("me", "c1", 1)).rejects.toBeInstanceOf(SelfVoteError);
    expect(up.observed().set).not.toHaveBeenCalled();

    const down = wireTx(null, { playerUid: "me", upvoteCount: 1 });
    const err: unknown = await castClipVote("me", "c1", -1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SelfVoteError);
    expect((err as Error).message).toBe("self_vote:c1");
    expect(down.observed().set).not.toHaveBeenCalled();
  });
});

/* ── castClipVote: transport failures ───────────────────────── */

describe("castClipVote (failures)", () => {
  it("translates permission-denied into AlreadyVotedError", async () => {
    mockRunTransaction.mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "permission-denied" }));

    await expect(castClipVote("me", "c1", 1)).rejects.toBeInstanceOf(AlreadyVotedError);
  });

  it("rethrows any other transport error verbatim", async () => {
    mockRunTransaction.mockRejectedValueOnce(Object.assign(new Error("unavailable"), { code: "unavailable" }));

    await expect(castClipVote("me", "c1", 1)).rejects.toThrow(/unavailable/);
  });
});

/* ── removeClipVote ─────────────────────────────────────────── */

describe("removeClipVote", () => {
  it("deletes the vote and decrements the counter its value belongs to", async () => {
    const cap = wireTx({ value: -1 }, { upvoteCount: 6, downvoteCount: 3 });

    const state = await removeClipVote("me", "c1");

    expect(state).toEqual({ upvoteCount: 6, downvoteCount: 2, myVote: null });
    const tx = cap.observed();
    expect(tx.delete).toHaveBeenCalledWith(expect.objectContaining({ __path: "clipVotes/me_c1" }));
    expect(tx.update).toHaveBeenCalledWith(expect.anything(), { downvoteCount: 2 });
  });

  it("decrements upvoteCount for a legacy vote doc with no `value`", async () => {
    const cap = wireTx({ uid: "me" }, { upvoteCount: 6, downvoteCount: 3 });

    await expect(removeClipVote("me", "c1")).resolves.toEqual({ upvoteCount: 5, downvoteCount: 3, myVote: null });
    expect(cap.observed().update).toHaveBeenCalledWith(expect.anything(), { upvoteCount: 5 });
  });

  it("throws NotVotedError without writing when there is no vote", async () => {
    const cap = wireTx(null, { upvoteCount: 6 });

    const err: unknown = await removeClipVote("me", "c1").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotVotedError);
    expect((err as Error).message).toBe("not_voted:c1");
    expect(cap.observed().delete).not.toHaveBeenCalled();
  });

  it("cleans an orphaned vote up outside the transaction when the counter is already 0", async () => {
    const cap = wireTx({ value: -1 }, { upvoteCount: 6, downvoteCount: 0 });

    const state = await removeClipVote("me", "c1");

    expect(state).toEqual({ upvoteCount: 6, downvoteCount: 0, myVote: null });
    // Nothing inside the transaction — a -1 write would be rejected by the
    // rule's floor and would strand the vote doc forever.
    expect(cap.observed().delete).not.toHaveBeenCalled();
    expect(cap.observed().update).not.toHaveBeenCalled();
    expect(mockDeleteDoc).toHaveBeenCalledWith(expect.objectContaining({ __path: "clipVotes/me_c1" }));
  });

  it("takes the same orphan path when the clip doc is gone", async () => {
    wireTx({ value: 1 }, "missing");

    await expect(removeClipVote("me", "c1")).resolves.toEqual({ upvoteCount: 0, downvoteCount: 0, myVote: null });
    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
  });

  it("survives and logs a failed out-of-band cleanup", async () => {
    wireTx({ value: 1 }, { upvoteCount: 0 });
    mockDeleteDoc.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(removeClipVote("me", "c1")).resolves.toMatchObject({ myVote: null });

    expect(warn).toHaveBeenCalledWith("clip_vote_orphan_delete_failed", expect.objectContaining({ clipId: "c1" }));
    warn.mockRestore();
  });

  it("re-evaluates the orphan flag on every transaction attempt (contention replay)", async () => {
    // First attempt sees a 0 counter (orphan path), the replay sees a real
    // one. A leaked flag from the first attempt would delete the vote twice.
    mockRunTransaction.mockImplementationOnce(async (_db: unknown, cb: (tx: unknown) => Promise<void>) => {
      const disks: ClipDisk[] = [{ upvoteCount: 0 }, { upvoteCount: 3 }];
      for (const disk of disks) {
        await cb({
          get: vi.fn().mockImplementation(async (ref: { __path?: string }) => {
            const path = ref.__path ?? "";
            if (path.startsWith("clipVotes/")) return { exists: () => true, data: () => ({ value: 1 }) };
            return { exists: () => true, data: () => disk };
          }),
          set: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        });
      }
    });

    await expect(removeClipVote("me", "c1")).resolves.toEqual({ upvoteCount: 2, downvoteCount: 0, myVote: null });
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });
});

/* ── fetchClipVoteState ─────────────────────────────────────── */

describe("fetchClipVoteState", () => {
  it("returns an empty map without a read for an empty page", async () => {
    const map = await fetchClipVoteState("me", []);

    expect(map.size).toBe(0);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("seeds counts from the clip docs and marks the viewer's own direction", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        { data: () => ({ clipId: "c1", value: -1 }) },
        { data: () => ({ clipId: "c2" }) },
        // A vote for a clip outside this page — ignored rather than added.
        { data: () => ({ clipId: "elsewhere", value: 1 }) },
        // Malformed body: no usable clipId.
        { data: () => ({ value: 1 }) },
      ],
    });

    const map = await fetchClipVoteState("me", [
      hydrationClip({ id: "c1", upvoteCount: 3, downvoteCount: 1 }),
      hydrationClip({ id: "c2", upvoteCount: 9, downvoteCount: 0 }),
      hydrationClip({ id: "c3", upvoteCount: 0, downvoteCount: 0 }),
    ]);

    expect(mockWhere).toHaveBeenCalledWith({ __documentId: true }, "in", ["me_c1", "me_c2", "me_c3"]);
    expect(mockDocumentId).toHaveBeenCalled();
    expect(map.get("c1")).toEqual({ upvoteCount: 3, downvoteCount: 1, myVote: -1 });
    // No `value` on disk reads as an upvote (pre-downvote corpus).
    expect(map.get("c2")).toEqual({ upvoteCount: 9, downvoteCount: 0, myVote: 1 });
    expect(map.get("c3")).toEqual({ upvoteCount: 0, downvoteCount: 0, myVote: null });
    expect(map.has("elsewhere")).toBe(false);
  });

  it("skips the viewer's own clips entirely — they can never carry a vote", async () => {
    const map = await fetchClipVoteState("me", [hydrationClip({ id: "mine", playerUid: "me" })]);

    expect(map.size).toBe(0);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("chunks vote-doc lookups to respect Firestore's 30-value `in` cap", async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    const clips = Array.from({ length: 31 }, (_, i) => hydrationClip({ id: `c${i}` }));

    await fetchClipVoteState("me", clips);

    expect(mockGetDocs).toHaveBeenCalledTimes(2);
  });

  it("falls back to counts-only state and logs once when the lookup fails", async () => {
    mockGetDocs.mockRejectedValue(Object.assign(new Error("denied"), { code: "permission-denied" }));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const map = await fetchClipVoteState("me", [hydrationClip({ id: "c1", upvoteCount: 5, downvoteCount: 2 })]);

    expect(map.get("c1")).toEqual({ upvoteCount: 5, downvoteCount: 2, myVote: null });
    expect(warn).toHaveBeenCalledWith("clip_vote_state_batch_failed", expect.anything());
    warn.mockRestore();
  });
});

/* ── the legacy upvote-only projection ──────────────────────── */

describe("clips.upvotes legacy projection", () => {
  it("projects vote state down to { count, alreadyUpvoted }", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ clipId: "up", value: 1 }) }, { data: () => ({ clipId: "down", value: -1 }) }],
    });

    const map = await fetchClipUpvoteState("me", [
      { id: "up", upvoteCount: 4, playerUid: "author" },
      { id: "down", upvoteCount: 4, playerUid: "author" },
      { id: "none", upvoteCount: 0, playerUid: "author" },
    ]);

    expect(map.get("up")).toEqual({ count: 4, alreadyUpvoted: true });
    // A downvote is NOT an upvote — the legacy boolean must stay false.
    expect(map.get("down")).toEqual({ count: 4, alreadyUpvoted: false });
    expect(map.get("none")).toEqual({ count: 0, alreadyUpvoted: false });
  });

  it("returns just the upvote count from upvoteClip and removeUpvote", async () => {
    wireTx(null, { playerUid: "author", upvoteCount: 4, downvoteCount: 9 });
    await expect(upvoteClip("me", "c1")).resolves.toBe(5);

    wireTx({ value: 1 }, { upvoteCount: 5, downvoteCount: 9 });
    await expect(removeUpvote("me", "c1")).resolves.toBe(4);
  });
});
