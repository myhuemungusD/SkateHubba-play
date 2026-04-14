import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockFetchFeaturedClip, mockUpvoteClip, AlreadyUpvotedErrorShim } = vi.hoisted(() => {
  class AlreadyUpvotedErrorShim extends Error {
    constructor(public readonly clipId: string) {
      super(`already_upvoted:${clipId}`);
      this.name = "AlreadyUpvotedError";
    }
  }
  return {
    mockFetchFeaturedClip: vi.fn(),
    mockUpvoteClip: vi.fn(),
    AlreadyUpvotedErrorShim,
  };
});

vi.mock("../../services/clips", () => ({
  fetchFeaturedClip: (...args: unknown[]) => mockFetchFeaturedClip(...args),
  upvoteClip: (...args: unknown[]) => mockUpvoteClip(...args),
  AlreadyUpvotedError: AlreadyUpvotedErrorShim,
}));

import { FeaturedClipCard } from "../FeaturedClipCard";

const baseClip = {
  id: "g1_2_set",
  videoUrl: "https://example.com/x.webm",
  trickName: "kickflip",
  playerUid: "p1",
  playerUsername: "alice",
  spotName: "Pier 7",
  createdAt: null,
  upvoteCount: 3,
  alreadyUpvoted: false,
};

function mkProps(overrides: Partial<Parameters<typeof FeaturedClipCard>[0]> = {}) {
  return {
    myUid: "me",
    onChallengeUser: vi.fn(),
    onViewPlayer: vi.fn(),
    canChallenge: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FeaturedClipCard", () => {
  it("renders nothing (hidden state) when the service returns null", async () => {
    mockFetchFeaturedClip.mockResolvedValueOnce(null);
    const { container } = render(<FeaturedClipCard {...mkProps()} />);
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });

  it("renders the trick name, spot, and player once loaded", async () => {
    mockFetchFeaturedClip.mockResolvedValueOnce({ ...baseClip, id: "ready_1" });
    render(<FeaturedClipCard {...mkProps()} />);

    await waitFor(() => expect(screen.getByText("kickflip")).toBeInTheDocument());
    expect(screen.getByText("Pier 7")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
  });

  it("calls onChallengeUser with the clip player's username when Challenge is tapped", async () => {
    const props = mkProps();
    mockFetchFeaturedClip.mockResolvedValueOnce({ ...baseClip, id: "ready_2" });
    render(<FeaturedClipCard {...props} />);

    const btn = await screen.findByRole("button", { name: /challenge @alice/i });
    await userEvent.click(btn);
    expect(props.onChallengeUser).toHaveBeenCalledWith("alice");
  });

  it("disables Challenge when viewing your own clip (no self-challenge)", async () => {
    mockFetchFeaturedClip.mockResolvedValueOnce({ ...baseClip, id: "own_1", playerUid: "me" });
    render(<FeaturedClipCard {...mkProps()} />);

    const btn = await screen.findByRole("button", { name: /can't challenge yourself/i });
    expect(btn).toBeDisabled();
  });

  it("disables Challenge when canChallenge is false (e.g. email unverified)", async () => {
    mockFetchFeaturedClip.mockResolvedValueOnce({ ...baseClip, id: "gated_1" });
    render(<FeaturedClipCard {...mkProps({ canChallenge: false })} />);

    const btn = await screen.findByRole("button", { name: /verify your email to challenge/i });
    expect(btn).toBeDisabled();
  });

  it("optimistically increments the upvote count and locks the button after tap", async () => {
    mockFetchFeaturedClip.mockResolvedValueOnce({ ...baseClip, id: "upv_1", upvoteCount: 3 });
    mockUpvoteClip.mockResolvedValueOnce(4);

    render(<FeaturedClipCard {...mkProps()} />);
    const upvoteBtn = await screen.findByRole("button", { name: /upvote clip/i });
    expect(upvoteBtn).toHaveTextContent("3");

    await userEvent.click(upvoteBtn);

    await waitFor(() => expect(mockUpvoteClip).toHaveBeenCalledWith("me", "upv_1"));
    await waitFor(() => {
      const disabled = screen.getByRole("button", { name: /upvoted · 4/i });
      expect(disabled).toBeDisabled();
    });
  });

  it("rolls back the optimistic increment when upvote fails (not AlreadyUpvoted)", async () => {
    mockFetchFeaturedClip.mockResolvedValueOnce({ ...baseClip, id: "fail_1", upvoteCount: 3 });
    mockUpvoteClip.mockRejectedValueOnce(new Error("network"));

    render(<FeaturedClipCard {...mkProps()} />);
    const upvoteBtn = await screen.findByRole("button", { name: /upvote clip/i });
    await userEvent.click(upvoteBtn);

    await waitFor(() => {
      const retry = screen.getByRole("button", { name: /upvote clip/i });
      expect(retry).not.toBeDisabled();
      expect(retry).toHaveTextContent("3");
    });
  });

  it("treats AlreadyUpvotedError as a successful lock (keeps the filled state)", async () => {
    mockFetchFeaturedClip.mockResolvedValueOnce({ ...baseClip, id: "locked_1", upvoteCount: 3 });
    mockUpvoteClip.mockRejectedValueOnce(new AlreadyUpvotedErrorShim("locked_1"));

    render(<FeaturedClipCard {...mkProps()} />);
    const upvoteBtn = await screen.findByRole("button", { name: /upvote clip/i });
    await userEvent.click(upvoteBtn);

    await waitFor(() => {
      const locked = screen.getByRole("button", { name: /upvoted · 4/i });
      expect(locked).toBeDisabled();
    });
  });

  it("hides the card on fetch error (never blocks the lobby's active list)", async () => {
    mockFetchFeaturedClip.mockRejectedValueOnce(new Error("boom"));
    const { container } = render(<FeaturedClipCard {...mkProps()} />);
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });
});
