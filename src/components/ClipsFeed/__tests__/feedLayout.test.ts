import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import type { ClipDoc } from "../../../services/clips";
import { ClipActions } from "../ClipActions";
import { ABOVE_NAV, BELOW_HEADER, FEED_TOP_STACK, MUTE_SIDE, belowTopStack } from "../feedLayout";

describe("feedLayout top stack", () => {
  it("pins the stack under the top safe area, never at a fixed offset", () => {
    expect(FEED_TOP_STACK).toContain("pt-safe");
    expect(FEED_TOP_STACK).toContain("top-0");
    expect(FEED_TOP_STACK).not.toMatch(/top-(1[0-9]|[2-9]\d)/);
  });

  it("clears one more 2.75rem row per optional row, always from the safe area", () => {
    expect(belowTopStack(0)).toBe("top-[calc(max(env(safe-area-inset-top),1.25rem)+4.25rem)]");
    expect(belowTopStack(1)).toBe("top-[calc(max(env(safe-area-inset-top),1.25rem)+7rem)]");
    expect(belowTopStack(2)).toBe("top-[calc(max(env(safe-area-inset-top),1.25rem)+9.75rem)]");
    expect(belowTopStack(-1)).toBe(belowTopStack(0));
    expect(belowTopStack(9)).toBe(belowTopStack(2));
  });

  it("BELOW_HEADER is one of the safe-area-aware stack offsets", () => {
    expect([0, 1, 2].map(belowTopStack)).toContain(BELOW_HEADER);
  });
});

/**
 * Geometry of the mute toggle vs the clip rail, re-derived from the real
 * classes so a change to the rail (another button, a bigger gap) or to the
 * top stack fails here instead of overlapping on a 568px-tall iPhone SE.
 */
describe("mute toggle vs clip rail on short screens", () => {
  const REM = 16;
  const BTN = 44;
  const rem = (cls: string, re: RegExp) => Number(cls.match(re)![1]) * REM;

  /**
   * Pinned to the iPhone SE 1st gen, the only portrait iPhone 620px tall or
   * less: no notch, so the top inset is the 1.25rem floor of
   * max(env(safe-area-inset-top),1.25rem), and there is no home indicator.
   */
  const SE_SAFE_TOP = 20;
  const SE_SAFE_BOTTOM = 0;

  /** Worst case: both optional top rows on (mode switcher + Pro Picks), as in the iOS build. */
  const muteBottom = SE_SAFE_TOP + rem(belowTopStack(2), /\+([\d.]+)rem\)\]$/) + BTN;
  const railBottomInset = rem(ABOVE_NAV, /calc\(([\d.]+)rem/);
  const breakpoint = Number(MUTE_SIDE.match(/max-height:(\d+)px/)![1]);

  /** The rail as it renders for another player's clip, the longest it gets. */
  function measureRail() {
    const clip = { id: "c1", playerUid: "other-uid", playerUsername: "alice", trickName: "Kickflip" } as ClipDoc;
    const noop = vi.fn();
    render(
      createElement(ClipActions, {
        clip,
        isOwnClip: false,
        vote: { upvoteCount: 0, downvoteCount: 0, myVote: null },
        voting: false,
        onUpvote: noop,
        onDownvote: noop,
        onChallenge: noop,
        onReport: noop,
        onComments: noop,
      }),
    );
    const rail = screen.getByRole("group", { name: "Rate this clip" }).parentElement!;
    const gaps = [rail, screen.getByRole("group", { name: "Rate this clip" })].map(
      (el) => Number(el.className.match(/\bgap-(\d+)\b/)![1]) * 4,
    );
    expect(new Set(gaps).size).toBe(1);
    const buttons = rail.querySelectorAll("button").length;
    return { buttons, height: buttons * BTN + (buttons - 1) * gaps[0], gap: gaps[0] };
  }
  const railTop = (viewportHeight: number, railHeight: number) =>
    viewportHeight - SE_SAFE_BOTTOM - railBottomInset - railHeight;

  it("models the five-button rail the feed renders today", () => {
    const { buttons, height, gap } = measureRail();
    expect(buttons).toBe(5);
    expect(gap).toBe(12);
    expect(height).toBe(268);
    expect(muteBottom).toBe(220);
  });

  it("on a 568px-tall screen the rail would hit a top-right mute toggle, so the toggle moves", () => {
    const { height } = measureRail();
    expect(railTop(568, height)).toBeLessThan(muteBottom);
    expect(568).toBeLessThanOrEqual(breakpoint);
  });

  it("just above the breakpoint the rail clears a top-right toggle by more than one rail gap", () => {
    const { height, gap } = measureRail();
    expect(railTop(breakpoint + 1, height) - muteBottom).toBeGreaterThanOrEqual(gap);
  });

  it("keeps the toggle top-right on a 667px-tall iPhone SE 2/3 and on taller phones", () => {
    expect(breakpoint).toBeLessThan(667);
  });

  it("is top-right by default and top-left only under the short-screen query", () => {
    const classes = MUTE_SIDE.split(" ");
    expect(classes).toContain("right-3");
    expect(classes).toContain(`[@media(max-height:${breakpoint}px)]:right-auto`);
    expect(classes).toContain(`[@media(max-height:${breakpoint}px)]:left-3`);
    expect(classes.filter((c) => !c.startsWith("[@media"))).toEqual(["right-3"]);
  });
});
