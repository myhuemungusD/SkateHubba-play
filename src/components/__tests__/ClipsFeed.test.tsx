import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClipsFeed } from "../ClipsFeed";
import type { UserProfile } from "../../services/users";
import type { ClipDoc } from "../../services/clips";

const mockFetchClipsFeed = vi.fn();
vi.mock("../../services/clips", () => ({
  fetchClipsFeed: (...args: unknown[]) => mockFetchClipsFeed(...args),
}));

vi.mock("../../hooks/useBlockedUsers", () => ({
  useBlockedUsers: () => new Set<string>(),
}));

vi.mock("../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
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
});
