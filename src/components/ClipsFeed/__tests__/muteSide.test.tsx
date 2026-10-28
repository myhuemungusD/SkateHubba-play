import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DisputeCard } from "../DisputeCard";
import { SpotlightCard } from "../SpotlightCard";
import { ABOVE_NAV, MUTE_SIDE_WITH_SHARE } from "../feedLayout";
import { makeDispute } from "../../__tests__/disputeFixtures.test-helpers";
import { makeGameClip } from "../../__tests__/clipFixtures.test-helpers";

/**
 * With VITE_FEATURE_FEED_SHARE on, only the clip card moves its mute toggle
 * top-left on short screens (its six-button rail reaches the top-right
 * corner). A dispute card's info block (call pill, trick name, tally, REPORT)
 * owns the top-left corner, so the toggle there would sit under it and be
 * untappable on a 568px-tall iPhone SE. Every test runs with the flag on,
 * the only state in which the toggle moves at all.
 */
const SHORT_LEFT = /\[@media\(max-height:\d+px\)\]:left-3/;
const BTN = 44;
const REM = 16;
const TW = 4;

afterEach(() => vi.unstubAllEnvs());

function renderDispute() {
  vi.stubEnv("VITE_FEATURE_FEED_SHARE", "true");
  const noop = vi.fn();
  return render(
    <DisputeCard
      dispute={makeDispute()}
      tally={{ land: 2, bail: 1 }}
      ownVerdict={null}
      canVote
      voting={false}
      deadline={null}
      onVerdict={noop}
      onReport={noop}
      active
      near
      muted
      onToggleMute={noop}
    />,
  );
}

describe("mute toggle side per card", () => {
  it("a dispute card keeps the toggle top-right on every screen height", () => {
    renderDispute();
    const mute = screen.getByRole("button", { name: /unmute clip/i });
    expect(mute).toHaveClass("right-3");
    expect(mute.className).not.toMatch(SHORT_LEFT);
    expect(mute.className).not.toMatch(/right-auto/);
  });

  it("a dispute card's info block and LAND/BAIL rail never reach its toggle on a 568px-tall screen", () => {
    renderDispute();
    const mute = screen.getByRole("button", { name: /unmute clip/i });
    const muteRightInset = Number(mute.className.match(/\bright-(\d+)\b/)![1]) * TW;
    // The info block stops this far from the right edge; the toggle spans muteRightInset..+44.
    const info = screen.getByText(/Community call: Landed or bailed\?/i).closest("div")!;
    const infoRightInset = Number(info.className.match(/\bright-(\d+)\b/)![1]) * TW;
    expect(infoRightInset).toBeGreaterThan(muteRightInset + BTN);
    // The two-button verdict rail starts well below the toggle (which ends at most 220px down on the SE).
    const rail = screen.getByRole("group", { name: /rule on/i });
    const gap = Number(rail.className.match(/\bgap-(\d+)\b/)![1]) * TW;
    const buttons = rail.querySelectorAll("button").length;
    const railTop =
      568 - Number(ABOVE_NAV.match(/calc\(([\d.]+)rem/)![1]) * REM - (buttons * BTN + (buttons - 1) * gap);
    expect(buttons).toBe(2);
    expect(railTop).toBeGreaterThan(220);
  });

  it("a clip card moves the toggle top-left under the short-screen query", () => {
    vi.stubEnv("VITE_FEATURE_FEED_SHARE", "true");
    const noop = vi.fn();
    render(
      <SpotlightCard
        clip={makeGameClip()}
        isOwnClip={false}
        vote={{ upvoteCount: 0, downvoteCount: 0, myVote: null }}
        voting={false}
        active
        near
        muted
        onToggleMute={noop}
        onViewPlayer={noop}
        onUpvote={noop}
        onDownvote={noop}
        onChallenge={noop}
        onReport={noop}
        onComments={noop}
      />,
    );
    const mute = screen.getByRole("button", { name: /unmute clip/i });
    for (const cls of MUTE_SIDE_WITH_SHARE.split(" ")) expect(mute).toHaveClass(cls);
    expect(mute.className).toMatch(SHORT_LEFT);
  });
});
