import { describe, it, expect, vi, beforeEach } from "vitest";

// Firestore mock harness lives in a shared helper — importing it installs
// the `firebase/firestore` and `../../firebase` mocks.
import {
  mockDoc,
  mockWhere,
  mockOrderBy,
  mockLimit,
  mockGetDocs,
  mockGetDoc,
  mockDeleteDoc,
  captureTxOnce,
  mockRunTransaction,
  FakeTimestamp,
  type ObservedTx,
} from "./firestoreDoc.test-helpers";

import {
  AlreadyRuledError,
  DisputeClosedError,
  OwnDisputeError,
  canRaiseDispute,
  castDisputeVerdict,
  deleteUserDisputeVotes,
  deleteUserDisputes,
  fetchDisputeViewerState,
  fetchOpenDisputes,
  fetchResolvedDispute,
  raiseDispute,
  type Dispute,
} from "../disputes";
import { auth } from "../../firebase";
// Not mocked: the swallowed-failure paths log through the real logger, so
// the tests spy on the exported object to assert the event names emitted.
import { logger } from "../logger";
import type { GameDoc } from "../games.mappers";

/* ── Helpers ────────────────────────────────── */

function signIn(uid: string | null): void {
  (auth as unknown as { currentUser: { uid: string } | null }).currentUser = uid ? { uid } : null;
}

/**
 * The turn every fixture in this file describes. Shared so the turn record,
 * the raw Firestore payload, and the mapped `Dispute` can't drift apart —
 * and so the same eight fields aren't repeated verbatim three times over.
 */
const TURN_IDENTITY = {
  turnNumber: 3,
  trickName: "tre flip",
  setterUid: "setter",
  setterUsername: "alice",
  matcherUid: "matcher",
  matcherUsername: "bob",
  setVideoUrl: "https://example.com/set.webm",
  matchVideoUrl: "https://example.com/match.webm",
} as const;

/** The frozen-game fields the binding-dispute gate reasons about. */
type GateShape = Pick<GameDoc, "status" | "phase" | "currentSetter" | "reviewFor" | "matchVideoUrl">;

/** A game frozen in `pendingReview` after a landed claim — the disputable state. */
function gate(overrides: Partial<GateShape> = {}): GateShape {
  return {
    status: "active",
    phase: "pendingReview",
    currentSetter: "setter",
    reviewFor: "matcher",
    matchVideoUrl: "https://example.com/match.webm",
    ...overrides,
  };
}

function validDisputeData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gameId: "g1",
    ...TURN_IDENTITY,
    spotId: "spot-1",
    createdAt: new FakeTimestamp(1_700_000_000_000),
    status: "open",
    moderationStatus: "active",
    landVotes: 0,
    bailVotes: 0,
    ...overrides,
  };
}

function snapOf(id: string, data: Record<string, unknown> | undefined) {
  return { id, data: () => data };
}

function dispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: "g1_3",
    gameId: "g1",
    ...TURN_IDENTITY,
    spotId: "spot-1",
    createdAt: null,
    status: "open",
    moderationStatus: "active",
    landVotes: 0,
    bailVotes: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  signIn("setter");
});

describe("fetchResolvedDispute", () => {
  it.each(["land", "bail", "tie", "none"] as const)(
    "parses a closed %s result by deterministic turn id",
    async (verdict) => {
      mockGetDoc.mockResolvedValueOnce({
        id: "g1_3",
        exists: () => true,
        data: () => validDisputeData({ status: "closed", verdict, landVotes: 4, bailVotes: 2 }),
      });

      await expect(fetchResolvedDispute("g1", 3)).resolves.toMatchObject({
        verdict,
        status: "closed",
        landVotes: 4,
        bailVotes: 2,
      });
      expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "disputes", "g1_3");
    },
  );

  it("preserves a legacy closed result without inventing a verdict", async () => {
    mockGetDoc.mockResolvedValueOnce({
      id: "g1_3",
      exists: () => true,
      data: () => validDisputeData({ status: "closed" }),
    });
    const result = await fetchResolvedDispute("g1", 3);
    expect(result).not.toHaveProperty("verdict");
  });

  it("normalizes the referee's legacy resolved status to closed", async () => {
    mockGetDoc.mockResolvedValueOnce({
      id: "g1_3",
      exists: () => true,
      data: () => validDisputeData({ status: "resolved", verdict: "tie" }),
    });
    await expect(fetchResolvedDispute("g1", 3)).resolves.toMatchObject({ status: "closed", verdict: "tie" });
  });

  it("returns null for a missing or still-open deterministic document", async () => {
    mockGetDoc.mockResolvedValueOnce({ id: "g1_3", exists: () => false });
    await expect(fetchResolvedDispute("g1", 3)).resolves.toBeNull();
    mockGetDoc.mockResolvedValueOnce({ id: "g1_3", exists: () => true, data: () => validDisputeData() });
    await expect(fetchResolvedDispute("g1", 3)).resolves.toBeNull();
  });
});

/* ── canRaiseDispute (the setter-facing UI gate) ─────────────── */

describe("canRaiseDispute", () => {
  it("is true for the frozen setter of a pendingReview game with a matcher + match video", () => {
    expect(canRaiseDispute(gate(), "setter")).toBe(true);
  });

  it("is false once the game is over", () => {
    expect(canRaiseDispute(gate({ status: "complete" }), "setter")).toBe(false);
  });

  it("is false when the game isn't frozen in pendingReview", () => {
    // Only the freeze exposes a disputable claim — every other phase is either
    // mid-play or already resolved.
    expect(canRaiseDispute(gate({ phase: "setting" }), "setter")).toBe(false);
    expect(canRaiseDispute(gate({ phase: "matching" }), "setter")).toBe(false);
    expect(canRaiseDispute(gate({ phase: "communityReview" }), "setter")).toBe(false);
  });

  it("is false for anyone who isn't the frozen setter", () => {
    // The matcher can't dispute their own claim, and neither can a viewer.
    expect(canRaiseDispute(gate(), "matcher")).toBe(false);
    expect(canRaiseDispute(gate(), "stranger")).toBe(false);
  });

  it("is false when the frozen claim names no matcher", () => {
    expect(canRaiseDispute(gate({ reviewFor: null }), "setter")).toBe(false);
  });

  it("is false when there is no match video for the community to watch", () => {
    expect(canRaiseDispute(gate({ matchVideoUrl: null }), "setter")).toBe(false);
  });
});

/* ── raiseDispute ────────────────────────────── */

describe("raiseDispute", () => {
  function gameData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      player1Uid: "setter",
      player2Uid: "matcher",
      player1Username: "alice",
      player2Username: "bob",
      status: "active",
      phase: "pendingReview",
      currentSetter: "setter",
      currentTurn: "matcher",
      reviewFor: "matcher",
      turnNumber: 3,
      currentTrickName: "tre flip",
      currentTrickVideoUrl: "https://example.com/set.webm",
      matchVideoUrl: "https://example.com/match.webm",
      spotId: "spot-1",
      ...overrides,
    };
  }

  it("flips the frozen game to communityReview and creates the dispute from frozen state", async () => {
    const cap = captureTxOnce({
      games: { exists: true, data: gameData() },
      disputes: { exists: false },
    });

    await raiseDispute("g1");

    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "games", "g1");
    // turnNumber is sourced from the frozen game, not an argument.
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "disputes", "g1_3");

    const tx = cap.observed();

    // 1) game flip pendingReview → communityReview, roles/turn/letters pinned.
    expect(tx.update).toHaveBeenCalledTimes(1);
    const [gameRef, gameUpdate] = tx.update.mock.calls[0];
    expect((gameRef as { __path: string }).__path).toBe("games/g1");
    expect(gameUpdate).toMatchObject({ phase: "communityReview", updatedAt: "SERVER_TS" });
    expect((gameUpdate as { reviewDeadline: unknown }).reviewDeadline).toBeInstanceOf(FakeTimestamp);

    // 2) dispute doc denormalized from the FROZEN game (NOT turnHistory).
    expect(tx.set).toHaveBeenCalledTimes(1);
    const [ref, payload] = tx.set.mock.calls[0];
    expect((ref as { __path: string }).__path).toBe("disputes/g1_3");
    expect(payload).toEqual({
      gameId: "g1",
      // The frozen game's fields match TURN_IDENTITY exactly — asserting the
      // spread proves the raise denormalizes every field off the frozen state.
      ...TURN_IDENTITY,
      spotId: "spot-1",
      createdAt: "SERVER_TS",
      status: "open",
      moderationStatus: "active",
      landVotes: 0,
      bailVotes: 0,
    });
  });

  it("sources usernames from the players when the frozen setter is player2", async () => {
    // Exercises the opposite arm of the setter/matcher username ternaries.
    signIn("matcher"); // "matcher" is player2Uid — the frozen setter here
    const cap = captureTxOnce({
      games: {
        exists: true,
        data: gameData({ currentSetter: "matcher", currentTurn: "setter", reviewFor: "setter" }),
      },
      disputes: { exists: false },
    });

    await raiseDispute("g1");

    expect(cap.observed().set.mock.calls[0][1]).toMatchObject({
      setterUid: "matcher",
      setterUsername: "bob",
      matcherUid: "setter",
      matcherUsername: "alice",
    });
  });

  it("falls back to 'Trick' when the frozen trick name is empty", async () => {
    const cap = captureTxOnce({
      games: { exists: true, data: gameData({ currentTrickName: null }) },
      disputes: { exists: false },
    });

    await raiseDispute("g1");

    expect(cap.observed().set.mock.calls[0][1]).toMatchObject({ trickName: "Trick" });
  });

  it("coerces a null set video and a missing spotId to null", async () => {
    const cap = captureTxOnce({
      games: { exists: true, data: gameData({ currentTrickVideoUrl: null, spotId: undefined }) },
      disputes: { exists: false },
    });

    await raiseDispute("g1");

    const [, payload] = cap.observed().set.mock.calls[0];
    expect(payload).toMatchObject({ setVideoUrl: null, spotId: null });
  });

  it("throws when nobody is signed in (no transaction is opened)", async () => {
    signIn(null);
    await expect(raiseDispute("g1")).rejects.toThrow(/signed in/);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("throws when the game doc is missing", async () => {
    captureTxOnce({ games: { exists: false }, disputes: { exists: false } });
    await expect(raiseDispute("g1")).rejects.toThrow("Game not found");
  });

  it("throws rather than overwriting an existing dispute (idempotent id)", async () => {
    // Re-raising would reset a live tally — the one way a setter could
    // launder an unfavourable crowd verdict. The game must not flip either.
    const cap = captureTxOnce({
      games: { exists: true, data: gameData() },
      disputes: { exists: true, data: validDisputeData() },
    });

    await expect(raiseDispute("g1")).rejects.toThrow(/already been sent to the community/);
    expect(cap.observed().set).not.toHaveBeenCalled();
    expect(cap.observed().update).not.toHaveBeenCalled();
  });

  it("throws when the game is already over", async () => {
    const cap = captureTxOnce({
      games: { exists: true, data: gameData({ status: "complete" }) },
      disputes: { exists: false },
    });
    await expect(raiseDispute("g1")).rejects.toThrow(/already over/i);
    expect(cap.observed().update).not.toHaveBeenCalled();
  });

  it("throws when the game is not frozen in pendingReview", async () => {
    const cap = captureTxOnce({
      games: { exists: true, data: gameData({ phase: "setting" }) },
      disputes: { exists: false },
    });
    await expect(raiseDispute("g1")).rejects.toThrow(/no landed claim awaiting review/i);
    expect(cap.observed().update).not.toHaveBeenCalled();
  });

  it("throws when the caller isn't the frozen setter", async () => {
    signIn("matcher");
    const cap = captureTxOnce({
      games: { exists: true, data: gameData() },
      disputes: { exists: false },
    });

    await expect(raiseDispute("g1")).rejects.toThrow(/Only the setter/);
    expect(cap.observed().set).not.toHaveBeenCalled();
  });

  it("throws when the frozen claim names no matcher", async () => {
    captureTxOnce({
      games: { exists: true, data: gameData({ reviewFor: null }) },
      disputes: { exists: false },
    });
    await expect(raiseDispute("g1")).rejects.toThrow(/no matcher/i);
  });

  it("throws when the frozen claim has no match video", async () => {
    captureTxOnce({
      games: { exists: true, data: gameData({ matchVideoUrl: null }) },
      disputes: { exists: false },
    });
    await expect(raiseDispute("g1")).rejects.toThrow(/no match video/);
  });

  it("propagates a malformed game doc from toGameDoc", async () => {
    captureTxOnce({
      games: { exists: true, data: { player1Uid: 42 } },
      disputes: { exists: false },
    });
    await expect(raiseDispute("g1")).rejects.toThrow(/Malformed game document/);
  });
});

/* ── fetchOpenDisputes ───────────────────────── */

describe("fetchOpenDisputes", () => {
  it("queries open + active disputes newest first with a doc-id tiebreak", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [snapOf("g1_3", validDisputeData()), snapOf("g2_1", validDisputeData({ gameId: "g2", turnNumber: 1 }))],
    });

    const disputes = await fetchOpenDisputes();

    expect(mockWhere).toHaveBeenCalledWith("status", "==", "open");
    expect(mockWhere).toHaveBeenCalledWith("moderationStatus", "==", "active");
    expect(mockOrderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(mockOrderBy).toHaveBeenCalledWith({ __documentId: true }, "desc");
    expect(mockLimit).toHaveBeenCalledWith(20);

    expect(disputes).toHaveLength(2);
    expect(disputes[0]).toMatchObject({ id: "g1_3", gameId: "g1", status: "open", landVotes: 0, bailVotes: 0 });
    expect(disputes[1]).toMatchObject({ id: "g2_1", gameId: "g2" });
  });

  it("clamps pageSize into [1, 50]", async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });

    await fetchOpenDisputes(0);
    expect(mockLimit).toHaveBeenLastCalledWith(1);

    await fetchOpenDisputes(999);
    expect(mockLimit).toHaveBeenLastCalledWith(50);
  });

  it("skips one malformed doc instead of blanking the page", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    mockGetDocs.mockResolvedValueOnce({
      docs: [snapOf("broken", undefined), snapOf("g1_3", validDisputeData())],
    });

    const disputes = await fetchOpenDisputes();

    expect(disputes).toHaveLength(1);
    expect(disputes[0].id).toBe("g1_3");
    expect(warn).toHaveBeenCalledWith("disputes_feed_doc_malformed", expect.objectContaining({ docId: "broken" }));
  });

  it("returns an empty array (not a throw) when the whole page is malformed", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    mockGetDocs.mockResolvedValueOnce({ docs: [snapOf("broken", undefined)] });

    await expect(fetchOpenDisputes()).resolves.toEqual([]);
  });
});

/* ── toDisputeDoc, exercised through the feed ───────────────── */

describe("dispute doc mapping", () => {
  beforeEach(() => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  async function mapOne(data: Record<string, unknown> | undefined): Promise<Dispute | undefined> {
    mockGetDocs.mockResolvedValueOnce({ docs: [snapOf("g1_3", data)] });
    const [d] = await fetchOpenDisputes();
    return d;
  }

  it.each([
    ["gameId", { gameId: 1 }],
    ["turnNumber", { turnNumber: "3" }],
    ["trickName", { trickName: null }],
    ["setterUid", { setterUid: undefined }],
    ["setterUsername", { setterUsername: 7 }],
    ["matcherUid", { matcherUid: false }],
    ["matcherUsername", { matcherUsername: {} }],
    ["matchVideoUrl", { matchVideoUrl: null }],
  ])("rejects a doc with a bad %s", async (_field, override) => {
    await expect(mapOne(validDisputeData(override))).resolves.toBeUndefined();
  });

  it("rejects a doc with no data at all", async () => {
    await expect(mapOne(undefined)).resolves.toBeUndefined();
  });

  it("passes a Timestamp createdAt through verbatim", async () => {
    const ts = new FakeTimestamp(1_700_000_000_123);
    const d = await mapOne(validDisputeData({ createdAt: ts }));
    expect(d?.createdAt).toBe(ts);
  });

  it("accepts a duck-typed createdAt that implements toMillis()", async () => {
    const duck = { toMillis: () => 1 };
    const d = await mapOne(validDisputeData({ createdAt: duck }));
    expect(d?.createdAt).toBe(duck);
  });

  it("maps a present-but-unusable createdAt to null", async () => {
    const d = await mapOne(validDisputeData({ createdAt: { nope: true } }));
    expect(d?.createdAt).toBeNull();
  });

  it("maps a missing createdAt to null (pending server timestamp)", async () => {
    const d = await mapOne(validDisputeData({ createdAt: undefined }));
    expect(d?.createdAt).toBeNull();
  });

  it("preserves 'closed' status and 'hidden' moderation when the backend surfaces them", async () => {
    const d = await mapOne(validDisputeData({ status: "closed", moderationStatus: "hidden" }));
    expect(d).toMatchObject({ status: "closed", moderationStatus: "hidden" });
  });

  it("defaults an unknown status/moderationStatus to open + active", async () => {
    const d = await mapOne(validDisputeData({ status: "weird", moderationStatus: undefined }));
    expect(d).toMatchObject({ status: "open", moderationStatus: "active" });
  });

  it("coerces a non-string setVideoUrl and spotId to null", async () => {
    const d = await mapOne(validDisputeData({ setVideoUrl: 42, spotId: undefined }));
    expect(d).toMatchObject({ setVideoUrl: null, spotId: null });
  });

  it("defaults missing vote aggregates to 0 (legacy-safe)", async () => {
    const d = await mapOne(validDisputeData({ landVotes: undefined, bailVotes: undefined }));
    expect(d).toMatchObject({ landVotes: 0, bailVotes: 0 });
  });

  it("treats non-numeric, non-finite and negative aggregates as 0", async () => {
    const d = await mapOne(validDisputeData({ landVotes: "broken", bailVotes: -3 }));
    expect(d).toMatchObject({ landVotes: 0, bailVotes: 0 });

    const e = await mapOne(validDisputeData({ landVotes: Number.NaN, bailVotes: 4 }));
    expect(e).toMatchObject({ landVotes: 0, bailVotes: 4 });
  });

  it.each(["land", "bail", "tie", "none"])("surfaces the referee's '%s' verdict", async (verdict) => {
    const d = await mapOne(validDisputeData({ status: "closed", verdict }));
    expect(d?.verdict).toBe(verdict);
  });

  it("omits the verdict entirely while the dispute is still open", async () => {
    const d = await mapOne(validDisputeData({ verdict: undefined }));
    expect(d?.verdict).toBeUndefined();
    expect(d).not.toHaveProperty("verdict");
  });

  it.each([["unknown-literal"], [3], [null], [{}]])(
    "drops an unrecognised verdict value (%s) rather than leaking it",
    async (verdict) => {
      const d = await mapOne(validDisputeData({ status: "closed", verdict }));
      expect(d?.verdict).toBeUndefined();
    },
  );
});

/* ── castDisputeVerdict ──────────────────────── */

describe("castDisputeVerdict", () => {
  function reads(
    voteExists: boolean,
    disputeData: Record<string, unknown> | null,
  ): Record<string, { exists: boolean; data?: Record<string, unknown> }> {
    return {
      disputeVotes: { exists: voteExists },
      disputes: disputeData === null ? { exists: false } : { exists: true, data: disputeData },
    };
  }

  it("writes the vote and the literal land tally in one transaction", async () => {
    const cap = captureTxOnce(reads(false, validDisputeData({ landVotes: 6, bailVotes: 2 })));

    const tally = await castDisputeVerdict("viewer", "g1_3", "land");

    expect(tally).toEqual({ land: 7, bail: 2 });
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "disputeVotes", "viewer_g1_3");
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "disputes", "g1_3");

    const tx = cap.observed();
    const [voteRef, votePayload] = tx.set.mock.calls[0];
    expect((voteRef as { __path: string }).__path).toBe("disputeVotes/viewer_g1_3");
    expect(votePayload).toEqual({
      uid: "viewer",
      disputeId: "g1_3",
      verdict: "land",
      createdAt: "SERVER_TS",
    });

    const [disputeRef, tallyPayload] = tx.update.mock.calls[0];
    expect((disputeRef as { __path: string }).__path).toBe("disputes/g1_3");
    // Literal, not increment(1) — lets us return the authoritative tally
    // without a second read, and matches the rule's `prev + 1` check. Only
    // the counter that moved is written.
    expect(tallyPayload).toEqual({ landVotes: 7 });
  });

  it("writes only the bail counter for a bail verdict", async () => {
    const cap = captureTxOnce(reads(false, validDisputeData({ landVotes: 1, bailVotes: 4 })));

    const tally = await castDisputeVerdict("viewer", "g1_3", "bail");

    expect(tally).toEqual({ land: 1, bail: 5 });
    expect(cap.observed().update.mock.calls[0][1]).toEqual({ bailVotes: 5 });
  });

  it("treats missing/corrupt aggregates as 0 so the literal write is always an int", async () => {
    const cap = captureTxOnce(reads(false, validDisputeData({ landVotes: undefined, bailVotes: "broken" })));

    const tally = await castDisputeVerdict("viewer", "g1_3", "land");

    expect(tally).toEqual({ land: 1, bail: 0 });
    expect(cap.observed().update.mock.calls[0][1]).toEqual({ landVotes: 1 });
  });

  it("throws AlreadyRuledError without writing when the vote doc exists", async () => {
    const cap = captureTxOnce(reads(true, validDisputeData()));

    await expect(castDisputeVerdict("viewer", "g1_3", "land")).rejects.toBeInstanceOf(AlreadyRuledError);
    const tx = cap.observed();
    expect(tx.set).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("throws OwnDisputeError for the setter who raised it", async () => {
    const cap = captureTxOnce(reads(false, validDisputeData()));

    await expect(castDisputeVerdict("setter", "g1_3", "land")).rejects.toBeInstanceOf(OwnDisputeError);
    expect(cap.observed().set).not.toHaveBeenCalled();
  });

  it("throws OwnDisputeError for the matcher under judgement", async () => {
    captureTxOnce(reads(false, validDisputeData()));
    await expect(castDisputeVerdict("matcher", "g1_3", "bail")).rejects.toBeInstanceOf(OwnDisputeError);
  });

  it("throws DisputeClosedError once voting has closed", async () => {
    const cap = captureTxOnce(reads(false, validDisputeData({ status: "closed" })));

    await expect(castDisputeVerdict("viewer", "g1_3", "land")).rejects.toBeInstanceOf(DisputeClosedError);
    expect(cap.observed().update).not.toHaveBeenCalled();
  });

  it("throws DisputeClosedError when the dispute doc is gone", async () => {
    captureTxOnce(reads(false, null));
    await expect(castDisputeVerdict("viewer", "g1_3", "land")).rejects.toBeInstanceOf(DisputeClosedError);
  });

  it("converts permission-denied into AlreadyRuledError when the caller's vote doc exists", async () => {
    mockRunTransaction.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    mockGetDoc.mockResolvedValueOnce({ exists: () => true });
    await expect(castDisputeVerdict("viewer", "g1_3", "land")).rejects.toBeInstanceOf(AlreadyRuledError);
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "disputeVotes", "viewer_g1_3");
  });

  it("converts permission-denied into DisputeClosedError when no vote doc exists (closed-read denial race)", async () => {
    mockRunTransaction.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(castDisputeVerdict("viewer", "g1_3", "land")).rejects.toBeInstanceOf(DisputeClosedError);
  });

  it("treats a failed vote-doc disambiguation read as closed — the safe terminal state", async () => {
    mockRunTransaction.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    mockGetDoc.mockRejectedValueOnce(new Error("offline"));
    await expect(castDisputeVerdict("viewer", "g1_3", "land")).rejects.toBeInstanceOf(DisputeClosedError);
  });

  it("propagates unexpected transaction errors verbatim", async () => {
    mockRunTransaction.mockRejectedValueOnce(new Error("unavailable"));
    await expect(castDisputeVerdict("viewer", "g1_3", "land")).rejects.toThrow(/unavailable/);
  });

  it("re-throws the business errors rather than masking them as AlreadyRuledError", async () => {
    captureTxOnce(reads(false, validDisputeData({ status: "closed" })));
    await expect(castDisputeVerdict("viewer", "g1_3", "land")).rejects.toThrow(/^dispute_closed:g1_3$/);

    captureTxOnce(reads(false, validDisputeData()));
    await expect(castDisputeVerdict("setter", "g1_3", "land")).rejects.toThrow(/^own_dispute:g1_3$/);
  });
});

/* ── fetchDisputeViewerState ─────────────────── */

describe("fetchDisputeViewerState", () => {
  function voteSnap(entries: Array<{ id: string; data: Record<string, unknown> }>) {
    return { docs: entries.map((e) => ({ id: e.id, data: () => e.data })) };
  }

  it("returns an empty Map with no reads when there are no disputes", async () => {
    const map = await fetchDisputeViewerState("viewer", []);
    expect(map.size).toBe(0);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("batches the viewer's vote-doc lookups into one keyed query", async () => {
    mockGetDocs.mockResolvedValueOnce(voteSnap([{ id: "viewer_g1_3", data: { disputeId: "g1_3", verdict: "land" } }]));

    const map = await fetchDisputeViewerState("viewer", [dispute(), dispute({ id: "g2_1" })]);

    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledWith({ __documentId: true }, "in", ["viewer_g1_3", "viewer_g2_1"]);
    expect(map.get("g1_3")).toEqual({ ownVerdict: "land", canVote: true });
    expect(map.get("g2_1")).toEqual({ ownVerdict: null, canVote: true });
  });

  it("marks both players canVote:false and never reads their vote docs", async () => {
    const map = await fetchDisputeViewerState("setter", [dispute()]);
    expect(map.get("g1_3")).toEqual({ ownVerdict: null, canVote: false });
    expect(mockGetDocs).not.toHaveBeenCalled();

    const matcherMap = await fetchDisputeViewerState("matcher", [dispute()]);
    expect(matcherMap.get("g1_3")).toEqual({ ownVerdict: null, canVote: false });
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("still hydrates a closed dispute's own verdict but reports canVote:false", async () => {
    mockGetDocs.mockResolvedValueOnce(voteSnap([{ id: "viewer_g1_3", data: { disputeId: "g1_3", verdict: "bail" } }]));

    const map = await fetchDisputeViewerState("viewer", [dispute({ status: "closed" })]);

    expect(map.get("g1_3")).toEqual({ ownVerdict: "bail", canVote: false });
  });

  it("mixes players and non-players in one call, querying only the non-players", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    const map = await fetchDisputeViewerState("setter", [
      dispute(),
      dispute({ id: "g2_1", setterUid: "other", matcherUid: "another" }),
    ]);

    expect(mockWhere).toHaveBeenCalledWith({ __documentId: true }, "in", ["setter_g2_1"]);
    expect(map.get("g1_3")).toEqual({ ownVerdict: null, canVote: false });
    expect(map.get("g2_1")).toEqual({ ownVerdict: null, canVote: true });
  });

  it("chunks vote-doc ids at Firestore's 30-value `in` cap", async () => {
    const many = Array.from({ length: 31 }, (_, i) => dispute({ id: `d${i}` }));
    mockGetDocs.mockResolvedValue({ docs: [] });

    await fetchDisputeViewerState("viewer", many);

    expect(mockGetDocs).toHaveBeenCalledTimes(2);
    const inLists = mockWhere.mock.calls.map((c) => c[2] as string[]);
    expect(inLists[0]).toHaveLength(30);
    expect(inLists[1]).toEqual(["viewer_d30"]);
  });

  it("ignores vote docs with an unusable disputeId, verdict, or an unknown target", async () => {
    mockGetDocs.mockResolvedValueOnce(
      voteSnap([
        { id: "viewer_g1_3", data: { disputeId: 42, verdict: "land" } },
        { id: "viewer_g1_3b", data: { disputeId: "g1_3", verdict: "maybe" } },
        { id: "viewer_zz", data: { disputeId: "not-on-this-page", verdict: "land" } },
      ]),
    );

    const map = await fetchDisputeViewerState("viewer", [dispute()]);

    expect(map.get("g1_3")).toEqual({ ownVerdict: null, canVote: true });
  });

  it("swallows a batch failure, logs once, and keeps the computed fallbacks", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    // Permanent code so withRetry aborts immediately instead of backing off.
    mockGetDocs.mockRejectedValue(Object.assign(new Error("denied"), { code: "permission-denied" }));

    const map = await fetchDisputeViewerState("viewer", [dispute(), dispute({ id: "g2_1", status: "closed" })]);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "dispute_viewer_state_batch_failed",
      expect.objectContaining({ error: "denied" }),
    );
    expect(map.get("g1_3")).toEqual({ ownVerdict: null, canVote: true });
    expect(map.get("g2_1")).toEqual({ ownVerdict: null, canVote: false });
  });
});

/* ── deleteUserDisputes (account-deletion cascade) ───────────── */

describe("deleteUserDisputes", () => {
  it("queries disputes the user raised and deletes each one", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [{ id: "g1_3" }, { id: "g7_4" }] });

    await deleteUserDisputes("setter");

    expect(mockWhere).toHaveBeenCalledWith("setterUid", "==", "setter");
    expect(mockDeleteDoc).toHaveBeenCalledTimes(2);
    const deletedIds = mockDeleteDoc.mock.calls.map(([ref]) => (ref as { id: string }).id);
    expect(deletedIds).toEqual(["g1_3", "g7_4"]);
  });

  it("is a no-op when the user raised none", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    await deleteUserDisputes("stranger");
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it("swallows the query error so account deletion continues", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    mockGetDocs.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));

    await expect(deleteUserDisputes("setter")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("disputes_delete_query_failed", expect.objectContaining({ uid: "setter" }));
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it("tolerates per-doc delete failures and logs the partial cascade", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    mockGetDocs.mockResolvedValueOnce({ docs: [{ id: "ok" }, { id: "fails" }] });
    mockDeleteDoc.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("transient"));

    await expect(deleteUserDisputes("setter")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("disputes_delete_partial", { uid: "setter", total: 2, failed: 1 });
  });
});

/* ── deleteUserDisputeVotes (account-deletion cascade) ───────── */

describe("deleteUserDisputeVotes", () => {
  function voteDocSnap(id: string, data: Record<string, unknown>) {
    return { id, data: () => data };
  }

  /** Runs every queued transaction against a shared stub. */
  function runTxWith(disputeReads: Array<{ exists: boolean; data?: Record<string, unknown> }>): ObservedTx[] {
    const observed: ObservedTx[] = [];
    let call = 0;
    mockRunTransaction.mockImplementation(async (_db: unknown, cb: (tx: unknown) => Promise<void>) => {
      const read = disputeReads[call++];
      const tx: ObservedTx = {
        get: vi.fn().mockResolvedValue({ exists: () => read.exists, data: () => read.data }),
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };
      observed.push(tx);
      await cb(tx);
    });
    return observed;
  }

  it("deletes each vote and decrements the counter its verdict incremented", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        voteDocSnap("viewer_g1_3", { disputeId: "g1_3", verdict: "land" }),
        voteDocSnap("viewer_g2_1", { disputeId: "g2_1", verdict: "bail" }),
      ],
    });
    const txs = runTxWith([
      { exists: true, data: { landVotes: 5, bailVotes: 1 } },
      { exists: true, data: { landVotes: 0, bailVotes: 3 } },
    ]);

    await deleteUserDisputeVotes("viewer");

    expect(mockWhere).toHaveBeenCalledWith("uid", "==", "viewer");
    expect(txs[0].delete).toHaveBeenCalledTimes(1);
    expect(txs[0].update).toHaveBeenCalledWith(expect.objectContaining({ __path: "disputes/g1_3" }), {
      landVotes: 4,
    });
    expect(txs[1].update).toHaveBeenCalledWith(expect.objectContaining({ __path: "disputes/g2_1" }), {
      bailVotes: 2,
    });
  });

  it("deletes the vote without a decrement when the dispute is already gone", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [voteDocSnap("viewer_g1_3", { disputeId: "g1_3", verdict: "land" })] });
    const txs = runTxWith([{ exists: false }]);

    await deleteUserDisputeVotes("viewer");

    expect(txs[0].delete).toHaveBeenCalledTimes(1);
    expect(txs[0].update).not.toHaveBeenCalled();
  });

  it("skips the decrement when the aggregate is already at (or below) its floor", async () => {
    // Writing 0 would be an empty diff the rule rejects, and -1 breaks its
    // `>= 0` floor — either rejection would fail the tx and orphan the vote.
    mockGetDocs.mockResolvedValueOnce({ docs: [voteDocSnap("viewer_g1_3", { disputeId: "g1_3", verdict: "land" })] });
    const txs = runTxWith([{ exists: true, data: { landVotes: 0 } }]);

    await deleteUserDisputeVotes("viewer");

    expect(txs[0].delete).toHaveBeenCalledTimes(1);
    expect(txs[0].update).not.toHaveBeenCalled();
  });

  it("still deletes a vote whose disputeId or verdict is unusable (no target to adjust)", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        voteDocSnap("viewer_a", { disputeId: "", verdict: "land" }),
        voteDocSnap("viewer_b", { disputeId: "g1_3", verdict: "sideways" }),
      ],
    });
    const txs = runTxWith([{ exists: true }, { exists: true }]);

    await deleteUserDisputeVotes("viewer");

    for (const tx of txs) {
      expect(tx.delete).toHaveBeenCalledTimes(1);
      expect(tx.get).not.toHaveBeenCalled();
      expect(tx.update).not.toHaveBeenCalled();
    }
  });

  it("is a no-op when the user cast no verdicts", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    await deleteUserDisputeVotes("stranger");
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("swallows the query error so account deletion continues", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    mockGetDocs.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));

    await expect(deleteUserDisputeVotes("viewer")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("dispute_votes_delete_query_failed", expect.objectContaining({ uid: "viewer" }));
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("tolerates per-vote transaction failures and logs the partial cascade", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        voteDocSnap("viewer_ok", { disputeId: "ok", verdict: "land" }),
        voteDocSnap("viewer_fails", { disputeId: "fails", verdict: "land" }),
      ],
    });
    mockRunTransaction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));

    await expect(deleteUserDisputeVotes("viewer")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("dispute_votes_delete_partial", { uid: "viewer", total: 2, failed: 1 });
  });
});
