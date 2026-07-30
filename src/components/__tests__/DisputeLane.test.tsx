import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DisputeLane } from "../ClipsFeed/DisputeLane";
import type { Dispute, DisputeTally, DisputeViewerState } from "../../types/dispute";
import { deferred } from "../../__tests__/harness/deferred";

const {
  mockFetchOpenDisputes,
  mockFetchDisputeViewerState,
  mockCastDisputeVerdict,
  mockTrackEvent,
  MockAlreadyRuledError,
  MockOwnDisputeError,
  MockDisputeClosedError,
} = vi.hoisted(() => {
  class MockAlreadyRuledError extends Error {
    constructor(public readonly disputeId: string) {
      super(`already_ruled:${disputeId}`);
      this.name = "AlreadyRuledError";
    }
  }
  class MockOwnDisputeError extends Error {
    constructor(public readonly disputeId: string) {
      super(`own_dispute:${disputeId}`);
      this.name = "OwnDisputeError";
    }
  }
  class MockDisputeClosedError extends Error {
    constructor(public readonly disputeId: string) {
      super(`dispute_closed:${disputeId}`);
      this.name = "DisputeClosedError";
    }
  }
  return {
    mockFetchOpenDisputes: vi.fn(),
    mockFetchDisputeViewerState: vi.fn(),
    mockCastDisputeVerdict: vi.fn(),
    mockTrackEvent: vi.fn(),
    MockAlreadyRuledError,
    MockOwnDisputeError,
    MockDisputeClosedError,
  };
});

vi.mock("../../services/disputes", () => ({
  fetchOpenDisputes: (...args: unknown[]) => mockFetchOpenDisputes(...args),
  fetchDisputeViewerState: (...args: unknown[]) => mockFetchDisputeViewerState(...args),
  castDisputeVerdict: (...args: unknown[]) => mockCastDisputeVerdict(...args),
  AlreadyRuledError: MockAlreadyRuledError,
  OwnDisputeError: MockOwnDisputeError,
  DisputeClosedError: MockDisputeClosedError,
}));

vi.mock("../../services/analytics", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

vi.mock("../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../../hooks/useBlockedUsers", () => ({
  useBlockedUsers: () => new Set<string>(),
}));

const STORAGE_HOST = "https://firebasestorage.googleapis.com/v0/b/x/o";

function makeDispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: "g1_3",
    gameId: "g1",
    turnNumber: 3,
    trickName: "Switch Heel",
    setterUid: "u1",
    setterUsername: "alice",
    matcherUid: "u2",
    matcherUsername: "bob",
    setVideoUrl: `${STORAGE_HOST}/set.webm?alt=media`,
    matchVideoUrl: `${STORAGE_HOST}/match.webm?alt=media`,
    spotId: null,
    createdAt: null,
    status: "open",
    moderationStatus: "active",
    landVotes: 2,
    bailVotes: 1,
    ...overrides,
  };
}

const CAN_VOTE: DisputeViewerState = { ownVerdict: null, canVote: true };

/**
 * Render the lane with a single dispute plus the viewer state it should
 * hydrate to, and wait for the card to settle. Returns a `user` bound to the
 * rendered tree so the individual tests stay one interaction long.
 */
async function mountLane(
  viewer: DisputeViewerState = CAN_VOTE,
  dispute: Dispute = makeDispute(),
): Promise<{ user: ReturnType<typeof userEvent.setup>; dispute: Dispute; unmount: () => void }> {
  const user = userEvent.setup();
  mockFetchOpenDisputes.mockResolvedValueOnce([dispute]);
  mockFetchDisputeViewerState.mockResolvedValueOnce(new Map([[dispute.id, viewer]]));
  const { unmount } = render(<DisputeLane viewerUid="me" />);
  await screen.findByRole("article", { name: /community call on Switch Heel/i });
  return { user, dispute, unmount };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchDisputeViewerState.mockResolvedValue(new Map());
});

describe("DisputeLane", () => {
  it("renders an open dispute with the attempt video, the prompt, and both verdicts", async () => {
    await mountLane();

    expect(screen.getByText("SETTLE IT")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Switch Heel")).toBeInTheDocument();
    expect(screen.getByText(/@bob says they landed @alice's trick\./i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bob's attempt at Switch Heel/i)).toHaveAttribute(
      "src",
      `${STORAGE_HOST}/match.webm?alt=media`,
    );
    expect(screen.getByRole("button", { name: /^Make — @bob made it$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Bail — @bob did not make it$/i })).toBeInTheDocument();
  });

  it("shows the vote-window countdown derived from the dispute's createdAt", async () => {
    const createdAt = { toMillis: () => Date.now() - 60_000 } as Dispute["createdAt"];
    await mountLane(CAN_VOTE, makeDispute({ createdAt }));

    // 24h window from createdAt, minus the elapsed minute → ~23h left.
    expect(screen.getByText(/Voting closes in/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/Turn timer: 23h/i)).toBeInTheDocument();
  });

  it("omits the countdown when the dispute has no resolved createdAt", async () => {
    await mountLane(CAN_VOTE, makeDispute({ createdAt: null }));

    expect(screen.queryByText(/Voting closes in/i)).not.toBeInTheDocument();
  });

  it("offers the setter's clip as secondary context", async () => {
    await mountLane();

    expect(screen.getByLabelText(/Watch @alice's original set of Switch Heel/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/alice's Switch Heel set video/i)).toHaveAttribute(
      "src",
      `${STORAGE_HOST}/set.webm?alt=media`,
    );
  });

  it("refuses to render a video URL that is not Firebase Storage", async () => {
    await mountLane(CAN_VOTE, makeDispute({ matchVideoUrl: "https://evil.example.com/x.webm", setVideoUrl: null }));

    expect(screen.queryByLabelText(/bob's attempt at Switch Heel/i)).not.toBeInTheDocument();
    expect(screen.getByText(/This attempt's video is unavailable\./i)).toBeInTheDocument();
  });

  it("LAND casts a land verdict", async () => {
    mockCastDisputeVerdict.mockResolvedValueOnce({ land: 3, bail: 1 } satisfies DisputeTally);
    const { user } = await mountLane();

    await user.click(screen.getByRole("button", { name: /^Make — @bob made it$/i }));

    await waitFor(() => expect(mockCastDisputeVerdict).toHaveBeenCalledWith("me", "g1_3", "land"));
    expect(mockTrackEvent).toHaveBeenCalledWith("dispute_verdict_cast", {
      disputeId: "g1_3",
      gameId: "g1",
      verdict: "land",
    });
  });

  it("BAIL casts a bail verdict", async () => {
    mockCastDisputeVerdict.mockResolvedValueOnce({ land: 2, bail: 2 } satisfies DisputeTally);
    const { user } = await mountLane();

    await user.click(screen.getByRole("button", { name: /^Bail — @bob did not make it$/i }));

    await waitFor(() => expect(mockCastDisputeVerdict).toHaveBeenCalledWith("me", "g1_3", "bail"));
  });

  it("swaps the buttons for the tally and marks the viewer's own call", async () => {
    mockCastDisputeVerdict.mockResolvedValueOnce({ land: 3, bail: 1 } satisfies DisputeTally);
    const { user } = await mountLane();

    await user.click(screen.getByRole("button", { name: /^Make — @bob made it$/i }));

    await waitFor(() => expect(screen.getByText(/YOUR CALL · MAKE/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Make — @bob made it$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Bail — @bob did not make it$/i })).not.toBeInTheDocument();
    // The card stays in the lane rather than vanishing once ruled.
    expect(screen.getByRole("article", { name: /community call on Switch Heel/i })).toBeInTheDocument();
  });

  it("shows the optimistic tally on tap, then reconciles to the server count", async () => {
    const cast = deferred<DisputeTally>();
    mockCastDisputeVerdict.mockReturnValueOnce(cast.promise);
    const { user } = await mountLane();

    await user.click(screen.getByRole("button", { name: /^Make — @bob made it$/i }));

    // Optimistic: seeded 2/1 becomes 3/1 before the write resolves.
    await screen.findByRole("img", { name: /3 make, 1 bail — 4 calls in/i });

    // The server counted a concurrent vote too — the card takes its number.
    cast.resolve({ land: 5, bail: 1 });
    await screen.findByRole("img", { name: /5 make, 1 bail — 6 calls in/i });
  });

  it("rolls the tally back and restores the buttons when the write fails", async () => {
    mockCastDisputeVerdict.mockRejectedValueOnce(new Error("network down"));
    const { user } = await mountLane();

    await user.click(screen.getByRole("button", { name: /^Make — @bob made it$/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /^Make — @bob made it$/i })).toBeEnabled());
    expect(screen.queryByText(/YOUR CALL/i)).not.toBeInTheDocument();
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it("keeps the optimistic verdict when the server says we already ruled", async () => {
    mockCastDisputeVerdict.mockRejectedValueOnce(new MockAlreadyRuledError("g1_3"));
    const { user } = await mountLane();

    await user.click(screen.getByRole("button", { name: /^Bail — @bob did not make it$/i }));

    await waitFor(() => expect(screen.getByText(/YOUR CALL · BAIL/i)).toBeInTheDocument());
    expect(screen.getByRole("img", { name: /2 make, 2 bail — 4 calls in/i })).toBeInTheDocument();
  });

  it("locks the card without an error when the dispute turns out to be the viewer's own", async () => {
    mockCastDisputeVerdict.mockRejectedValueOnce(new MockOwnDisputeError("g1_3"));
    const { user } = await mountLane();

    await user.click(screen.getByRole("button", { name: /^Make — @bob made it$/i }));

    // Tally rolls back to the seeded 2/1, buttons stay gone, no alert.
    await screen.findByRole("img", { name: /2 make, 1 bail — 3 calls in/i });
    expect(screen.queryByRole("button", { name: /^Make — @bob made it$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("locks the card without an error when voting has already closed", async () => {
    mockCastDisputeVerdict.mockRejectedValueOnce(new MockDisputeClosedError("g1_3"));
    const { user } = await mountLane();

    await user.click(screen.getByRole("button", { name: /^Bail — @bob did not make it$/i }));

    await screen.findByRole("img", { name: /2 make, 1 bail — 3 calls in/i });
    expect(screen.queryByText(/YOUR CALL/i)).not.toBeInTheDocument();
  });

  it("shows the tally instead of the buttons when the viewer cannot vote", async () => {
    await mountLane({ ownVerdict: null, canVote: false });

    expect(screen.getByRole("img", { name: /2 make, 1 bail — 3 calls in/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Make — @bob made it$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Bail — @bob did not make it$/i })).not.toBeInTheDocument();
  });

  it("shows a previously-cast verdict on reload", async () => {
    await mountLane({ ownVerdict: "bail", canVote: false });

    expect(screen.getByText(/YOUR CALL · BAIL/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /2 make, 1 bail — 3 calls in/i })).toBeInTheDocument();
  });

  it("reads the tally as centred and empty before anyone has ruled", async () => {
    await mountLane({ ownVerdict: null, canVote: false }, makeDispute({ landVotes: 0, bailVotes: 0 }));

    expect(screen.getByText(/No calls in yet/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /0 make, 0 bail — 0 calls in/i })).toBeInTheDocument();
  });

  it("renders nothing when there are no open disputes", async () => {
    mockFetchOpenDisputes.mockResolvedValueOnce([]);
    const { container } = render(<DisputeLane viewerUid="me" />);

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a loading placeholder while the disputes are in flight", () => {
    mockFetchOpenDisputes.mockImplementation(() => new Promise(() => {}));
    render(<DisputeLane viewerUid="me" />);

    expect(screen.getByRole("status", { name: /loading community calls/i })).toBeInTheDocument();
  });

  it("offers a retry when the disputes fail to load", async () => {
    const user = userEvent.setup();
    mockFetchOpenDisputes.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([makeDispute()]);
    render(<DisputeLane viewerUid="me" />);
    await screen.findByText(/Couldn't load the calls waiting on the community\./i);

    await user.click(screen.getByRole("button", { name: /try again/i }));

    await screen.findByRole("article", { name: /community call on Switch Heel/i });
  });

  it("still renders the lane read-only when the viewer-state hydration fails", async () => {
    mockFetchOpenDisputes.mockResolvedValueOnce([makeDispute()]);
    mockFetchDisputeViewerState.mockRejectedValueOnce(new Error("denied"));
    render(<DisputeLane viewerUid="me" />);

    await screen.findByRole("article", { name: /community call on Switch Heel/i });
    expect(screen.getByRole("img", { name: /2 make, 1 bail — 3 calls in/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Make — @bob made it$/i })).not.toBeInTheDocument();
  });

  it("abandons a load that resolves after the lobby has navigated away", async () => {
    const page = deferred<Dispute[]>();
    mockFetchOpenDisputes.mockReturnValueOnce(page.promise);
    const { unmount } = render(<DisputeLane viewerUid="me" />);

    unmount();
    await act(async () => page.resolve([makeDispute()]));

    // The viewer-state read never fires for a lane nobody is looking at.
    expect(mockFetchDisputeViewerState).not.toHaveBeenCalled();
  });

  it("drops a verdict that settles after the lane unmounts", async () => {
    const cast = deferred<DisputeTally>();
    mockCastDisputeVerdict.mockReturnValueOnce(cast.promise);
    const { user, unmount } = await mountLane();
    await user.click(screen.getByRole("button", { name: /^Make — @bob made it$/i }));

    unmount();
    await act(async () => cast.resolve({ land: 9, bail: 1 }));

    // No analytics, and — the point of the guard — no setState on a dead tree.
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it("fires exactly one write when the verdict is double-tapped", async () => {
    const cast = deferred<DisputeTally>();
    mockCastDisputeVerdict.mockReturnValueOnce(cast.promise);
    const { user } = await mountLane();

    const land = screen.getByRole("button", { name: /^Make — @bob made it$/i });
    await user.click(land);
    await user.click(land);

    expect(mockCastDisputeVerdict).toHaveBeenCalledTimes(1);
    cast.resolve({ land: 3, bail: 1 });
  });
});
