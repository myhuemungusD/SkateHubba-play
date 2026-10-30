import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { relativeClipTime } from "../utils";
import { NextClipPrefetcher } from "../NextClipPrefetcher";
import { DisputeCard } from "../DisputeCard";
import { ClipCommentRow } from "../ClipCommentRow";
import { SpotlightCard } from "../SpotlightCard";
import { makeDispute } from "../../__tests__/disputeFixtures.test-helpers";
import { makeGameClip } from "../../__tests__/clipFixtures.test-helpers";
import { makeClipComment } from "./clipComments.test-helpers";
import type { ClipDoc } from "../../../services/clips";

const NOW = new Date(2026, 5, 20, 12, 0, 0).getTime();
const at = (msAgo: number) => ({ toMillis: () => NOW - msAgo }) as unknown as ClipDoc["createdAt"];
const MIN = 60_000;

afterEach(() => vi.useRealTimers());

describe("relativeClipTime", () => {
  it("buckets future, seconds, minutes, hours, days and older stamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeClipTime(at(-5 * MIN))).toBe("just now");
    expect(relativeClipTime(at(30_000))).toBe("just now");
    expect(relativeClipTime(at(5 * MIN))).toBe("5m ago");
    expect(relativeClipTime(at(3 * 60 * MIN))).toBe("3h ago");
    expect(relativeClipTime(at(2 * 24 * 60 * MIN))).toBe("2d ago");
    expect(relativeClipTime(at(10 * 24 * 60 * MIN))).toBe("Jun 10");
  });
});

describe("NextClipPrefetcher bandwidth checks", () => {
  const SRC = "https://firebasestorage.googleapis.com/v0/b/x/o/next.webm?alt=media";
  const loads = () => vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);

  it.each([
    [{ saveData: true }, 0],
    [{ effectiveType: "2g" }, 0],
    [{ effectiveType: "slow-2g" }, 0],
    [{ effectiveType: "4g", saveData: false }, 1],
  ])("connection %o → %i prefetch loads", (connection, expected) => {
    const load = loads();
    vi.stubGlobal("navigator", { ...navigator, connection });
    const { container, unmount } = render(<NextClipPrefetcher src={SRC} />);
    expect(container.querySelector("video")).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(expected);
    unmount();
    load.mockRestore();
  });

  it("skips the prefetch when there is no navigator at all", () => {
    const load = loads();
    vi.stubGlobal("navigator", undefined);
    const { unmount } = render(<NextClipPrefetcher src={SRC} />);
    expect(load).not.toHaveBeenCalled();
    unmount();
    load.mockRestore();
  });
});

describe("feed cards edge copy", () => {
  it("renders an inactive dispute as a bare slide, and one call as 'call', not 'calls'", () => {
    const card = (active: boolean) => (
      <DisputeCard
        dispute={makeDispute()}
        tally={{ land: 1, bail: 0 }}
        ownVerdict={null}
        canVote={false}
        voting={false}
        deadline={null}
        onVerdict={vi.fn()}
        active={active}
      />
    );
    const { rerender } = render(card(false));
    const slide = screen.getByRole("article", { name: "Community call on Switch Heel" });
    expect(slide).toHaveAttribute("data-active", "false");
    expect(slide).not.toHaveAttribute("aria-current");
    expect(screen.queryByText("1 call in")).toBeNull();

    rerender(card(true));
    expect(slide).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("img", { name: "1 land, 0 bail — 1 call in" })).toBeInTheDocument();
    expect(screen.getByText("1 call in")).toBeInTheDocument();
  });

  it("falls back to '?' for the avatar initial of an empty username", () => {
    render(
      <ClipCommentRow
        comment={makeClipComment({ username: "" })}
        canDelete={false}
        deleting={false}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("falls back to '?' for the spotlight initial of an empty username", () => {
    render(
      <SpotlightCard
        onComments={vi.fn()}
        onReport={vi.fn()}
        onChallenge={vi.fn()}
        onDownvote={vi.fn()}
        onUpvote={vi.fn()}
        onViewPlayer={vi.fn()}
        onToggleMute={vi.fn()}
        muted={false}
        near={false}
        active
        voting={false}
        vote={{ myVote: null, upvoteCount: 0, downvoteCount: 0 }}
        isOwnClip={false}
        clip={makeGameClip({ playerUsername: "" })}
      />,
    );
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});
