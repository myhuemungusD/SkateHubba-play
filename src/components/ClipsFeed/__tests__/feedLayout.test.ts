import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import type { ClipDoc } from "../../../services/clips";
import { ClipActions } from "../ClipActions";
import { ABOVE_NAV, BELOW_HEADER, MUTE_SIDE_WITH_SHARE, clipMuteSide } from "../feedLayout";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("clipMuteSide", () => {
  it("keeps the toggle top-right while VITE_FEATURE_FEED_SHARE is off", () => {
    expect(clipMuteSide()).toBe("right-3");
    expect(clipMuteSide(false)).toBe("right-3");
  });

  it("uses the short-screen placement while VITE_FEATURE_FEED_SHARE is on", () => {
    vi.stubEnv("VITE_FEATURE_FEED_SHARE", "true");
    expect(clipMuteSide()).toBe(MUTE_SIDE_WITH_SHARE);
    expect(clipMuteSide(true)).toBe(MUTE_SIDE_WITH_SHARE);
  });
});

/**
 * Geometry of the mute toggle vs the clip rail on short screens, re-derived
 * from the real classes so a change to the rail (another button, a bigger
 * gap, a caption) or to the header offset fails here instead of overlapping
 * on a 568px-tall iPhone SE.
 */
describe("mute toggle vs clip rail on short screens", () => {
  const REM = 16;
  const BTN = 44;
  const SAFE_TOP = 20;
  const rem = (cls: string, re: RegExp) => Number(cls.match(re)![1]) * REM;
  const gapPx = (el: Element) => Number(el.className.match(/\bgap-(\d+)\b/)![1]) * 4;
  const captionLine =
    Number(
      readFileSync(resolve(process.cwd(), "src/index.css"), "utf8").match(
        /--text-caption--line-height:\s*([\d.]+)rem/,
      )![1],
    ) * REM;

  const muteBottom = SAFE_TOP + rem(BELOW_HEADER, /\+([\d.]+)rem\)\]$/) + BTN;
  const railBottomInset = rem(ABOVE_NAV, /calc\(([\d.]+)rem/);
  const breakpoint = Number(MUTE_SIDE_WITH_SHARE.match(/max-height:(\d+)px/)![1]);

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
    const group = screen.getByRole("group", { name: "Rate this clip" });
    const rail = group.parentElement!;
    const gap = gapPx(rail);
    expect(gapPx(group)).toBe(gap);
    const buttons = rail.querySelectorAll("button").length;
    // A captioned button adds its own gap plus one caption line under the 44px button.
    const captions = [...rail.querySelectorAll("span.text-caption")].map((s) => gapPx(s.parentElement!) + captionLine);
    const height = buttons * BTN + (buttons - 1) * gap + captions.reduce((a, b) => a + b, 0);
    return { buttons, height, gap };
  }
  const railTop = (viewportHeight: number, railHeight: number) => viewportHeight - railBottomInset - railHeight;

  it("the five-button rail (flag off) never reaches the top-right toggle, even at 568px", () => {
    const { buttons, height } = measureRail();
    expect(buttons).toBe(5);
    expect(height).toBe(290);
    expect(muteBottom).toBe(132);
    expect(railTop(568, height)).toBeGreaterThan(muteBottom);
  });

  it("models the six-button rail with Share on", () => {
    vi.stubEnv("VITE_FEATURE_FEED_SHARE", "true");
    const { buttons, height, gap } = measureRail();
    expect(buttons).toBe(6);
    expect(gap).toBe(12);
    expect(height).toBe(346);
  });

  it("with Share on, a 568px-tall screen would put the rail over a top-right toggle, so the toggle moves", () => {
    vi.stubEnv("VITE_FEATURE_FEED_SHARE", "true");
    const { height } = measureRail();
    expect(railTop(568, height)).toBeLessThan(muteBottom);
    expect(568).toBeLessThanOrEqual(breakpoint);
  });

  it("with Share on, just above the breakpoint the rail clears a top-right toggle by at least one rail gap", () => {
    vi.stubEnv("VITE_FEATURE_FEED_SHARE", "true");
    const { height, gap } = measureRail();
    expect(railTop(breakpoint + 1, height) - muteBottom).toBeGreaterThanOrEqual(gap);
  });

  it("keeps the toggle top-right on a 667px-tall iPhone SE 2/3 and on taller phones", () => {
    expect(breakpoint).toBeLessThan(667);
  });

  it("is top-right by default and top-left only under the short-screen query", () => {
    const classes = MUTE_SIDE_WITH_SHARE.split(" ");
    expect(classes).toContain(`[@media(max-height:${breakpoint}px)]:right-auto`);
    expect(classes).toContain(`[@media(max-height:${breakpoint}px)]:left-3`);
    expect(classes.filter((c) => !c.startsWith("[@media"))).toEqual(["right-3"]);
  });
});
