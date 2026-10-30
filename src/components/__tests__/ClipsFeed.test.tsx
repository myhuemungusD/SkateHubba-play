import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClipsFeed } from "../ClipsFeed";
import { useClipsFeedController } from "../ClipsFeed/useClipsFeedController";
import { BLOCK_LIST_ERROR } from "../ClipsFeed/utils";
import type { UserProfile } from "../../services/users";
import type { ClipDoc } from "../../services/clips";
import type { ClipVoteState } from "../../services/clips";
import { deferred } from "../../__tests__/harness/deferred";
import { makeGameClip } from "./clipFixtures.test-helpers";
import { makeDispute } from "./disputeFixtures.test-helpers";
import { answerBlockList, failBlockList } from "./blockList.test-helpers";

const {
  mockFetchClipsFeed,
  mockFetchClipVoteState,
  mockVoteClip,
  mockRemoveClipVote,
  mockTrackEvent,
  mockFetchOpenDisputes,
  mockFetchDisputeViewerState,
  mockCastDisputeVerdict,
} = vi.hoisted(() => {
  // The shim below lets tests queue plain `[clip, clip]` arrays instead
  // of `{ clips, cursor }` page objects — kept compact so the test bodies
  // stay focused on behavior, not Firestore page shape.
  return {
    mockFetchClipsFeed: vi.fn(),
    mockFetchClipVoteState: vi.fn(),
    mockVoteClip: vi.fn(),
    mockRemoveClipVote: vi.fn(),
    mockTrackEvent: vi.fn(),
    mockFetchOpenDisputes: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
    mockFetchDisputeViewerState: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    mockCastDisputeVerdict: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
});

vi.mock("../../services/clips", () => ({
  fetchClipsFeed: async (...args: unknown[]) => {
    const result = await mockFetchClipsFeed(...args);
    return Array.isArray(result) ? { clips: result, cursor: null } : result;
  },
  fetchClipVoteState: (...args: unknown[]) => mockFetchClipVoteState(...args),
  castClipVote: (...args: unknown[]) => mockVoteClip(...args),
  removeClipVote: (...args: unknown[]) => mockRemoveClipVote(...args),
}));

// Both are lazy-loaded and only mount on an explicit tap. Stubbed so these
// tests never pull the capture stack or the comments service; their own
// suites own their behavior.
vi.mock("../UserClipUpload", () => ({
  UserClipUploadModal: ({ onClose, onPosted }: { onClose: () => void; onPosted?: () => void }) => (
    <div role="dialog" aria-label="upload-modal">
      <button onClick={onClose}>__close_upload__</button>
      <button onClick={() => onPosted?.()}>__posted__</button>
    </div>
  ),
}));

vi.mock("../ClipsFeed/ClipComments", () => ({
  ClipComments: ({
    onClose,
    onReport,
    onReportComment,
    onViewPlayer,
  }: {
    onViewPlayer?: (uid: string) => void;
    onClose: () => void;
    onReport?: () => void;
    onReportComment?: (c: { id: string; clipId: string; userId: string; username: string; text: string }) => void;
  }) => (
    <div role="dialog" aria-label="comments-sheet">
      <button onClick={onClose}>__close_comments__</button>
      {onReport && <button onClick={onReport}>__report_from_comments__</button>}
      {onReportComment && (
        <button
          onClick={() => onReportComment({ id: "cm1", clipId: "x", userId: "troll", username: "troll", text: "rude" })}
        >
          __report_comment__
        </button>
      )}
      {onViewPlayer && <button onClick={() => onViewPlayer("troll")}>__view_author__</button>}
    </div>
  ),
}));

vi.mock("../../services/clipModeration", () => ({
  fetchOwnClipModeration: vi.fn(async () => []),
}));

vi.mock("../../services/analytics", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

// The dispute lane sits above the spotlight and fetches on mount. These
// tests are about the clips lane, so it stays empty (and renders nothing);
// DisputeLane.test.tsx owns its behavior.
vi.mock("../../services/disputes", () => ({
  fetchOpenDisputes: (...args: unknown[]) => mockFetchOpenDisputes(...args),
  fetchDisputeViewerState: (...args: unknown[]) => mockFetchDisputeViewerState(...args),
  castDisputeVerdict: (...args: unknown[]) => mockCastDisputeVerdict(...args),
  AlreadyRuledError: class AlreadyRuledError extends Error {},
  OwnDisputeError: class OwnDisputeError extends Error {},
  DisputeClosedError: class DisputeClosedError extends Error {},
}));

// The real block-list hook runs over a stubbed listener: by default it
// answers at once with nobody blocked; tests stage a failure or a list.
const mockSubscribeToBlockedUsers = vi.hoisted(() => vi.fn());
vi.mock("../../services/blocking", () => ({
  subscribeToBlockedUsers: (...args: unknown[]) => mockSubscribeToBlockedUsers(...args),
}));

// Feed modes + Name It stay off unless a test flips them on.
const flags = vi.hoisted(() => ({ feedModes: false, wtt: false }));
vi.mock("../../lib/featureFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/featureFlags")>()),
  isFeedModesEnabled: () => flags.feedModes,
  isWttEnabled: () => flags.wtt,
}));

const mockUseWttFeed = vi.hoisted(() => vi.fn());
vi.mock("../../hooks/useWttFeed", () => ({
  useWttFeed: (...args: unknown[]) => mockUseWttFeed(...args),
}));

vi.mock("../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../ReportModal", () => ({
  ReportModal: ({
    onClose,
    onSubmitted,
    clipId,
    disputeId,
    reportedUid,
    comment,
  }: {
    onClose: () => void;
    onSubmitted: () => void;
    clipId?: string;
    disputeId?: string;
    reportedUid: string;
    comment?: { id: string; text: string };
  }) => (
    <div
      role="dialog"
      aria-label="report-modal"
      data-clip={clipId ?? ""}
      data-dispute={disputeId ?? ""}
      data-reported={reportedUid}
      data-comment={comment ? `${comment.id}:${comment.text}` : ""}
    >
      <button onClick={onSubmitted}>__submit__</button>
      <button onClick={onClose}>__close__</button>
    </div>
  ),
}));

const profile: UserProfile = {
  uid: "me",
  username: "viewer",
  stance: "regular",
  createdAt: null,
};

/** Feed tiles render a relative timestamp, so this suite needs a real one. */
function makeClip(overrides: Partial<ClipDoc> = {}): ClipDoc {
  return makeGameClip({
    createdAt: { toMillis: () => Date.now() - 3 * 60_000 } as ClipDoc["createdAt"],
    ...overrides,
  });
}

/** A feed clip whose video URL is a Firebase Storage object named after `id`. */
function storageClip(
  id: string,
  trickName: string,
  player: { playerUid: string; playerUsername: string } = { playerUid: "p1", playerUsername: "alice" },
): ClipDoc {
  return makeClip({
    id,
    trickName,
    playerUid: player.playerUid,
    playerUsername: player.playerUsername,
    videoUrl: `https://firebasestorage.googleapis.com/v0/b/x/o/${id}.webm?alt=media`,
  });
}

/** Vote-state fixture — spelled out so tests only state what they care about. */
function voteState(overrides: Partial<ClipVoteState> = {}): ClipVoteState {
  return { upvoteCount: 0, downvoteCount: 0, myVote: null, ...overrides };
}

/**
 * Shared preamble for the vote tests: render the feed with one clip hydrated
 * at 2 upvotes / 0 downvotes and the named outcome staged on `castClipVote`,
 * then return the thumbs-up button so the test can drive the click + assert.
 */
async function mountWithUpvoteSetup(
  outcome: { kind: "success"; resolved: ClipVoteState } | { kind: "error"; error: Error },
) {
  const user = userEvent.setup();
  mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
  mockFetchClipVoteState.mockResolvedValueOnce(new Map([["g1_2_set", voteState({ upvoteCount: 2 })]]));
  if (outcome.kind === "success") {
    mockVoteClip.mockResolvedValueOnce(outcome.resolved);
  } else {
    mockVoteClip.mockRejectedValueOnce(outcome.error);
  }
  render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
  await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
  const upvoteBtn = await screen.findByRole("button", {
    name: /Thumbs up clip by @alice · current count 2/i,
  });
  return { user, upvoteBtn };
}

/**
 * Report the only clip in `firstPage` away, confirm the exhausted state, then
 * tap "Load more clips" and wait for the refetched clip to render. Callers
 * assert on HOW the refetch was issued (fresh page vs cursor).
 */
async function reportAwayThenLoadMore(firstPage: ClipDoc[] | { clips: ClipDoc[]; cursor: unknown }) {
  const user = userEvent.setup();
  mockFetchClipsFeed.mockResolvedValueOnce(firstPage);
  render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

  await user.click(await screen.findByRole("button", { name: /report clip by @alice/i }));
  await user.click(await screen.findByText("__submit__"));

  // Same treatment as the empty state: a heading and the primary button.
  expect(await screen.findByRole("heading", { name: "That's everything in this batch." })).toBeInTheDocument();
  const loadMore = screen.getByRole("button", { name: /load more clips/i });
  expect(loadMore.className).toContain("from-brand-orange");
  expect(loadMore.className).not.toContain("btn-secondary");
  mockFetchClipsFeed.mockResolvedValueOnce([makeClip({ id: "g2_1_set", trickName: "Tre Flip" })]);
  await user.click(loadMore);

  await waitFor(() => expect(screen.getByText("Tre Flip")).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps queued mockResolvedValueOnce answers; a leftover
  // page must never leak into the next test (hesher #934 S4).
  mockFetchClipsFeed.mockReset();
  flags.feedModes = false;
  flags.wtt = false;
  mockUseWttFeed.mockReturnValue({
    currentItem: null,
    dailyCount: 20,
    dailyLimit: 20,
    loading: false,
    reliability: null,
    submitAnswer: vi.fn(),
    skipCurrent: vi.fn(),
  });
  mockFetchClipVoteState.mockResolvedValue(new Map());
  mockFetchOpenDisputes.mockResolvedValue([]);
  mockFetchDisputeViewerState.mockResolvedValue(new Map());
  mockCastDisputeVerdict.mockResolvedValue({ land: 0, bail: 0 });
  mockSubscribeToBlockedUsers.mockImplementation(answerBlockList([]));
});

describe("ClipsFeed", () => {
  it("shows the loading state on first mount", () => {
    mockFetchClipsFeed.mockImplementation(() => new Promise(() => {}));
    mockFetchOpenDisputes.mockImplementation(() => new Promise(() => {}));
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    expect(screen.getByRole("status", { name: /loading clips/i })).toBeInTheDocument();
  });

  it("renders no dispute lane when nothing is waiting on the community", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(screen.queryByText(/Community call: Landed or bailed/i)).not.toBeInTheDocument();
  });

  it("renders the empty state when the page comes back empty", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Feed's empty\. Go fill it\./i)).toBeInTheDocument());
  });

  describe("when a page comes back with no user posts but a cursor", () => {
    const ts = { toMillis: () => Date.now() - 60_000 } as ClipDoc["createdAt"];
    const at = (id: string) => ({ createdAt: ts, id });

    it("follows the cursor on the first load instead of showing no clips", async () => {
      mockFetchClipsFeed
        .mockResolvedValueOnce({ clips: [], cursor: at("c1") })
        .mockResolvedValueOnce({ clips: [makeClip({ id: "u1", trickName: "Deep" })], cursor: null });
      render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
      expect(await screen.findByText("Deep")).toBeInTheDocument();
      expect(mockFetchClipsFeed.mock.calls.map((c) => c[0])).toEqual([null, at("c1")]);
    });

    it("keeps paging forward on load more, and stops once the cursor is null", async () => {
      const user = userEvent.setup();
      mockFetchClipsFeed
        .mockResolvedValueOnce({ clips: [makeClip({ id: "a", trickName: "TrickA" })], cursor: at("a") })
        .mockResolvedValueOnce({ clips: [], cursor: at("c2") })
        .mockResolvedValueOnce({ clips: [makeClip({ id: "b", trickName: "TrickB" })], cursor: null });
      render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
      await screen.findByText("TrickA");

      await user.keyboard("{ArrowDown}");
      expect(await screen.findByText("TrickB")).toBeInTheDocument();
      expect(mockFetchClipsFeed).toHaveBeenCalledTimes(3);

      await user.keyboard("{ArrowDown}");
      expect(mockFetchClipsFeed).toHaveBeenCalledTimes(3);
    });

    it("ends the feed when the first load's follow-ups stop on an unmoved cursor", async () => {
      // The top-index fallback re-serves the same page: the cursor is not
      // null but didn't move, so there is nothing more to load (M17).
      const user = userEvent.setup();
      mockFetchClipsFeed
        .mockResolvedValueOnce({ clips: [], cursor: at("c1") })
        .mockResolvedValueOnce({ clips: [makeClip({ id: "a", trickName: "TrickA" })], cursor: at("c1") });
      render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
      await screen.findByText("TrickA");
      expect(mockFetchClipsFeed).toHaveBeenCalledTimes(2);

      await user.keyboard("{ArrowDown}");
      await act(async () => {});
      expect(mockFetchClipsFeed).toHaveBeenCalledTimes(2);
    });

    it("gives up after three more calls and shows the empty state", async () => {
      for (const id of ["c1", "c2", "c3", "c4"]) {
        mockFetchClipsFeed.mockResolvedValueOnce({ clips: [], cursor: at(id) });
      }
      render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
      expect(await screen.findByText(/Feed's empty\. Go fill it\./i)).toBeInTheDocument();
      expect(mockFetchClipsFeed).toHaveBeenCalledTimes(4);
    });
  });

  it("requests fetchClipsFeed with sort='top' (sample 12) on mount — top is the default", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(mockFetchClipsFeed).toHaveBeenCalledWith(null, 12, "top");
  });

  it("renders the Top/New toggle with Top selected by default", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    const topBtn = screen.getByRole("button", { name: "Top" });
    const newBtn = screen.getByRole("button", { name: "New" });
    expect(topBtn).toHaveAttribute("aria-pressed", "true");
    expect(newBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking New re-fetches with sort='new' and resets the spotlight to the first clip", async () => {
    const user = userEvent.setup();
    // First page (top) has TopTrick; toggling to new returns NewTrick.
    mockFetchClipsFeed
      .mockResolvedValueOnce([makeClip({ id: "top1", trickName: "TopTrick" })])
      .mockResolvedValueOnce([makeClip({ id: "new1", trickName: "NewTrick", playerUid: "p2", playerUsername: "bob" })]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("TopTrick")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "New" }));

    // Second call uses sort='new' and the spotlight swaps to the new page.
    await waitFor(() => expect(screen.getByText("NewTrick")).toBeInTheDocument());
    expect(mockFetchClipsFeed).toHaveBeenLastCalledWith(null, 12, "new");
    // aria-pressed flips so the selected affordance is on New.
    expect(screen.getByRole("button", { name: "New" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Top" })).toHaveAttribute("aria-pressed", "false");
  });

  it("fires clips_sort_changed when the user flips the toggle", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed
      .mockResolvedValueOnce([makeClip()])
      .mockResolvedValueOnce([makeClip({ id: "n", trickName: "NewTrick", playerUid: "p2", playerUsername: "bob" })]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "New" }));

    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalledWith("clips_sort_changed", { from: "top", to: "new" }));
  });

  it("does NOT fire clips_sort_changed when the same sort is re-selected (no-op tap)", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Top" }));

    expect(mockTrackEvent).not.toHaveBeenCalledWith("clips_sort_changed", expect.any(Object));
    // No re-fetch either — first call only.
    expect(mockFetchClipsFeed).toHaveBeenCalledTimes(1);
  });

  it("locks the toggle while a fetch is in flight (no concurrent requests on rapid taps)", async () => {
    const user = userEvent.setup();
    // First load resolves; second is blocked so the loading state persists
    // across the second tap. The component must reject the third tap because
    // the toggle is disabled.
    const blocker = deferred<ClipDoc[]>();
    mockFetchClipsFeed
      .mockResolvedValueOnce([makeClip()])
      .mockImplementationOnce(() => blocker.promise as Promise<unknown>);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "New" }));
    // Loading skeleton renders → toggle is disabled.
    await waitFor(() => expect(screen.getByRole("button", { name: "Top" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();

    // Rapid second tap on Top should be ignored — still only 2 fetches total.
    await user.click(screen.getByRole("button", { name: "Top" }));
    expect(mockFetchClipsFeed).toHaveBeenCalledTimes(2);

    blocker.resolve([makeClip({ id: "n", trickName: "NewTrick", playerUid: "p2", playerUsername: "bob" })]);
    await waitFor(() => expect(screen.getByText("NewTrick")).toBeInTheDocument());
    // Once the load completes, toggle re-enables.
    expect(screen.getByRole("button", { name: "Top" })).not.toBeDisabled();
  });

  it("fires clip_voted with fromSort and the vote value on a successful upvote", async () => {
    const { user, upvoteBtn } = await mountWithUpvoteSetup({
      kind: "success",
      resolved: voteState({ upvoteCount: 3, myVote: 1 }),
    });

    await user.click(upvoteBtn);

    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalledWith("clip_voted", expect.any(Object)));
    expect(mockTrackEvent).toHaveBeenCalledWith("clip_voted", {
      clipId: "g1_2_set",
      fromSort: "top",
      vote: 1,
    });
  });

  it("does NOT fire clip_voted when the vote write fails", async () => {
    const { user, upvoteBtn } = await mountWithUpvoteSetup({ kind: "error", error: new Error("network down") });

    await user.click(upvoteBtn);

    // Wait for the rollback so we don't false-pass on timing.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Thumbs up clip by @alice · current count 2/i })).toBeEnabled(),
    );
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it("renders the spotlight clip with player + trick + role + timestamp", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("SET")).toBeInTheDocument();
    expect(screen.getByText(/3m ago/)).toBeInTheDocument();
  });

  it("fires onViewPlayer when the username is tapped", async () => {
    const user = userEvent.setup();
    const onViewPlayer = vi.fn();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={onViewPlayer} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    await user.click(screen.getByText("@alice"));
    expect(onViewPlayer).toHaveBeenCalledWith("p1");
  });

  it("fires onChallengeUser when the challenge CTA is tapped", async () => {
    const user = userEvent.setup();
    const onChallengeUser = vi.fn();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={onChallengeUser} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /challenge/i }));
    expect(onChallengeUser).toHaveBeenCalledWith("alice");
  });

  it("hides the challenge CTA on the viewer's own clip", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip({ playerUid: profile.uid, playerUsername: profile.username })]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /challenge/i })).not.toBeInTheDocument();
  });

  it("keeps Share off the rail while VITE_FEATURE_FEED_SHARE is off, so the rail is unchanged", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    const rate = await screen.findByRole("group", { name: "Rate this clip" });
    expect(screen.queryByRole("button", { name: /^Share/ })).not.toBeInTheDocument();
    const rail = rate.parentElement!;
    expect([...rail.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Thumbs up clip by @alice · current count 0",
      "Thumbs down clip by @alice",
      "Comments on @alice's clip",
      "Challenge @alice",
      "Report clip by @alice",
    ]);
    expect(screen.getByRole("button", { name: /mute clip/i }).className.split(" ")).not.toContain("left-3");
  });

  it("puts Share under comments for another player's clip and your own when VITE_FEATURE_FEED_SHARE is on", async () => {
    vi.stubEnv("VITE_FEATURE_FEED_SHARE", "true");
    try {
      mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
      const { unmount } = render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
      const share = await screen.findByRole("button", { name: "Share @alice's Kickflip" });
      expect(share).toBeEnabled();
      const labels = [...share.parentElement!.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
      expect(labels.indexOf("Share @alice's Kickflip")).toBe(labels.indexOf("Comments on @alice's clip") + 1);
      // The mute toggle moves aside on short screens so the taller rail never covers it.
      expect(screen.getByRole("button", { name: /mute clip/i }).className).toContain(
        "[@media(max-height:600px)]:left-3",
      );
      unmount();

      mockFetchClipsFeed.mockResolvedValueOnce([
        makeClip({ playerUid: profile.uid, playerUsername: profile.username }),
      ]);
      render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
      expect(await screen.findByRole("button", { name: "Share your Kickflip" })).toBeEnabled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("opens the report modal and skips the reported clip", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([
      makeClip({ id: "a", trickName: "TrickA" }),
      makeClip({ id: "b", trickName: "TrickB", playerUid: "p2", playerUsername: "bob" }),
    ]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("TrickA")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /report clip by @alice/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: /report-modal/i })).toBeInTheDocument());

    await user.click(screen.getByText("__submit__"));
    // After report, the next visible clip ("TrickB") becomes the spotlight.
    await waitFor(() => expect(screen.getByText("TrickB")).toBeInTheDocument());
    expect(screen.queryByText("TrickA")).not.toBeInTheDocument();
  });

  it("renders an error state with retry when the initial fetch fails", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([makeClip()]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Couldn't load the feed/i)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
  });

  it("uses service-side error copy when the failure is permission-denied", async () => {
    mockFetchClipsFeed.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/Feed temporarily unavailable — please try again in a moment\./i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Check your connection/i)).not.toBeInTheDocument();
  });

  it("uses service-side error copy for failed-precondition (missing index)", async () => {
    mockFetchClipsFeed.mockRejectedValueOnce(
      Object.assign(new Error("index missing"), { code: "failed-precondition" }),
    );
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/Feed temporarily unavailable — please try again in a moment\./i)).toBeInTheDocument(),
    );
  });

  it("renders both thumbs with their hydrated counts", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    mockFetchClipVoteState.mockResolvedValueOnce(
      new Map([["g1_2_set", voteState({ upvoteCount: 4, downvoteCount: 2 })]]),
    );

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Thumbs up clip by @alice · current count 4/i })).toBeInTheDocument(),
    );
    // The thumbs-down count stays private (audit #24); only the thumbs-up count is shown.
    expect(screen.getByRole("button", { name: /Thumbs down clip by @alice$/i })).not.toHaveTextContent("2");
  });

  it("shows both thumbs on the viewer's own clip but disables them — counts stay readable", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip({ playerUid: profile.uid, playerUsername: profile.username })]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /Thumbs up .* you can't vote on your own clip/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Thumbs down .* you can't vote on your own clip/i })).toBeDisabled();
  });

  it("optimistically increments the upvote and marks it pressed on tap", async () => {
    const { user, upvoteBtn } = await mountWithUpvoteSetup({
      kind: "success",
      resolved: voteState({ upvoteCount: 3, myVote: 1 }),
    });

    await user.click(upvoteBtn);

    expect(mockVoteClip).toHaveBeenCalledWith(profile.uid, "g1_2_set", 1);
    const pressed = await screen.findByRole("button", { name: /Remove your thumbs up on @alice's clip · 3/i });
    expect(pressed).toHaveAttribute("aria-pressed", "true");
  });

  it("tapping the thumb you already gave withdraws it via removeClipVote", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    mockFetchClipVoteState.mockResolvedValueOnce(new Map([["g1_2_set", voteState({ upvoteCount: 3, myVote: 1 })]]));
    mockRemoveClipVote.mockResolvedValueOnce(voteState({ upvoteCount: 2, myVote: null }));

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    const pressed = await screen.findByRole("button", { name: /Remove your thumbs up on @alice's clip · 3/i });

    await user.click(pressed);

    expect(mockRemoveClipVote).toHaveBeenCalledWith(profile.uid, "g1_2_set");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Thumbs up clip by @alice · current count 2/i })).toBeInTheDocument(),
    );
  });

  it("flipping up to down moves the tally across both counters in one write", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    mockFetchClipVoteState.mockResolvedValueOnce(
      new Map([["g1_2_set", voteState({ upvoteCount: 3, downvoteCount: 1, myVote: 1 })]]),
    );
    mockVoteClip.mockResolvedValueOnce(voteState({ upvoteCount: 2, downvoteCount: 2, myVote: -1 }));

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    const downBtn = await screen.findByRole("button", { name: /Thumbs down clip by @alice$/i });

    await user.click(downBtn);

    expect(mockVoteClip).toHaveBeenCalledWith(profile.uid, "g1_2_set", -1);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Remove your thumbs down on @alice's clip$/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Thumbs up clip by @alice · current count 2/i })).toBeInTheDocument();
  });

  it("rolls back the optimistic upvote when the write fails", async () => {
    const { user, upvoteBtn } = await mountWithUpvoteSetup({ kind: "error", error: new Error("network down") });

    await user.click(upvoteBtn);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Thumbs up clip by @alice · current count 2/i })).toBeEnabled(),
    );
  });

  it("still rolls back cleanly when a sort-toggle re-fetch interleaves with an in-flight upvote rejection", async () => {
    // Race scenario: viewer taps upvote → flips Top/New → upvote network
    // call rejects. The hydration race-guard skips the in-flight clip (its
    // id is in upvotingIds), so the catch sees the optimistic value still
    // in place and is safe to roll back. The defensive equality check in
    // the catch ensures the rollback only fires when the state still
    // matches our optimistic write — protecting against future hydration
    // logic that might write through under different conditions.
    const user = userEvent.setup();
    const upvote = deferred<ClipVoteState>();
    const hydrationAfterToggle = deferred<Map<string, ClipVoteState>>();

    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]).mockResolvedValueOnce([makeClip()]);
    mockFetchClipVoteState
      .mockResolvedValueOnce(new Map([["g1_2_set", voteState({ upvoteCount: 2 })]]))
      .mockReturnValueOnce(hydrationAfterToggle.promise);
    mockVoteClip.mockReturnValueOnce(upvote.promise);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await screen.findByRole("button", { name: /Thumbs up clip by @alice · current count 2/i });

    await user.click(screen.getByRole("button", { name: /Thumbs up clip by @alice · current count 2/i }));
    await screen.findByRole("button", { name: /Remove your thumbs up on @alice's clip · 3/i });

    // Flip sort — triggers a new pool load + a new hydration that is
    // intentionally left pending so the upvote rejection lands first.
    await user.click(screen.getByRole("button", { name: "New" }));

    // Reject the upvote — catch must restore the pre-tap state (count=2).
    await act(async () => {
      upvote.reject(new Error("network down"));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Thumbs up clip by @alice · current count 2/i })).toBeEnabled(),
    );

    // Hydration finally resolves — it should not crash the test and the
    // displayed count remains the post-rollback authoritative value.
    await act(async () => {
      hydrationAfterToggle.resolve(new Map([["g1_2_set", voteState({ upvoteCount: 2 })]]));
    });
    expect(screen.getByRole("button", { name: /Thumbs up clip by @alice · current count 2/i })).toBeInTheDocument();
  });

  it("adopts the server's authoritative counts when they differ from the optimistic guess", async () => {
    // Someone else voted between hydration and this write. The server's
    // returned state wins — the optimistic 3 must not stick.
    const { user, upvoteBtn } = await mountWithUpvoteSetup({
      kind: "success",
      resolved: voteState({ upvoteCount: 9, downvoteCount: 4, myVote: 1 }),
    });

    await user.click(upvoteBtn);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Remove your thumbs up on @alice's clip · 9/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Thumbs down clip by @alice$/i })).toBeInTheDocument();
  });

  it("renders the spotlight video with autoplay/muted attributes and a tap-to-unmute affordance", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /Unmute clip/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play clip|Pause clip/i })).toBeInTheDocument();

    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    // The clip loops until the viewer swipes away. It does not auto-advance.
    expect(video.loop).toBe(true);
  });

  it("toggles mute on the spotlight clip when the unmute affordance is tapped", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    const unmuteBtn = screen.getByRole("button", { name: /Unmute clip/i });
    await user.click(unmuteBtn);

    await waitFor(() => expect(screen.getByRole("button", { name: /Mute clip/i })).toBeInTheDocument());
  });

  it("hands the full clip pool to the vote-state service so it can read counts off the denormalized aggregates", async () => {
    // The service filters self-clips internally and reads `upvoteCount` /
    // `downvoteCount` straight off each clip doc — the component no longer
    // pre-extracts ids. Passing the whole pool also lets the service use a
    // single batched `where(__name__, in, [...])` query (1 read, not 2*N).
    const own = makeClip({ id: "own", playerUid: profile.uid, playerUsername: profile.username });
    const other = makeClip({ id: "other", playerUid: "p2", playerUsername: "bob" });
    mockFetchClipsFeed.mockResolvedValueOnce([own, other]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(mockFetchClipVoteState).toHaveBeenCalled());

    expect(mockFetchClipVoteState).toHaveBeenCalledWith(profile.uid, [own, other]);
  });

  it("still calls vote hydration when every clip is the viewer's own — service short-circuits without a read", async () => {
    // The service does the self-filter; an own-only pool is a 0-read
    // call inside the service, not a never-call from the component.
    const own = makeClip({ playerUid: profile.uid, playerUsername: profile.username });
    mockFetchClipsFeed.mockResolvedValueOnce([own]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    expect(mockFetchClipVoteState).toHaveBeenCalledWith(profile.uid, [own]);
  });

  it("preserves an optimistic upvote when a slow hydration resolves after the user's tap (race guard)", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    const hydration = deferred<Map<string, ClipVoteState>>();
    mockFetchClipVoteState.mockReturnValueOnce(hydration.promise);
    mockVoteClip.mockResolvedValueOnce(voteState({ upvoteCount: 6, myVote: 1 }));

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    const upvoteBtn = await screen.findByRole("button", { name: /Thumbs up clip by @alice · current count 0/i });
    await user.click(upvoteBtn);
    await screen.findByRole("button", { name: /Remove your thumbs up on @alice's clip · 6/i });

    hydration.resolve(new Map([["g1_2_set", voteState({ upvoteCount: 4 })]]));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByRole("button", { name: /Remove your thumbs up on @alice's clip · 6/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Thumbs up clip by @alice · current count 4/i }),
    ).not.toBeInTheDocument();
  });

  it("loops the active clip and does not offer a next-trick overlay when it ends", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([
      makeClip({ id: "a", trickName: "TrickA" }),
      makeClip({ id: "b", trickName: "TrickB", playerUid: "p2", playerUsername: "bob" }),
    ]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("TrickA")).toBeInTheDocument());

    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video.loop).toBe(true);
    fireEvent.ended(video);

    expect(screen.queryByRole("button", { name: /Replay clip/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Next trick/i })).not.toBeInTheDocument();
    expect(screen.getByText("TrickA")).toBeInTheDocument();
  });

  it("arrow down snaps to the next clip and arrow up snaps back", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([
      makeClip({ id: "a", trickName: "TrickA" }),
      makeClip({ id: "b", trickName: "TrickB", playerUid: "p2", playerUsername: "bob" }),
    ]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("TrickA")).toBeInTheDocument());

    await user.keyboard("{ArrowDown}");

    await waitFor(() => expect(screen.getByText("TrickB")).toBeInTheDocument());
    expect(screen.queryByText("TrickA")).not.toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();

    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(screen.getByText("TrickA")).toBeInTheDocument());
    expect(screen.queryByText("TrickB")).not.toBeInTheDocument();
  });

  it("arrow down on the last loaded clip does not restart the feed", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip({ id: "only", trickName: "OnlyTrick" })]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("OnlyTrick")).toBeInTheDocument());

    await user.keyboard("{ArrowDown}");

    expect(screen.getByText("OnlyTrick")).toBeInTheDocument();
    expect(mockFetchClipsFeed).toHaveBeenCalledTimes(1);
  });

  it("arrow down on the last clip pages forward with the cursor and lands on the first new clip", async () => {
    const user = userEvent.setup();
    const ts = { toMillis: () => Date.now() - 60_000 } as ClipDoc["createdAt"];
    const cursor = { createdAt: ts, id: "a", upvoteCount: 0 };
    mockFetchClipsFeed
      .mockResolvedValueOnce({ clips: [makeClip({ id: "a", trickName: "TrickA" })], cursor })
      .mockResolvedValueOnce({
        clips: [
          // Duplicate of the page-boundary row — must be dropped, not shown twice.
          makeClip({ id: "a", trickName: "TrickA" }),
          makeClip({ id: "b", trickName: "TrickB", playerUid: "p2", playerUsername: "bob" }),
        ],
        cursor: null,
      });

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("TrickA")).toBeInTheDocument());

    await user.keyboard("{ArrowDown}");

    await waitFor(() => expect(screen.getByText("TrickB")).toBeInTheDocument());
    expect(mockFetchClipsFeed).toHaveBeenLastCalledWith(cursor, 12, "top");
    expect(screen.getByText("2/2")).toBeInTheDocument();

    // Nothing left to page. Another arrow stays put instead of restarting.
    await user.keyboard("{ArrowDown}");
    expect(mockFetchClipsFeed).toHaveBeenCalledTimes(2);
    expect(screen.getByText("TrickB")).toBeInTheDocument();
  });

  it("stops paging when a cursor page adds nothing new (top-index fallback serves page one)", async () => {
    const user = userEvent.setup();
    const ts = { toMillis: () => Date.now() - 60_000 } as ClipDoc["createdAt"];
    const cursor = { createdAt: ts, id: "a" };
    mockFetchClipsFeed
      .mockResolvedValueOnce({ clips: [makeClip({ id: "a", trickName: "TrickA" })], cursor })
      .mockResolvedValueOnce({ clips: [makeClip({ id: "a", trickName: "TrickA" })], cursor });

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("TrickA")).toBeInTheDocument());

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(mockFetchClipsFeed).toHaveBeenCalledTimes(2));
    expect(screen.getByText("1/1")).toBeInTheDocument();

    await user.keyboard("{ArrowDown}");
    expect(mockFetchClipsFeed).toHaveBeenCalledTimes(2);
    expect(screen.getByText("TrickA")).toBeInTheDocument();
  });

  it("shows the error copy when paging forward fails, keeping the current clip", async () => {
    const user = userEvent.setup();
    const ts = { toMillis: () => Date.now() - 60_000 } as ClipDoc["createdAt"];
    mockFetchClipsFeed
      .mockResolvedValueOnce({
        clips: [makeClip({ id: "a", trickName: "TrickA" })],
        cursor: { createdAt: ts, id: "a" },
      })
      .mockRejectedValueOnce(new Error("offline"));

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("TrickA")).toBeInTheDocument());

    await user.keyboard("{ArrowDown}");

    expect(await screen.findByText(/couldn't load the feed/i)).toBeInTheDocument();
    expect(screen.getByText("TrickA")).toBeInTheDocument();
  });

  it("'Load more clips' on the exhausted state uses the cursor when there is more to page", async () => {
    const ts = { toMillis: () => Date.now() - 60_000 } as ClipDoc["createdAt"];
    const cursor = { createdAt: ts, id: "g1_2_set" };
    await reportAwayThenLoadMore({ clips: [makeClip()], cursor });
    expect(mockFetchClipsFeed).toHaveBeenLastCalledWith(cursor, 12, "top");
  });

  it("offers retry and skip when the clip fails to load, and arrow down still moves on", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([
      makeClip({ id: "a", trickName: "TrickA" }),
      makeClip({ id: "b", trickName: "TrickB", playerUid: "p2", playerUsername: "bob" }),
    ]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("TrickA")).toBeInTheDocument());

    fireEvent.error(document.querySelector("video") as HTMLVideoElement);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't play this clip/i);
    expect(screen.getByRole("button", { name: /retry clip/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip to next" })).toBeInTheDocument();

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getByText("TrickB")).toBeInTheDocument());
  });

  it("pauses the spotlight clip when it scrolls out of the viewport and resumes on re-entry", async () => {
    type IOCallback = ConstructorParameters<typeof IntersectionObserver>[0];
    let ioCallback: IOCallback | null = null;
    const originalIO = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(cb: IOCallback) {
        ioCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    } as unknown as typeof IntersectionObserver;

    try {
      mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);

      render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
      await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

      const videoEl = document.querySelector("video") as HTMLVideoElement;
      expect(videoEl).toBeTruthy();
      const playSpy = vi.spyOn(videoEl, "play").mockResolvedValue();
      const pauseSpy = vi.spyOn(videoEl, "pause").mockImplementation(() => undefined);

      // Regression guard: out-of-viewport BEFORE play() resolves must NOT
      // pause() — that revokes the muted-autoplay grant on mobile Safari.
      //
      // The IO callback registers in a useEffect that flushes after the
      // clip's text commits, so await it instead of reading synchronously.
      await waitFor(() => expect(ioCallback).toBeTruthy());
      const outOfView = { isIntersecting: false, target: videoEl } as unknown as IntersectionObserverEntry;
      ioCallback!([outOfView], {} as IntersectionObserver);
      expect(pauseSpy).not.toHaveBeenCalled();

      const intersecting = { isIntersecting: true, target: videoEl } as unknown as IntersectionObserverEntry;
      ioCallback!([intersecting], {} as IntersectionObserver);
      expect(playSpy).toHaveBeenCalled();

      await Promise.resolve();
      await Promise.resolve();

      ioCallback!([outOfView], {} as IntersectionObserver);
      expect(pauseSpy).toHaveBeenCalled();

      const playCalls = playSpy.mock.calls.length;
      ioCallback!([intersecting], {} as IntersectionObserver);
      expect(playSpy.mock.calls.length).toBeGreaterThan(playCalls);
    } finally {
      globalThis.IntersectionObserver = originalIO;
    }
  });

  it("flips the play-gate via the native `play` event (covers autoplay-attribute wins race)", async () => {
    type IOCallback = ConstructorParameters<typeof IntersectionObserver>[0];
    let ioCallback: IOCallback | null = null;
    const originalIO = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(cb: IOCallback) {
        ioCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    } as unknown as typeof IntersectionObserver;

    try {
      mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);

      render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
      await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

      const videoEl = document.querySelector("video") as HTMLVideoElement;
      const pauseSpy = vi.spyOn(videoEl, "pause").mockImplementation(() => undefined);

      // Flush the clip's mount effects BEFORE dispatching the native `play`.
      // The observer is created in the same passive-effect pass as the
      // `hasPlayedRef` reset (the `[src]` effect); once `ioCallback` is set,
      // that reset has already run. If `play` fired while those effects were
      // still pending, fireEvent's own act() would flush the reset AFTER
      // `handlePlay` opened the gate, clobbering `hasPlayedRef` back to false
      // so the out-of-viewport branch never calls pause(). That interleaving
      // is the intermittent failure this ordering removes.
      await waitFor(() => expect(ioCallback).toBeTruthy());

      fireEvent.play(videoEl);

      act(() => {
        ioCallback!(
          [{ isIntersecting: false, target: videoEl } as unknown as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
      await waitFor(() => expect(pauseSpy).toHaveBeenCalled());
    } finally {
      globalThis.IntersectionObserver = originalIO;
    }
  });

  it("uses scroll-snap and follows the scrolled page", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([
      makeClip({ id: "a", trickName: "TrickA" }),
      makeClip({ id: "b", trickName: "TrickB", playerUid: "p2", playerUsername: "bob" }),
    ]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    const activeSlide = () => screen.getByRole("region", { name: "Clips" }).querySelector("[data-active='true']");
    // Wait for the feed to settle on page 1 (its reset effect included) before
    // scrolling, or a late reset can snap the scroll back (hesher #936 S2).
    await waitFor(() => expect(activeSlide()).toHaveTextContent("TrickA"));

    const region = screen.getByRole("region", { name: "Clips" });
    expect(region.className).toContain("snap-y");
    expect(region.className).toContain("snap-mandatory");
    const articles = screen.getAllByRole("article");
    expect(articles[0]?.className).toContain("snap-start");
    expect(articles[0]?.className).toContain("snap-always");

    // Scroll the live scroller to page 2; re-fired on each retry, the way a
    // real scroll keeps firing while the page settles.
    await waitFor(() => {
      const live = screen.getByRole("region", { name: "Clips" });
      Object.defineProperty(live, "clientHeight", { configurable: true, value: 640 });
      // Accessor with a no-op setter: the feed's reset writes scrollTop = 0.
      Object.defineProperty(live, "scrollTop", { configurable: true, get: () => 640, set: () => {} });
      fireEvent.scroll(live);
      expect(activeSlide()).toHaveTextContent("TrickB");
    });
  });

  it("unloads videos more than one slide away and prefetches the next clip", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([
      storageClip("a", "TrickA"),
      storageClip("b", "TrickB", { playerUid: "p2", playerUsername: "bob" }),
      storageClip("c", "TrickC", { playerUid: "p3", playerUsername: "cara" }),
    ]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("TrickA")).toBeInTheDocument());

    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(3);
    expect(articles[0]?.querySelector("video")).toBeTruthy();
    expect(articles[1]?.querySelector("video")).toBeTruthy();
    expect(articles[2]?.querySelector("video")).toBeNull();

    await waitFor(() => {
      const prefetched = document.querySelector("video[aria-hidden='true']") as HTMLVideoElement | null;
      expect(prefetched?.src).toContain("b.webm");
    });
  });

  it("reports a dispute into the same modal, without a clip id", async () => {
    const user = userEvent.setup();
    mockFetchOpenDisputes.mockResolvedValueOnce([makeDispute({ setVideoUrl: null })]);
    mockFetchDisputeViewerState.mockResolvedValueOnce(new Map([["g1_3", { ownVerdict: null, canVote: false }]]));
    mockFetchClipsFeed.mockResolvedValueOnce([]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /report @bob's attempt/i }));
    const dialog = await screen.findByRole("dialog", { name: "report-modal" });
    expect(dialog).toHaveAttribute("data-dispute", "g1_3");
    expect(dialog).toHaveAttribute("data-clip", "");
    await user.click(screen.getByRole("button", { name: "__close__" }));
    expect(screen.queryByRole("dialog", { name: "report-modal" })).not.toBeInTheDocument();
  });

  it("puts open disputes ahead of clips and stays put after a LAND vote", async () => {
    const user = userEvent.setup();
    mockFetchOpenDisputes.mockResolvedValueOnce([makeDispute({ setVideoUrl: null })]);
    mockFetchDisputeViewerState.mockResolvedValueOnce(new Map([["g1_3", { ownVerdict: null, canVote: true }]]));
    mockCastDisputeVerdict.mockResolvedValueOnce({ land: 3, bail: 1 });
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    const articles = await screen.findAllByRole("article");
    expect(articles[0]).toHaveAccessibleName(/community call on switch heel/i);
    expect(articles[1]).toHaveAccessibleName(/kickflip/i);
    expect(screen.getByText(/Community call: Landed or bailed\?/i)).toBeInTheDocument();
    expect(screen.queryByText("Kickflip")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Land — @bob landed it/i }));

    await waitFor(() => expect(mockCastDisputeVerdict).toHaveBeenCalledWith("me", "g1_3", "land"));
    expect(screen.getByText(/YOUR CALL · LAND/i)).toBeInTheDocument();
    expect(document.querySelector("[data-active='true']")).toHaveAccessibleName(/community call on switch heel/i);
    expect(screen.queryByText("Kickflip")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Land — @bob landed it/i })).not.toBeInTheDocument();
  });

  it("plays the first clip after the dispute error page, not the one N slides ahead", async () => {
    mockFetchOpenDisputes.mockRejectedValueOnce(new Error("unavailable"));
    mockFetchClipsFeed.mockResolvedValueOnce([
      storageClip("a", "TrickA"),
      storageClip("b", "TrickB", { playerUid: "p2", playerUsername: "bob" }),
    ]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    expect(await screen.findByText(/Couldn't load the calls waiting on the community/i)).toBeInTheDocument();
    // The error page is slide 0, so the clip behind it must not be the one playing.
    expect(screen.queryByText("TrickA")).not.toBeInTheDocument();
    expect(screen.queryByText("TrickB")).not.toBeInTheDocument();

    await waitFor(() => {
      const prefetched = document.querySelector("video[aria-hidden='true']") as HTMLVideoElement | null;
      expect(prefetched?.src).toContain("a.webm");
    });

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(await screen.findByText("TrickA")).toBeInTheDocument();
    expect(screen.queryByText("TrickB")).not.toBeInTheDocument();
    await waitFor(() => {
      const prefetched = document.querySelector("video[aria-hidden='true']") as HTMLVideoElement | null;
      expect(prefetched?.src).toContain("b.webm");
    });
  });
});

/* ── Thumbs down ──────────────────────────────────────────────────── */

describe("ClipsFeed — thumbs down", () => {
  it("records a real downvote rather than withdrawing an upvote", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    mockFetchClipVoteState.mockResolvedValueOnce(new Map([["g1_2_set", voteState({ downvoteCount: 5 })]]));
    mockVoteClip.mockResolvedValueOnce(voteState({ downvoteCount: 6, myVote: -1 }));
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    const down = await screen.findByRole("button", { name: /Thumbs down clip by @alice$/i });

    await user.click(down);

    await waitFor(() => expect(mockVoteClip).toHaveBeenCalledWith("me", "g1_2_set", -1));
    expect(mockTrackEvent).toHaveBeenCalledWith("clip_voted", {
      clipId: "g1_2_set",
      fromSort: "top",
      vote: -1,
    });
    await screen.findByRole("button", { name: /Remove your thumbs down on @alice's clip$/i });
  });

  it("leaves the clip in the spotlight — a downvote is a rating, not a pass", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip(), makeClip({ id: "g1_3_set", trickName: "Backside 180" })]);
    mockVoteClip.mockResolvedValueOnce(voteState({ downvoteCount: 1, myVote: -1 }));
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Thumbs down clip by @alice/i }));

    await waitFor(() => expect(mockVoteClip).toHaveBeenCalled());
    expect(screen.getByText("Kickflip")).toBeInTheDocument();
    expect(screen.queryByText("Backside 180")).not.toBeInTheDocument();
  });

  it("tapping your own thumbs down withdraws it", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    mockFetchClipVoteState.mockResolvedValueOnce(new Map([["g1_2_set", voteState({ downvoteCount: 5, myVote: -1 })]]));
    mockRemoveClipVote.mockResolvedValueOnce(voteState({ downvoteCount: 4, myVote: null }));
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Remove your thumbs down on @alice's clip$/i }));

    await waitFor(() => expect(mockRemoveClipVote).toHaveBeenCalledWith("me", "g1_2_set"));
    await screen.findByRole("button", { name: /Thumbs down clip by @alice$/i });
  });

  it("rolls the count back when the downvote write fails", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    mockFetchClipVoteState.mockResolvedValueOnce(new Map([["g1_2_set", voteState({ downvoteCount: 5 })]]));
    mockVoteClip.mockRejectedValueOnce(new Error("network"));
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Thumbs down clip by @alice$/i }));

    await waitFor(() => expect(mockVoteClip).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: /Thumbs down clip by @alice$/i })).toBeEnabled());
    expect(mockTrackEvent).not.toHaveBeenCalledWith("clip_voted", expect.anything());
  });

  it("offers a reload once every clip in the batch has been reported away", async () => {
    await reportAwayThenLoadMore([makeClip()]);
    expect(mockFetchClipsFeed).toHaveBeenLastCalledWith(null, 12, "top");
  });

  it("keeps both thumbs visible but disabled on the viewer's own clip", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip({ playerUid: "me", playerUsername: "viewer" })]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(screen.getByRole("group", { name: /rate this clip/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Thumbs up .* you can't vote on your own clip/i })).toBeDisabled();
  });
});

/* ── User clips, comments, upload entry point ─────────────────────── */

describe("ClipsFeed — user clips and comments", () => {
  it("badges a matcher's clip as MATCH", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip({ role: "match" })]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(screen.getByText("MATCH")).toBeInTheDocument();
  });

  it("badges a user-posted clip as CLIP rather than borrowing SET/MATCH", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([
      makeClip({ id: "u1", source: "user", gameId: null, turnNumber: null, role: null, trickName: "Nollie flip" }),
    ]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Nollie flip")).toBeInTheDocument());
    expect(screen.getByText("CLIP")).toBeInTheDocument();
    expect(screen.queryByText("SET")).not.toBeInTheDocument();
  });

  it("opens the upload modal from the POST button in the header", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValue([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /post a clip to the feed/i }));

    expect(await screen.findByRole("dialog", { name: /upload-modal/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "__posted__" }));
    expect(screen.queryByRole("dialog", { name: /upload-modal/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /post a clip to the feed/i }));
    await user.click(await screen.findByRole("button", { name: "__close_upload__" }));
    expect(screen.queryByRole("dialog", { name: /upload-modal/i })).not.toBeInTheDocument();
  });

  /** Render the feed, wait for its one clip, and open the comment sheet. */
  async function renderAndOpenComments(user: ReturnType<typeof userEvent.setup>) {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /comments on @alice's clip/i }));
    expect(await screen.findByRole("dialog", { name: /comments-sheet/i })).toBeInTheDocument();
  }

  it("opens the comment sheet from the clip's COMMENTS action and closes it", async () => {
    const user = userEvent.setup();
    await renderAndOpenComments(user);
    await user.click(screen.getByRole("button", { name: "__close_comments__" }));
    expect(screen.queryByRole("dialog", { name: /comments-sheet/i })).not.toBeInTheDocument();
  });

  it("opens the report modal (and closes the comment sheet) from the REPORT action inside comments", async () => {
    const user = userEvent.setup();
    await renderAndOpenComments(user);

    await user.click(screen.getByRole("button", { name: "__report_from_comments__" }));

    expect(await screen.findByRole("dialog", { name: /report-modal/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /comments-sheet/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "__close__" }));
    expect(screen.queryByRole("dialog", { name: /report-modal/i })).not.toBeInTheDocument();
  });

  it("opens a comment author's profile and closes the sheet", async () => {
    const user = userEvent.setup();
    const onViewPlayer = vi.fn();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={onViewPlayer} onChallengeUser={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /comments on @alice's clip/i }));
    await user.click(await screen.findByRole("button", { name: "__view_author__" }));
    expect(onViewPlayer).toHaveBeenCalledWith("troll");
    expect(screen.queryByRole("dialog", { name: /comments-sheet/i })).not.toBeInTheDocument();
  });

  it("reports a single comment against its author and closes the sheet", async () => {
    const user = userEvent.setup();
    await renderAndOpenComments(user);

    await user.click(screen.getByRole("button", { name: "__report_comment__" }));

    const modal = await screen.findByRole("dialog", { name: /report-modal/i });
    expect(modal).toHaveAttribute("data-reported", "troll");
    expect(modal).toHaveAttribute("data-comment", "cm1:rude");
    expect(modal.getAttribute("data-clip")).not.toBe("");
    expect(screen.queryByRole("dialog", { name: /comments-sheet/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "__submit__" }));
    expect(screen.queryByRole("dialog", { name: /report-modal/i })).not.toBeInTheDocument();
  });

  it("keeps the WTT queue idle and hides the mode bar while the flags are off", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Name It" })).not.toBeInTheDocument();
    expect(mockUseWttFeed).toHaveBeenLastCalledWith("me", false);
  });

  it("switches to Name It, loads WTT, and returns to Scroll from the done screen", async () => {
    flags.feedModes = true;
    flags.wtt = true;
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    await user.click(await screen.findByRole("button", { name: "Name It" }));
    expect(mockUseWttFeed).toHaveBeenLastCalledWith("me", true);
    await user.click(await screen.findByRole("button", { name: /back to scroll/i }));
    expect(screen.getByRole("button", { name: "Scroll" })).toHaveAttribute("aria-pressed", "true");
    expect(mockUseWttFeed).toHaveBeenLastCalledWith("me", false);
  });
});

/* ── Next-slide prefetch across disputes, and the Name It streak flag ── */

describe("ClipsFeed dispute prefetch and streak flag", () => {
  const prefetchedSrc = () => (document.querySelector("video[aria-hidden='true']") as HTMLVideoElement | null)?.src;

  it("prefetches the next dispute's attempt, and nothing when that attempt is not a storage URL", async () => {
    mockFetchOpenDisputes.mockResolvedValueOnce([
      makeDispute({ id: "d1" }),
      makeDispute({ id: "d2", matchVideoUrl: "https://firebasestorage.googleapis.com/v0/b/x/o/d2.webm?alt=media" }),
      makeDispute({ id: "d3", matchVideoUrl: "https://evil.example/d3.webm" }),
    ]);
    mockFetchClipsFeed.mockResolvedValueOnce([]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    await waitFor(() => expect(prefetchedSrc()).toContain("d2.webm"));
    fireEvent.keyDown(window, { key: "ArrowDown" });
    await waitFor(() => expect(prefetchedSrc()).toBeUndefined());
  });

  it("loads Name It on tap and never badges the open Name It tab, even with a streak due", async () => {
    flags.feedModes = true;
    flags.wtt = true;
    mockUseWttFeed.mockReturnValue({
      currentItem: null,
      dailyCount: 0,
      dailyLimit: 20,
      loading: false,
      reliability: { streakDays: 0 },
      submitAnswer: vi.fn(),
      skipCurrent: vi.fn(),
    });
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    const nameIt = await screen.findByRole("button", { name: "Name It" });
    await user.click(nameIt);
    expect(mockUseWttFeed).toHaveBeenLastCalledWith("me", true);
    expect(nameIt).toHaveAttribute("aria-pressed", "true");
    // The badge marks other tabs; the open Name It tab never badges itself.
    expect(nameIt.querySelector("[data-mode-badge]")).toBeNull();
  });
});

describe("ClipsFeed — block list", () => {
  it("holds the loading skeleton until the block list has loaded", async () => {
    mockSubscribeToBlockedUsers.mockImplementation(() => () => {});
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    await waitFor(() => expect(mockFetchClipsFeed).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByRole("status", { name: /loading clips/i })).toBeInTheDocument();
    expect(screen.queryByText("Kickflip")).not.toBeInTheDocument();
  });

  it("shows a failed page's error at once, even while the block list is still pending", async () => {
    // The error drops the skeleton, so the banner must not wait for the list:
    // that frame would be blank (hesher #936 r2 N-a).
    mockSubscribeToBlockedUsers.mockImplementation(() => () => {});
    mockFetchClipsFeed.mockRejectedValueOnce(new Error("boom"));
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't load the feed/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /loading clips/i })).not.toBeInTheDocument();
  });

  it("never shows a blocked player's clip", async () => {
    mockSubscribeToBlockedUsers.mockImplementation(answerBlockList(["p1"]));
    mockFetchClipsFeed.mockResolvedValueOnce([
      storageClip("c1", "Kickflip"),
      storageClip("c2", "Tre Flip", { playerUid: "p2", playerUsername: "bob" }),
    ]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    await screen.findByText("Tre Flip");
    expect(screen.queryByText("Kickflip")).not.toBeInTheDocument();
  });

  it("hands out no clips while the block list is unknown, even once it has failed", async () => {
    // A failed list reads as empty; the controller must not treat that as
    // "nobody blocked" and pass the unfiltered page on.
    mockSubscribeToBlockedUsers.mockImplementation(failBlockList);
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    const { result } = renderHook(() => useClipsFeedController(profile.uid));

    await waitFor(() => expect(result.current.error).toBe(BLOCK_LIST_ERROR));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visibleClips).toEqual([]);
    expect(result.current.currentClip).toBeUndefined();
  });

  it("keeps the feed loading while the block list is still pending, even once the page is in", async () => {
    mockSubscribeToBlockedUsers.mockImplementation(() => () => {});
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    const { result } = renderHook(() => useClipsFeedController(profile.uid));

    await waitFor(() => expect(mockFetchClipsFeed).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.visibleClips).toEqual([]);
  });

  it("shows the block-list alert at once, even while the first page is still loading", async () => {
    mockSubscribeToBlockedUsers.mockImplementation(failBlockList);
    mockFetchClipsFeed.mockReturnValueOnce(deferred<ClipDoc[]>().promise);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    await waitFor(() => expect(mockFetchClipsFeed).toHaveBeenCalled());
    // Not a blank frame: the failure is known, so its banner is up.
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't load your blocked players/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("pauses the feed behind one Try again when the block list fails, then recovers", async () => {
    const user = userEvent.setup();
    // Both lanes subscribe on mount; both first attempts fail.
    mockSubscribeToBlockedUsers.mockImplementationOnce(failBlockList).mockImplementationOnce(failBlockList);
    mockFetchClipsFeed.mockResolvedValue([makeClip()]);
    mockFetchOpenDisputes.mockResolvedValueOnce([makeDispute()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    // One banner: the dispute lane does not repeat the error as a slide, and
    // the empty state never claims the feed is empty.
    expect(await screen.findAllByText(/Couldn't load your blocked players/i)).toHaveLength(1);
    expect(screen.getByText("code: block-list/unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Kickflip")).not.toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /community call/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Feed's empty/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));

    await screen.findByText("Kickflip");
    expect(screen.queryByText(/Couldn't load your blocked players/i)).not.toBeInTheDocument();
    // Try again re-subscribed both lanes, not just the clips lane.
    expect(mockSubscribeToBlockedUsers).toHaveBeenCalledTimes(4);
  });
});

describe("ClipsFeed — empty state", () => {
  it("asks the player to fill the feed and opens the upload sheet from its CTA", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Feed's empty. Go fill it." })).toBeInTheDocument();
    expect(screen.getByText("Film a line, post it, and it shows up here for the crew.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "upload-modal" })).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Post a clip" }).className).toContain("from-brand-orange");
    await user.click(screen.getByRole("button", { name: "Post a clip" }));
    expect(await screen.findByRole("dialog", { name: "upload-modal" })).toBeInTheDocument();
  });
});
