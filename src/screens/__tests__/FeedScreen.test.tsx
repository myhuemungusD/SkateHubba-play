import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedScreen } from "../FeedScreen";
import type { UserProfile } from "../../services/users";
import type { ClipsFeedProps } from "../../components/ClipsFeed";

/**
 * Smoke coverage for the standalone Clips tab. All feed behaviour belongs to
 * <ClipsFeed> (ClipsFeed.test.tsx); this screen owns only the page chrome and
 * the prop hand-off, so the feed is stubbed to a probe that echoes what it
 * was given.
 */
vi.mock("../../components/ClipsFeed", () => ({
  ClipsFeed: ({ profile, onViewPlayer, onChallengeUser }: ClipsFeedProps) => (
    <div data-testid="clips-feed" data-viewer={profile.uid}>
      <button onClick={() => onViewPlayer("u2")}>__view__</button>
      <button onClick={() => onChallengeUser("rival")}>__challenge__</button>
    </div>
  ),
}));

const profile: UserProfile = { uid: "u1", username: "sk8r", stance: "Regular", createdAt: null };

describe("FeedScreen", () => {
  it("renders the Clips header and mounts the feed for the viewer", () => {
    render(<FeedScreen profile={profile} onViewPlayer={vi.fn()} onChallengeUser={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Clips" })).toBeInTheDocument();
    expect(screen.getByTestId("clips-feed")).toHaveAttribute("data-viewer", "u1");
  });

  it("passes the navigation and challenge callbacks through to the feed", async () => {
    const onViewPlayer = vi.fn();
    const onChallengeUser = vi.fn();
    render(<FeedScreen profile={profile} onViewPlayer={onViewPlayer} onChallengeUser={onChallengeUser} />);

    await userEvent.click(screen.getByText("__view__"));
    await userEvent.click(screen.getByText("__challenge__"));

    expect(onViewPlayer).toHaveBeenCalledWith("u2");
    expect(onChallengeUser).toHaveBeenCalledWith("rival");
  });
});
