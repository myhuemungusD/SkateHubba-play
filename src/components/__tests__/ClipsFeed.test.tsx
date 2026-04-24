import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClipsFeed } from "../ClipsFeed";
import type { UserProfile } from "../../services/users";
import type { ClipDoc } from "../../services/clips";

const { mockFetchRandomLandedClips, mockFetchClipUpvoteState, mockUpvoteClip, MockAlreadyUpvotedError } = vi.hoisted(
  () => {
    class MockAlreadyUpvotedError extends Error {
      constructor(public readonly clipId: string) {
        super(`already_upvoted:${clipId}`);
        this.name = "AlreadyUpvotedError";
      }
    }
    return {
      mockFetchRandomLandedClips: vi.fn(),
      mockFetchClipUpvoteState: vi.fn(),
      mockUpvoteClip: vi.fn(),
      MockAlreadyUpvotedError,
    };
  },
);

vi.mock("../../services/clips", () => ({
  fetchRandomLandedClips: (...args: unknown[]) => mockFetchRandomLandedClips(...args),
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

/** Manually-resolvable promise for deterministic interleaving. */
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
  mockFetchClipUpvoteState.mockResolvedValue(new Map());
});

describe("ClipsFeed", () => {
  it("shows the loading state on first mount", () => {
    mockFetchRandomLandedClips.mockImplementation(() => new Promise(() => {}));
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    expect(screen.getByRole("status", { name: /loading clips/i })).toBeInTheDocument();
  });

  it("renders the empty state when the random pool comes back empty", async () => {
    mockFetchRandomLandedClips.mockResolvedValueOnce([]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/No clips yet\./i)).toBeInTheDocument());
  });

  it("requests a random pool (sample 12, pool 60) on mount", async () => {
    mockFetchRandomLandedClips.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(mockFetchRandomLandedClips).toHaveBeenCalledWith(12, 60);
  });

  it("renders the spotlight clip with player + trick + role + timestamp", async () => {
    mockFetchRandomLandedClips.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("SET")).toBeInTheDocument();
    expect(screen.getByText(/3m ago/)).toBeInTheDocument();
  });

  it("fires onViewPlayer when the username is tapped", async () => {
    const user = userEvent.setup();
    const onViewPlayer = vi.fn();
    mockFetchRandomLandedClips.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={onViewPlayer} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    await user.click(screen.getByText("@alice"));
    expect(onViewPlayer).toHaveBeenCalledWith("p1");
  });

  it("fires onChallengeUser when the challenge CTA is tapped", async () => {
    const user = userEvent.setup();
    const onChallengeUser = vi.fn();
    mockFetchRandomLandedClips.mockResolvedValueOnce([makeClip()]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={onChallengeUser} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /challenge/i }));
    expect(onChallengeUser).toHaveBeenCalledWith("alice");
  });

  it("hides the challenge CTA on the viewer's own clip", async () => {
    mockFetchRandomLandedClips.mockResolvedValueOnce([
      makeClip({ playerUid: profile.uid, playerUsername: profile.username }),
    ]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /challenge/i })).not.toBeInTheDocument();
  });

  it("opens the report modal and skips the reported clip", async () => {
    const user = userEvent.setup();
    mockFetchRandomLandedClips.mockResolvedValueOnce([
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
    mockFetchRandomLandedClips.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([makeClip()]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Couldn't load the feed/i)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
  });

  it("uses service-side error copy when the failure is permission-denied", async () => {
    mockFetchRandomLandedClips.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/Feed temporarily unavailable — please try again in a moment\./i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Check your connection/i)).not.toBeInTheDocument();
  });

  it("uses service-side error copy for failed-precondition (missing index)", async () => {
    mockFetchRandomLandedClips.mockRejectedValueOnce(
      Object.assign(new Error("index missing"), { code: "failed-precondition" }),
    );
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/Feed temporarily unavailable — please try again in a moment\./i)).toBeInTheDocument(),
    );
  });

  it("renders an upvote button next to challenge with the hydrated count", async () => {
    mockFetchRandomLandedClips.mockResolvedValueOnce([makeClip()]);
    mockFetchClipUpvoteState.mockResolvedValueOnce(new Map([["g1_2_set", { count: 4, alreadyUpvoted: false }]]));

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Upvote clip by @alice · current count 4/i })).toBeInTheDocument(),
    );
  });

  it("does not render an upvote button on the viewer's own clip (no self-upvote)", async () => {
    mockFetchRandomLandedClips.mockResolvedValueOnce([
      makeClip({ playerUid: profile.uid, playerUsername: profile.username }),
    ]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Upvote clip/i })).not.toBeInTheDocument();
  });

  it("optimistically increments and locks the upvote button on tap", async () => {
    const user = userEvent.setup();
    mockFetchRandomLandedClips.mockResolvedValueOnce([makeClip()]);
    mockFetchClipUpvoteState.mockResolvedValueOnce(new Map([["g1_2_set", { count: 2, alreadyUpvoted: false }]]));
    mockUpvoteClip.mockResolvedValueOnce(3);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    const upvoteBtn = await screen.findByRole("button", { name: /Upvote clip by @alice · current count 2/i });

    await user.click(upvoteBtn);

    expect(mockUpvoteClip).toHaveBeenCalledWith(profile.uid, "g1_2_set");
    await waitFor(() => expect(screen.getByRole("button", { name: /Upvoted · 3/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Upvoted · 3/i })).toBeDisabled();
  });

  it("rolls back the optimistic upvote on a non-AlreadyUpvotedError failure", async () => {
    const user = userEvent.setup();
    mockFetchRandomLandedClips.mockResolvedValueOnce([makeClip()]);
    mockFetchClipUpvoteState.mockResolvedValueOnce(new Map([["g1_2_set", { count: 2, alreadyUpvoted: false }]]));
    mockUpvoteClip.mockRejectedValueOnce(new Error("network down"));

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    const upvoteBtn = await screen.findByRole("button", { name: /Upvote clip by @alice · current count 2/i });

    await user.click(upvoteBtn);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Upvote clip by @alice · current count 2/i })).toBeEnabled(),
    );
  });

  it("keeps the optimistic upvoted state when the server already had our vote", async () => {
    const user = userEvent.setup();
    mockFetchRandomLandedClips.mockResolvedValueOnce([makeClip()]);
    mockFetchClipUpvoteState.mockResolvedValueOnce(new Map([["g1_2_set", { count: 2, alreadyUpvoted: false }]]));
    mockUpvoteClip.mockRejectedValueOnce(new MockAlreadyUpvotedError("g1_2_set"));

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    const upvoteBtn = await screen.findByRole("button", { name: /Upvote clip by @alice · current count 2/i });

    await user.click(upvoteBtn);

    await waitFor(() => expect(screen.getByRole("button", { name: /Upvoted · 3/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Upvoted · 3/i })).toBeDisabled();
  });

  it("renders the spotlight video with autoplay/muted attributes and a tap-to-unmute affordance", async () => {
    mockFetchRandomLandedClips.mockResolvedValueOnce([makeClip()]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /Unmute clip/i })).toBeInTheDocument();
    expect(screen.getByText(/MUTED · TAP/i)).toBeInTheDocument();

    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    // Spec: clip plays once — must not loop, must not auto-advance.
    expect(video.loop).toBe(false);
  });

  it("toggles mute on the spotlight clip when the unmute affordance is tapped", async () => {
    const user = userEvent.setup();
    mockFetchRandomLandedClips.mockResolvedValueOnce([makeClip()]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    const unmuteBtn = screen.getByRole("button", { name: /Unmute clip/i });
    await user.click(unmuteBtn);

    await waitFor(() => expect(screen.getByRole("button", { name: /Mute clip/i })).toBeInTheDocument());
    expect(screen.queryByText(/MUTED · TAP/i)).not.toBeInTheDocument();
  });

  it("does not fetch upvote state for the viewer's own clips (wasted read)", async () => {
    mockFetchRandomLandedClips.mockResolvedValueOnce([
      makeClip({ id: "own", playerUid: profile.uid, playerUsername: profile.username }),
      makeClip({ id: "other", playerUid: "p2", playerUsername: "bob" }),
    ]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(mockFetchClipUpvoteState).toHaveBeenCalled());

    expect(mockFetchClipUpvoteState).toHaveBeenCalledWith(profile.uid, ["other"]);
  });

  it("doesn't run upvote hydration at all when every visible clip is the viewer's own", async () => {
    mockFetchRandomLandedClips.mockResolvedValueOnce([
      makeClip({ playerUid: profile.uid, playerUsername: profile.username }),
    ]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    expect(mockFetchClipUpvoteState).not.toHaveBeenCalled();
  });

  it("preserves an optimistic upvote when a slow hydration resolves after the user's tap (race guard)", async () => {
    const user = userEvent.setup();
    mockFetchRandomLandedClips.mockResolvedValueOnce([makeClip()]);
    const hydration = deferred<Map<string, { count: number; alreadyUpvoted: boolean }>>();
    mockFetchClipUpvoteState.mockReturnValueOnce(hydration.promise);
    mockUpvoteClip.mockResolvedValueOnce(6);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    const upvoteBtn = await screen.findByRole("button", { name: /Upvote clip by @alice · current count 0/i });
    await user.click(upvoteBtn);
    await waitFor(() => expect(screen.getByRole("button", { name: /Upvoted · 6/i })).toBeInTheDocument());

    hydration.resolve(new Map([["g1_2_set", { count: 4, alreadyUpvoted: false }]]));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByRole("button", { name: /Upvoted · 6/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upvote clip by @alice · current count 4/i })).not.toBeInTheDocument();
  });

  it("shows a Replay + Next Trick overlay when the spotlight clip ends", async () => {
    mockFetchRandomLandedClips.mockResolvedValueOnce([
      makeClip({ id: "a", trickName: "TrickA" }),
      makeClip({ id: "b", trickName: "TrickB", playerUid: "p2", playerUsername: "bob" }),
    ]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("TrickA")).toBeInTheDocument());

    // Overlay must NOT exist before the clip ends.
    expect(screen.queryByRole("button", { name: /Replay clip/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Next trick/i })).not.toBeInTheDocument();

    fireEvent.ended(document.querySelector("video") as HTMLVideoElement);

    await waitFor(() => expect(screen.getByRole("button", { name: /Replay clip/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Next trick/i })).toBeInTheDocument();
    // The mute button is hidden so the overlay can take taps.
    expect(screen.queryByRole("button", { name: /Unmute clip/i })).not.toBeInTheDocument();
  });

  it("REPLAY restarts the same clip from the beginning", async () => {
    const user = userEvent.setup();
    mockFetchRandomLandedClips.mockResolvedValueOnce([makeClip({ id: "only", trickName: "OnlyTrick" })]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("OnlyTrick")).toBeInTheDocument());

    const video = document.querySelector("video") as HTMLVideoElement;
    const playSpy = vi.spyOn(video, "play").mockResolvedValue();

    fireEvent.ended(video);
    await waitFor(() => expect(screen.getByRole("button", { name: /Replay clip/i })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Replay clip/i }));

    expect(video.currentTime).toBe(0);
    expect(playSpy).toHaveBeenCalled();
    // Overlay clears so the clip becomes scrubbable again.
    await waitFor(() => expect(screen.queryByRole("button", { name: /Replay clip/i })).not.toBeInTheDocument());
    expect(screen.getByText("OnlyTrick")).toBeInTheDocument();
  });

  it("NEXT TRICK advances to the next clip in the random pool", async () => {
    const user = userEvent.setup();
    mockFetchRandomLandedClips.mockResolvedValueOnce([
      makeClip({ id: "a", trickName: "TrickA" }),
      makeClip({ id: "b", trickName: "TrickB", playerUid: "p2", playerUsername: "bob" }),
    ]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("TrickA")).toBeInTheDocument());

    fireEvent.ended(document.querySelector("video") as HTMLVideoElement);
    await waitFor(() => expect(screen.getByRole("button", { name: /Next trick/i })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Next trick/i }));

    await waitFor(() => expect(screen.getByText("TrickB")).toBeInTheDocument());
    expect(screen.queryByText("TrickA")).not.toBeInTheDocument();
  });

  it("NEXT TRICK refetches a fresh random pool when the current one is exhausted", async () => {
    const user = userEvent.setup();
    mockFetchRandomLandedClips
      .mockResolvedValueOnce([makeClip({ id: "only", trickName: "OnlyTrick" })])
      .mockResolvedValueOnce([
        makeClip({ id: "fresh", trickName: "FreshTrick", playerUid: "p2", playerUsername: "bob" }),
      ]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("OnlyTrick")).toBeInTheDocument());

    fireEvent.ended(document.querySelector("video") as HTMLVideoElement);
    await waitFor(() => expect(screen.getByRole("button", { name: /Next trick/i })).toBeInTheDocument());

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Next trick/i }));
    });

    await waitFor(() => expect(screen.getByText("FreshTrick")).toBeInTheDocument());
    expect(mockFetchRandomLandedClips).toHaveBeenCalledTimes(2);
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
      mockFetchRandomLandedClips.mockResolvedValueOnce([makeClip()]);

      render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
      await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

      const videoEl = document.querySelector("video") as HTMLVideoElement;
      expect(videoEl).toBeTruthy();
      const playSpy = vi.spyOn(videoEl, "play").mockResolvedValue();
      const pauseSpy = vi.spyOn(videoEl, "pause").mockImplementation(() => undefined);

      // Regression guard: out-of-viewport BEFORE play() resolves must NOT
      // pause() — that revokes the muted-autoplay grant on mobile Safari.
      expect(ioCallback).toBeTruthy();
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
      mockFetchRandomLandedClips.mockResolvedValueOnce([makeClip()]);

      render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
      await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

      const videoEl = document.querySelector("video") as HTMLVideoElement;
      const pauseSpy = vi.spyOn(videoEl, "pause").mockImplementation(() => undefined);

      fireEvent.play(videoEl);

      await waitFor(() => expect(ioCallback).toBeTruthy());
      ioCallback!(
        [{ isIntersecting: false, target: videoEl } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      expect(pauseSpy).toHaveBeenCalled();
    } finally {
      globalThis.IntersectionObserver = originalIO;
    }
  });
});
