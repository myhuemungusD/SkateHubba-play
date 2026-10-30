import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { makeGameClip } from "../../__tests__/clipFixtures.test-helpers";
import type { ClipDoc } from "../../../services/clips";
import { deferred } from "./deferred.test-helpers";

// The vote functions live in clips.votes; every feed import path (the legacy
// clips.upvotes re-exports and the clips barrel) resolves to these spies.
const votes = vi.hoisted(() => ({
  castClipVote: vi.fn(),
  removeClipVote: vi.fn(),
  fetchClipVoteState: vi.fn(),
}));
vi.mock("../../../services/clips.votes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/clips.votes")>()),
  ...votes,
}));
const feed = vi.hoisted(() => ({ fetchClipsFeed: vi.fn() }));
vi.mock("../../../services/clips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/clips")>()),
  fetchClipsFeed: feed.fetchClipsFeed,
}));
const noneBlocked = vi.hoisted(() => new Set<string>());
vi.mock("../../../hooks/useBlockedUsers", () => ({ useBlockedUsers: () => noneBlocked }));
vi.mock("../../../services/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/analytics")>()),
  trackEvent: vi.fn(),
}));

import { useClipsFeedController } from "../useClipsFeedController";
import { logger } from "../../../services/logger";

const clipA = makeGameClip({ id: "a", playerUid: "other" }) as ClipDoc;
const clipB = makeGameClip({ id: "b", playerUid: "other" }) as ClipDoc;
const mine = makeGameClip({ id: "m", playerUid: "me" }) as ClipDoc;
const page = (clips: ClipDoc[], cursor: unknown = null) => ({ clips, cursor });
const state = (up: number, down: number, myVote: 1 | -1 | null) => ({ upvoteCount: up, downvoteCount: down, myVote });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  votes.fetchClipVoteState.mockResolvedValue(new Map());
});
afterEach(() => warn.mockRestore());

async function loaded(clips: ClipDoc[], cursor: unknown = null) {
  feed.fetchClipsFeed.mockResolvedValueOnce(page(clips, cursor));
  const hook = renderHook(() => useClipsFeedController("me"));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

/** One loaded clip whose vote hydration and next vote write are both held open. */
async function withPendingHydrationAndVote() {
  const hydrate = deferred<Map<string, unknown>>();
  votes.fetchClipVoteState.mockReturnValueOnce(hydrate.promise);
  const { result } = await loaded([clipA]);
  const cast = deferred<ReturnType<typeof state>>();
  votes.castClipVote.mockReturnValueOnce(cast.promise);
  return { result, hydrate, cast };
}

describe("useClipsFeedController after unmount", () => {
  it("drops a first page that lands after unmount", async () => {
    const d = deferred<ReturnType<typeof page>>();
    feed.fetchClipsFeed.mockReturnValueOnce(d.promise);
    const { unmount } = renderHook(() => useClipsFeedController("me"));
    unmount();
    await act(async () => d.resolve(page([clipA])));
    expect(votes.fetchClipVoteState).not.toHaveBeenCalled();
  });

  it("logs but does not set state when the first page fails after unmount", async () => {
    const d = deferred<ReturnType<typeof page>>();
    feed.fetchClipsFeed.mockReturnValueOnce(d.promise);
    const { result, unmount } = renderHook(() => useClipsFeedController("me"));
    unmount();
    await act(async () => d.reject({ code: "unavailable" }));
    expect(warn).toHaveBeenCalledWith("clips_feed_load_failed", expect.objectContaining({ code: "unavailable" }));
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it("drops vote hydration that lands after unmount, and logs a failed hydration", async () => {
    const d = deferred<Map<string, unknown>>();
    votes.fetchClipVoteState.mockReturnValueOnce(d.promise);
    const first = await loaded([clipA]);
    first.unmount();
    await act(async () => d.resolve(new Map([["a", state(9, 0, 1)]])));
    expect(first.result.current.voteFor("a").upvoteCount).toBe(0);

    votes.fetchClipVoteState.mockRejectedValueOnce(new Error("quota"));
    const second = await loaded([clipB]);
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith("clips_feed_vote_hydrate_failed", { error: expect.any(String) }),
    );
    expect(second.result.current.voteFor("b")).toEqual(state(0, 0, null));
  });
});

describe("useClipsFeedController loadMore guards", () => {
  it("does nothing without a cursor and ignores a second call while one is in flight", async () => {
    const { result } = await loaded([clipA]);
    await act(() => result.current.loadMore());
    expect(feed.fetchClipsFeed).toHaveBeenCalledTimes(1);

    const withCursor = await loaded([clipA], "cur-1");
    const d = deferred<ReturnType<typeof page>>();
    feed.fetchClipsFeed.mockReturnValueOnce(d.promise);
    let first!: Promise<void>;
    act(() => {
      first = withCursor.result.current.loadMore();
    });
    await act(() => withCursor.result.current.loadMore());
    expect(feed.fetchClipsFeed).toHaveBeenCalledTimes(3);
    await act(async () => {
      d.resolve(page([clipB]));
      await first;
    });
    expect(withCursor.result.current.visibleClips.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("drops a next page, or its failure, that lands after unmount", async () => {
    const ok = await loaded([clipA], "cur-1");
    const d = deferred<ReturnType<typeof page>>();
    feed.fetchClipsFeed.mockReturnValueOnce(d.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = ok.result.current.loadMore();
    });
    ok.unmount();
    await act(async () => {
      d.resolve(page([clipB]));
      await pending;
    });
    expect(ok.result.current.visibleClips.map((c) => c.id)).toEqual(["a"]);

    const bad = await loaded([clipA], "cur-1");
    const f = deferred<ReturnType<typeof page>>();
    feed.fetchClipsFeed.mockReturnValueOnce(f.promise);
    act(() => {
      pending = bad.result.current.loadMore();
    });
    bad.unmount();
    await act(async () => {
      f.reject({ code: "permission-denied" });
      await pending;
    });
    expect(warn).toHaveBeenCalledWith(
      "clips_feed_load_more_failed",
      expect.objectContaining({ code: "permission-denied" }),
    );
    expect(bad.result.current.error).toBeNull();
    expect(bad.result.current.loadingMore).toBe(true);
  });
});

describe("useClipsFeedController vote guards", () => {
  it("refuses a vote on the viewer's own clip and a second tap while one is in flight", async () => {
    const { result } = await loaded([mine, clipA]);
    await act(() => result.current.handleUpvote(mine));
    expect(votes.castClipVote).not.toHaveBeenCalled();

    const d = deferred<ReturnType<typeof state>>();
    votes.castClipVote.mockReturnValueOnce(d.promise);
    let first!: Promise<void>;
    act(() => {
      first = result.current.handleUpvote(clipA);
    });
    expect(result.current.isVoting("a")).toBe(true);
    await act(() => result.current.handleDownvote(clipA));
    expect(votes.castClipVote).toHaveBeenCalledTimes(1);
    await act(async () => {
      d.resolve(state(1, 0, 1));
      await first;
    });
    expect(result.current.voteFor("a")).toEqual(state(1, 0, 1));
    expect(result.current.isVoting("a")).toBe(false);
  });

  it("keeps an in-flight optimistic vote when hydration for the same clip lands", async () => {
    const { result, hydrate, cast } = await withPendingHydrationAndVote();
    let voting!: Promise<void>;
    act(() => {
      voting = result.current.handleUpvote(clipA);
    });
    await act(async () => hydrate.resolve(new Map([["a", state(5, 5, null)]])));
    expect(result.current.voteFor("a")).toEqual(state(1, 0, 1));
    await act(async () => {
      cast.resolve(state(6, 5, 1));
      await voting;
    });
    expect(result.current.voteFor("a")).toEqual(state(6, 5, 1));
  });

  it("does not roll back over a snapshot that replaced the optimistic vote", async () => {
    const { result, hydrate, cast } = await withPendingHydrationAndVote();
    let voting!: Promise<void>;
    // Hydration resolves in the same batch as the tap, before the voting-ids
    // ref catches up, so the server snapshot replaces the optimistic value.
    await act(async () => {
      voting = result.current.handleUpvote(clipA);
      hydrate.resolve(new Map([["a", state(7, 0, null)]]));
      await hydrate.promise;
    });
    expect(result.current.voteFor("a")).toEqual(state(7, 0, null));
    await act(async () => {
      cast.reject(new Error("offline"));
      await voting;
    });
    expect(result.current.voteFor("a")).toEqual(state(7, 0, null));
  });

  it("logs a failed withdrawal as vote 0", async () => {
    votes.fetchClipVoteState.mockResolvedValueOnce(new Map([["a", state(1, 0, 1)]]));
    const { result } = await loaded([clipA]);
    await waitFor(() => expect(result.current.voteFor("a").myVote).toBe(1));
    votes.removeClipVote.mockRejectedValueOnce(new Error("offline"));
    await act(() => result.current.handleUpvote(clipA));
    expect(warn).toHaveBeenCalledWith("clips_feed_vote_failed", expect.objectContaining({ clipId: "a", vote: 0 }));
    expect(result.current.voteFor("a")).toEqual(state(1, 0, 1));
  });

  it("drops a vote result, or its failure, that lands after unmount", async () => {
    for (const settle of ["resolve", "reject"] as const) {
      const { result, unmount } = await loaded([clipA]);
      const d = deferred<ReturnType<typeof state>>();
      votes.castClipVote.mockReturnValueOnce(d.promise);
      let voting!: Promise<void>;
      act(() => {
        voting = result.current.handleUpvote(clipA);
      });
      unmount();
      await act(async () => {
        if (settle === "resolve") d.resolve(state(1, 0, 1));
        else d.reject(new Error("offline"));
        await voting;
      });
      // The last rendered state is the optimistic one; nothing after unmount.
      expect(result.current.voteFor("a")).toEqual(state(1, 0, 1));
      expect(result.current.isVoting("a")).toBe(true);
    }
  });
});
