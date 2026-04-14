import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClipsFeed } from "../ClipsFeed";
import type { UserProfile } from "../../services/users";
import type { ClipDoc } from "../../services/clips";

const { mockFetchClipsFeed, mockFetchClipUpvoteState, mockUpvoteClip, MockAlreadyUpvotedError } = vi.hoisted(() => {
  class MockAlreadyUpvotedError extends Error {
    constructor(public readonly clipId: string) {
      super(`already_upvoted:${clipId}`);
      this.name = "AlreadyUpvotedError";
    }
  }
  return {
    mockFetchClipsFeed: vi.fn(),
    mockFetchClipUpvoteState: vi.fn(),
    mockUpvoteClip: vi.fn(),
    MockAlreadyUpvotedError,
  };
});

vi.mock("../../services/clips", () => ({
  fetchClipsFeed: (...args: unknown[]) => mockFetchClipsFeed(...args),
  fetchClipUpvoteState: (...args: unknown[]) => mockFetchClipUpvoteState(...args),
  upvoteClip: (...args: unknown[]) => mockUpvoteClip(...args),
  AlreadyUpvotedError: MockAlreadyUpvotedError,
}));

vi.mock("../../hooks/useBlockedUsers", () => ({
  useBlockedUsers: () => new Set<string>(),
}));

vi.mock("../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// ReportModal depends on services we don't need to exercise here.
vi.mock("../ReportModal", () => ({
  ReportModal: ({ onClose, onSubmitted }: { onClose: () => void; onSubmitted: () => void }) => (
    <div role="dialog" aria-label="report-modal">
      <button onClick={onSubmitted}>__submit__</button>
      <button onClick={onClose}>__close__</button>
    </div>
  ),
}));

const profile: UserProfile = {
  uid: "me",
  username: "viewer",
  stance: "regular",
  emailVerified: true,
  createdAt: null,
};

function makeClip(overrides: Partial<ClipDoc> = {}): ClipDoc {
  return {
    id: "g1_2_set",
    gameId: "g1",
    turnNumber: 2,
    role: "set",
    playerUid: "p1",
    playerUsername: "alice",
    trickName: "Kickflip",
    videoUrl: "https://firebasestorage.googleapis.com/v0/b/x/o/games%2Fg1%2Fturn-2%2Fset.webm?alt=media",
    spotId: null,
    createdAt: { toMillis: () => Date.now() - 3 * 60_000 } as ClipDoc["createdAt"],
    moderationStatus: "active",
    ...overrides,
  };
}

/** Manually-resolvable promise — lets us interleave hydration vs click
 *  timing deterministically (Promise order can't be guaranteed otherwise). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: upvote hydration succeeds with no entries (UI defaults each
  // clip to {0,false}). Individual tests override with a populated Map.
  mockFetchClipUpvoteState.mockResolvedValue(new Map());
});

describe("ClipsFeed", () => {
  it("shows the loading state on first mount", () => {
    mockFetchClipsFeed.mockImplementation(() => new Promise(() => {}));
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    expect(screen.getByRole("status", { name: /loading clips/i })).toBeInTheDocument();
  });

  it("renders the empty state when the feed comes back with no clips", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce({ clips: [], cursor: null });
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/No clips yet\./i)).toBeInTheDocument());
  });

  it("renders clips with player + trick + role + timestamp", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce({ clips: [makeClip()], cursor: null });
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("SET")).toBeInTheDocument();
    expect(screen.getByText(/3m ago/)).toBeInTheDocument();
  });

  it("fires onViewPlayer when the username is tapped", async () => {
    const user = userEvent.setup();
    const onViewPlayer = vi.fn();
    mockFetchClipsFeed.mockResolvedValueOnce({ clips: [makeClip()], cursor: null });
    render(<ClipsFeed profile={profile} onViewPlayer={onViewPlayer} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    await user.click(screen.getByText("@alice"));
    expect(onViewPlayer).toHaveBeenCalledWith("p1");
  });

  it("fires onChallengeUser when the challenge CTA is tapped", async () => {
    const user = userEvent.setup();
    const onChallengeUser = vi.fn();
    mockFetchClipsFeed.mockResolvedValueOnce({ clips: [makeClip()], cursor: null });
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={onChallengeUser} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /challenge/i }));
    expect(onChallengeUser).toHaveBeenCalledWith("alice");
  });

  it("hides the challenge CTA on the viewer's own clip", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce({
      clips: [makeClip({ playerUid: profile.uid, playerUsername: profile.username })],
      cursor: null,
    });
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /challenge/i })).not.toBeInTheDocument();
  });

  it("opens the report modal and optimistically hides the reported clip", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce({ clips: [makeClip()], cursor: null });
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /report clip by @alice/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: /report-modal/i })).toBeInTheDocument());

    await user.click(screen.getByText("__submit__"));
    await waitFor(() => expect(screen.queryByText("Kickflip")).not.toBeInTheDocument());
  });

  it("paginates via the Load more button when a cursor is returned", async () => {
    const user = userEvent.setup();
    const firstCursor = { createdAt: { toMillis: () => 1 } as ClipDoc["createdAt"], id: "g1_2_set" };
    mockFetchClipsFeed
      .mockResolvedValueOnce({
        clips: Array.from({ length: 12 }, (_, i) => makeClip({ id: `g1_${i}_set`, trickName: `TrickA${i}` })),
        cursor: firstCursor,
      })
      .mockResolvedValueOnce({
        clips: [makeClip({ id: "g2_1_set", trickName: "TrickB0" })],
        cursor: null,
      });

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("TrickA0")).toBeInTheDocument());
    expect(screen.queryByText("TrickB0")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(screen.getByText("TrickB0")).toBeInTheDocument());
    expect(screen.getByText(/You're all caught up/i)).toBeInTheDocument();
    expect(mockFetchClipsFeed).toHaveBeenLastCalledWith(firstCursor, 12);
  });

  it("renders an error state with retry when the initial fetch fails", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ clips: [makeClip()], cursor: null });

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Couldn't load the feed/i)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
  });

  it("uses service-side error copy when the failure is permission-denied (not a network issue)", async () => {
    mockFetchClipsFeed.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/Feed temporarily unavailable — please try again in a moment\./i)).toBeInTheDocument(),
    );
    // Generic "check your connection" copy must not appear when the cause
    // is server-side, otherwise the user wastes time toggling Wi-Fi.
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

  it("renders an upvote button next to challenge with the hydrated count", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce({ clips: [makeClip()], cursor: null });
    mockFetchClipUpvoteState.mockResolvedValueOnce(new Map([["g1_2_set", { count: 4, alreadyUpvoted: false }]]));

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Upvote clip by @alice · current count 4/i })).toBeInTheDocument(),
    );
  });

  it("does not render an upvote button on the viewer's own clip (no self-upvote)", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce({
      clips: [makeClip({ playerUid: profile.uid, playerUsername: profile.username })],
      cursor: null,
    });
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Upvote clip/i })).not.toBeInTheDocument();
  });

  it("optimistically increments and locks the upvote button on tap", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce({ clips: [makeClip()], cursor: null });
    mockFetchClipUpvoteState.mockResolvedValueOnce(new Map([["g1_2_set", { count: 2, alreadyUpvoted: false }]]));
    mockUpvoteClip.mockResolvedValueOnce(3);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    const upvoteBtn = await screen.findByRole("button", { name: /Upvote clip by @alice · current count 2/i });

    await user.click(upvoteBtn);

    expect(mockUpvoteClip).toHaveBeenCalledWith(profile.uid, "g1_2_set");
    // After the server confirms (returns 3), the button stays in the
    // "Upvoted · 3" state and is now disabled (no double-vote).
    await waitFor(() => expect(screen.getByRole("button", { name: /Upvoted · 3/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Upvoted · 3/i })).toBeDisabled();
  });

  it("rolls back the optimistic upvote on a non-AlreadyUpvotedError failure", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce({ clips: [makeClip()], cursor: null });
    mockFetchClipUpvoteState.mockResolvedValueOnce(new Map([["g1_2_set", { count: 2, alreadyUpvoted: false }]]));
    mockUpvoteClip.mockRejectedValueOnce(new Error("network down"));

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    const upvoteBtn = await screen.findByRole("button", { name: /Upvote clip by @alice · current count 2/i });

    await user.click(upvoteBtn);

    // Count returns to 2 and the button is re-enabled so the user can retry.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Upvote clip by @alice · current count 2/i })).toBeEnabled(),
    );
  });

  it("keeps the optimistic upvoted state when the server already had our vote", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce({ clips: [makeClip()], cursor: null });
    mockFetchClipUpvoteState.mockResolvedValueOnce(new Map([["g1_2_set", { count: 2, alreadyUpvoted: false }]]));
    mockUpvoteClip.mockRejectedValueOnce(new MockAlreadyUpvotedError("g1_2_set"));

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    const upvoteBtn = await screen.findByRole("button", { name: /Upvote clip by @alice · current count 2/i });

    await user.click(upvoteBtn);

    // Stays at the optimistic count (3) because server says we did upvote.
    await waitFor(() => expect(screen.getByRole("button", { name: /Upvoted · 3/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Upvoted · 3/i })).toBeDisabled();
  });

  it("renders the top clip with autoplay/muted attributes and a tap-to-unmute affordance", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce({
      clips: [makeClip({ id: "top", trickName: "TopTrick" }), makeClip({ id: "next", trickName: "NextTrick" })],
      cursor: null,
    });

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("TopTrick")).toBeInTheDocument());

    // Top-of-feed clip wraps its <video> in an unmute button.
    const unmuteBtn = screen.getByRole("button", { name: /Unmute clip/i });
    expect(unmuteBtn).toBeInTheDocument();
    expect(screen.getByText(/MUTED · TAP/i)).toBeInTheDocument();
  });

  it("shows controls (no autoplay button) on non-top clips", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce({
      clips: [makeClip({ id: "top", trickName: "TopTrick" }), makeClip({ id: "next", trickName: "NextTrick" })],
      cursor: null,
    });

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("NextTrick")).toBeInTheDocument());

    // Only one Unmute button exists (for the top clip), not one per row.
    expect(screen.getAllByRole("button", { name: /Unmute clip/i })).toHaveLength(1);
  });

  it("toggles mute on the top clip when the unmute affordance is tapped", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce({ clips: [makeClip()], cursor: null });

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    const unmuteBtn = screen.getByRole("button", { name: /Unmute clip/i });
    await user.click(unmuteBtn);

    // Button label flips to "Mute clip" (now playing with audio).
    await waitFor(() => expect(screen.getByRole("button", { name: /Mute clip/i })).toBeInTheDocument());
    // The MUTED chip is gone.
    expect(screen.queryByText(/MUTED · TAP/i)).not.toBeInTheDocument();
  });

  it("does not fetch upvote state for the viewer's own clips (wasted read)", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce({
      clips: [
        makeClip({ id: "own", playerUid: profile.uid, playerUsername: profile.username }),
        makeClip({ id: "other", playerUid: "p2", playerUsername: "bob" }),
      ],
      cursor: null,
    });

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(mockFetchClipUpvoteState).toHaveBeenCalled());

    // Only the non-own clip's id should be passed to the batch fetch.
    expect(mockFetchClipUpvoteState).toHaveBeenCalledWith(profile.uid, ["other"]);
  });

  it("doesn't run upvote hydration at all when every visible clip is the viewer's own", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce({
      clips: [makeClip({ playerUid: profile.uid, playerUsername: profile.username })],
      cursor: null,
    });

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    expect(mockFetchClipUpvoteState).not.toHaveBeenCalled();
  });

  it("preserves an optimistic upvote when a slow hydration resolves after the user's tap (race guard)", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce({ clips: [makeClip()], cursor: null });
    // Hydration lags behind: the resolver fires only after the user taps.
    const hydration = deferred<Map<string, { count: number; alreadyUpvoted: boolean }>>();
    mockFetchClipUpvoteState.mockReturnValueOnce(hydration.promise);
    mockUpvoteClip.mockResolvedValueOnce(6);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    // Render starts with the pre-hydration default (count=0).
    const upvoteBtn = await screen.findByRole("button", { name: /Upvote clip by @alice · current count 0/i });
    await user.click(upvoteBtn);
    // Server confirms with the true count.
    await waitFor(() => expect(screen.getByRole("button", { name: /Upvoted · 6/i })).toBeInTheDocument());

    // Hydration (fired before the click) finally resolves with a stale
    // pre-vote snapshot. Race guard must keep the user's {6, upvoted}
    // state instead of clobbering it back to the hydrated value.
    hydration.resolve(new Map([["g1_2_set", { count: 4, alreadyUpvoted: false }]]));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByRole("button", { name: /Upvoted · 6/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upvote clip by @alice · current count 4/i })).not.toBeInTheDocument();
  });

  it("remounts the top-clip autoplay with a fresh muted state when the top clip identity changes", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce({
      clips: [
        makeClip({ id: "top", trickName: "TopTrick", playerUid: "p1", playerUsername: "alice" }),
        makeClip({ id: "next", trickName: "NextTrick", playerUid: "p2", playerUsername: "bob" }),
      ],
      cursor: null,
    });

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("TopTrick")).toBeInTheDocument());

    // User unmutes the top clip.
    await user.click(screen.getByRole("button", { name: /Unmute clip/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Mute clip/i })).toBeInTheDocument());

    // Report the top clip — its optimistic hide drops it from the feed,
    // promoting "next" (bob) to the top spot.
    await user.click(screen.getByRole("button", { name: /report clip by @alice/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: /report-modal/i })).toBeInTheDocument());
    await user.click(screen.getByText("__submit__"));

    // After the hide, "NextTrick" is now the top. Thanks to the
    // `key={clip.id}` on TopClipVideo, React remounts it — fresh muted
    // state instead of inheriting the previous clip's unmuted one.
    await waitFor(() => expect(screen.queryByText("TopTrick")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("NextTrick")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Unmute clip" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mute clip" })).not.toBeInTheDocument();
  });

  it("pauses the top clip's video when it scrolls out of the viewport and resumes on re-entry", async () => {
    // Capture the IntersectionObserver callback so we can drive it from
    // the test — jsdom has no real IO events. The rest of the observer
    // is a minimal stub.
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
      mockFetchClipsFeed.mockResolvedValueOnce({ clips: [makeClip()], cursor: null });

      render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
      await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

      // Grab the <video> element and spy on its play/pause.
      const videoEl = document.querySelector("video") as HTMLVideoElement;
      expect(videoEl).toBeTruthy();
      const playSpy = vi.spyOn(videoEl, "play").mockResolvedValue();
      const pauseSpy = vi.spyOn(videoEl, "pause").mockImplementation(() => undefined);

      // Regression guard: an out-of-viewport callback BEFORE any successful
      // play() must NOT call pause(). On mobile Safari, an early pause()
      // revokes the muted-autoplay grant so subsequent play() calls
      // silently fail — that was the "feed loads but no clips play" bug.
      expect(ioCallback).toBeTruthy();
      const outOfView = { isIntersecting: false, target: videoEl } as unknown as IntersectionObserverEntry;
      ioCallback!([outOfView], {} as IntersectionObserver);
      expect(pauseSpy).not.toHaveBeenCalled();

      // Scroll into view → play() is invoked.
      const intersecting = { isIntersecting: true, target: videoEl } as unknown as IntersectionObserverEntry;
      ioCallback!([intersecting], {} as IntersectionObserver);
      expect(playSpy).toHaveBeenCalled();

      // Wait for the play() promise to resolve so hasPlayedRef flips true.
      await Promise.resolve();
      await Promise.resolve();

      // Now scroll back out → pause() fires because the video has played.
      ioCallback!([outOfView], {} as IntersectionObserver);
      expect(pauseSpy).toHaveBeenCalled();

      // Scroll back into view → play() is invoked again.
      const playCalls = playSpy.mock.calls.length;
      ioCallback!([intersecting], {} as IntersectionObserver);
      expect(playSpy.mock.calls.length).toBeGreaterThan(playCalls);
    } finally {
      globalThis.IntersectionObserver = originalIO;
    }
  });
});
