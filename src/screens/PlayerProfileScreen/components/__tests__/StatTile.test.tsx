import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../../../hooks/useReducedMotion", () => ({ useReducedMotion: () => motion.reduced }));

import { StatTile } from "../StatTile";

/**
 * Drives the count-up with a hand-cranked requestAnimationFrame so every
 * branch of the tween runs on every machine. With real frames the number of
 * ticks depends on timing, which made this file's branch coverage flap
 * around the per-file floor between runs.
 */
describe("StatTile count-up", () => {
  let queue: FrameRequestCallback[] = [];
  const tick = (ts: number) =>
    act(() => {
      const due = queue;
      queue = [];
      for (const cb of due) cb(ts);
    });

  beforeEach(() => {
    motion.reduced = false;
    queue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      queue.push(cb);
      return queue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tweens from 0 to the final value across frames and stops at 600 ms", () => {
    render(<StatTile name="wins" label="Wins" value={100} ariaLabel="Wins: 100" />);
    const tile = screen.getByRole("button", { name: "Wins: 100" });
    expect(tile).toHaveTextContent("0");
    tick(1000); // first frame anchors the start time
    tick(1300); // halfway: ease-out cubic of 0.5 = 0.875
    expect(tile).toHaveTextContent("88");
    tick(1600); // done
    expect(tile).toHaveTextContent("100");
    expect(queue).toHaveLength(0);
  });

  it("cancels a pending frame on unmount", () => {
    const { unmount } = render(<StatTile name="wins" label="Wins" value={5} ariaLabel="Wins: 5" />);
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("shows the final value at once with reduced motion, and a dash for null", () => {
    motion.reduced = true;
    const onTap = vi.fn();
    render(<StatTile name="winRate" label="Win rate" value={null} ariaLabel="Win rate: none" onTap={onTap} />);
    expect(screen.getByRole("button", { name: "Win rate: none" })).toHaveTextContent("—");
    expect(queue).toHaveLength(0);
  });
});
