import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClipsFeed } from "../ClipsFeed";
import type { UserProfile } from "../../services/users";
import type { ClipDoc } from "../../services/clips";

const { mockFetchClipsFeed, mockFetchClipUpvoteState, mockUpvoteClip, mockTrackEvent, MockAlreadyUpvotedError } =
  vi.hoisted(() => {
    class MockAlreadyUpvotedError extends Error {
      constructor(public readonly clipId: string) {
        super(`already_upvoted:${clipId}`);
        this.name = "AlreadyUpvotedError";
      }
    }
    // The shim below lets tests queue plain `[clip, clip]` arrays instead
    // of `{ clips, cursor }` page objects — kept compact so the test bodies
    // stay focused on behavior, not Firestore page shape.
    return {
      mockFetchClipsFeed: vi.fn(),
      mockFetchClipUpvoteState: vi.fn(),
      mockUpvoteClip: vi.fn(),
      mockTrackEvent: vi.fn(),
      MockAlreadyUpvotedError,
    };
  });

vi.mock("../../services/clips", () => ({
  fetchClipsFeed: async (...args: unknown[]) => {
    const result = await mockFetchClipsFeed(...args);
    return Array.isArray(result) ? { clips: result, cursor: null } : result;
  },
  fetchClipUpvoteState: (...args: unknown[]) => mockFetchClipUpvoteState(...args),
  upvoteClip: (...args: unknown[]) => mockUpvoteClip(...args),
  AlreadyUpvotedError: MockAlreadyUpvotedError,
}));

vi.mock("../../services/analytics", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
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
    upvoteCount: 0,
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

/**
 * Shared preamble for the upvote tests: render the feed with one hydrated
 * clip at `initialCount` and the named upvote outcome staged on the mock,
 * then return the upvote button so the test can drive the click + assert.
 */
async function mountWithUpvoteSetup(
  outcome: { kind: "success"; resolved: number } | { kind: "alreadyUpvoted" } | { kind: "error"; error: Error },
) {
  const initialCount = 2;
  const user = userEvent.setup();
  mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
  mockFetchClipUpvoteState.mockResolvedValueOnce(
    new Map([["g1_2_set", { count: initialCount, alreadyUpvoted: false }]]),
  );
  if (outcome.kind === "success") {
    mockUpvoteClip.mockResolvedValueOnce(outcome.resolved);
  } else if (outcome.kind === "alreadyUpvoted") {
    mockUpvoteClip.mockRejectedValueOnce(new MockAlreadyUpvotedError("g1_2_set"));
  } else {
    mockUpvoteClip.mockRejectedValueOnce(outcome.error);
  }
  render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
  await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
  const upvoteBtn = await screen.findByRole("button", {
    name: /Upvote clip by @alice · current count 2/i,
  });
  return { user, upvoteBtn };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchClipUpvoteState.mockResolvedValue(new Map());
});

describe("ClipsFeed", () => {
  it("shows the loading state on first mount", () => {
    mockFetchClipsFeed.mockImplementation(() => new Promise(() => {}));
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    expect(screen.getByRole("status", { name: /loading clips/i })).toBeInTheDocument();
  });

  it("renders the empty state when the page comes back empty", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/No clips yet\./i)).toBeInTheDocument());
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

  it("fires clip_upvoted with fromSort and newCount on a successful upvote", async () => {
    const { user, upvoteBtn } = await mountWithUpvoteSetup({ kind: "success", resolved: 3 });

    await user.click(upvoteBtn);

    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalledWith("clip_upvoted", expect.any(Object)));
    expect(mockTrackEvent).toHaveBeenCalledWith("clip_upvoted", {
      clipId: "g1_2_set",
      fromSort: "top",
      newCount: 3,
    });
  });

  it("does NOT fire clip_upvoted when upvoteClip throws AlreadyUpvotedError", async () => {
    const { user, upvoteBtn } = await mountWithUpvoteSetup({ kind: "alreadyUpvoted" });

    await user.click(upvoteBtn);

    // Wait for the optimistic state to settle so we don't false-pass on timing.
    await waitFor(() => expect(screen.getByRole("button", { name: /Upvoted · 3/i })).toBeInTheDocument());
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

  it("renders an upvote button next to challenge with the hydrated count", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
    mockFetchClipUpvoteState.mockResolvedValueOnce(new Map([["g1_2_set", { count: 4, alreadyUpvoted: false }]]));

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Upvote clip by @alice · current count 4/i })).toBeInTheDocument(),
    );
  });

  it("does not render an upvote button on the viewer's own clip (no self-upvote)", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip({ playerUid: profile.uid, playerUsername: profile.username })]);
    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Upvote clip/i })).not.toBeInTheDocument();
  });

  it("optimistically increments and locks the upvote button on tap", async () => {
    const { user, upvoteBtn } = await mountWithUpvoteSetup({ kind: "success", resolved: 3 });

    await user.click(upvoteBtn);

    expect(mockUpvoteClip).toHaveBeenCalledWith(profile.uid, "g1_2_set");
    await waitFor(() => expect(screen.getByRole("button", { name: /Upvoted · 3/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Upvoted · 3/i })).toBeDisabled();
  });

  it("rolls back the optimistic upvote on a non-AlreadyUpvotedError failure", async () => {
    const { user, upvoteBtn } = await mountWithUpvoteSetup({ kind: "error", error: new Error("network down") });

    await user.click(upvoteBtn);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Upvote clip by @alice · current count 2/i })).toBeEnabled(),
    );
  });

  it("keeps the optimistic upvoted state when the server already had our vote", async () => {
    const { user, upvoteBtn } = await mountWithUpvoteSetup({ kind: "alreadyUpvoted" });

    await user.click(upvoteBtn);

    await waitFor(() => expect(screen.getByRole("button", { name: /Upvoted · 3/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Upvoted · 3/i })).toBeDisabled();
  });

  it("renders the spotlight video with autoplay/muted attributes and a tap-to-unmute affordance", async () => {
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);

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
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    const unmuteBtn = screen.getByRole("button", { name: /Unmute clip/i });
    await user.click(unmuteBtn);

    await waitFor(() => expect(screen.getByRole("button", { name: /Mute clip/i })).toBeInTheDocument());
    expect(screen.queryByText(/MUTED · TAP/i)).not.toBeInTheDocument();
  });

  it("hands the full clip pool to the upvote-state service so it can read counts off the denormalized aggregate", async () => {
    // The service filters self-clips internally and reads `upvoteCount`
    // straight off each clip doc — the component no longer pre-extracts
    // ids. Passing the whole pool also lets the service use a single
    // batched `where(__name__, in, [...])` query (1 read, not 2*N).
    const own = makeClip({ id: "own", playerUid: profile.uid, playerUsername: profile.username });
    const other = makeClip({ id: "other", playerUid: "p2", playerUsername: "bob" });
    mockFetchClipsFeed.mockResolvedValueOnce([own, other]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(mockFetchClipUpvoteState).toHaveBeenCalled());

    expect(mockFetchClipUpvoteState).toHaveBeenCalledWith(profile.uid, [own, other]);
  });

  it("still calls upvote hydration when every clip is the viewer's own — service short-circuits without a read", async () => {
    // The service does the self-filter; an own-only pool is a 0-read
    // call inside the service, not a never-call from the component.
    const own = makeClip({ playerUid: profile.uid, playerUsername: profile.username });
    mockFetchClipsFeed.mockResolvedValueOnce([own]);

    render(<ClipsFeed profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Kickflip")).toBeInTheDocument());

    expect(mockFetchClipUpvoteState).toHaveBeenCalledWith(profile.uid, [own]);
  });

  it("preserves an optimistic upvote when a slow hydration resolves after the user's tap (race guard)", async () => {
    const user = userEvent.setup();
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);
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
    mockFetchClipsFeed.mockResolvedValueOnce([
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
    mockFetchClipsFeed.mockResolvedValueOnce([makeClip({ id: "only", trickName: "OnlyTrick" })]);

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
    mockFetchClipsFeed.mockResolvedValueOnce([
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
    mockFetchClipsFeed
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
    expect(mockFetchClipsFeed).toHaveBeenCalledTimes(2);
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
      mockFetchClipsFeed.mockResolvedValueOnce([makeClip()]);

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
