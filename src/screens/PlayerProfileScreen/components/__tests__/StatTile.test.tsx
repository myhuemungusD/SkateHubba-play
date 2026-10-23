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
    render(<StatTile name="wins" label="Wins" value={100} />);
    // The spoken name holds the final value the whole time (audit D1) ...
    const tile = screen.getByRole("button", { name: "Wins 100" });
    // ... while the drawn number tweens, hidden from assistive tech.
    const drawn = tile.querySelector('[aria-hidden="true"]');
    expect(drawn).toHaveTextContent(/^0$/);
    tick(1000); // first frame anchors the start time
    tick(1300); // halfway: ease-out cubic of 0.5 = 0.875
    expect(drawn).toHaveTextContent(/^88$/);
    tick(1600); // done
    expect(drawn).toHaveTextContent(/^100$/);
    expect(screen.getByRole("button", { name: "Wins 100" })).toBe(tile);
    expect(queue).toHaveLength(0);
  });

  it("cancels a pending frame on unmount", () => {
    const { unmount } = render(<StatTile name="wins" label="Wins" value={5} />);
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("shows the final value at once with reduced motion, and a dash for null", () => {
    motion.reduced = true;
    const onTap = vi.fn();
    render(<StatTile name="winRate" label="Win rate" value={null} onTap={onTap} />);
    expect(screen.getByRole("button", { name: "Win rate not available" })).toHaveTextContent("—");
    expect(queue).toHaveLength(0);
  });

  it("names the tile from its visible label first, so voice control can target it", () => {
    motion.reduced = true;
    render(<StatTile name="winRate" label="Win %" value={62} suffix="%" />);
    const tile = screen.getByRole("button", { name: "Win % 62 percent" });
    expect(tile).not.toHaveAttribute("aria-label");
    expect(tile).toHaveTextContent("62%");
  });

  it("speaks a custom value and draws a trailing icon", () => {
    motion.reduced = true;
    render(
      <StatTile
        name="currentStreak"
        label="Streak"
        value={3}
        spokenValue="3 game win streak"
        icon={<i data-testid="flame" />}
      />,
    );
    expect(screen.getByRole("button", { name: "Streak 3 game win streak" })).toContainElement(
      screen.getByTestId("flame"),
    );
  });
});
