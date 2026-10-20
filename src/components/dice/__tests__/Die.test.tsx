import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Die } from "../Die";
import { DiceSpot } from "../DiceSpot";
import { LAND_MS, LAND_STEP_MS, useReveal } from "../useReveal";

describe("Die", () => {
  it.each([1, 2, 3, 4, 5, 6])("shows %i bolts", (face) => {
    render(<Die face={face} />);
    expect(screen.getByRole("img", { name: `Die showing ${face}` })).toBeInTheDocument();
    expect(screen.getByTestId("die")).toHaveAttribute("data-face", String(face));
  });

  it("shows a blank die in hand", () => {
    render(<Die face={0} size="xs" />);
    expect(screen.getByRole("img", { name: "Die, not rolled" })).toBeInTheDocument();
  });

  it.each(["land", "rattle", "fade", "rest"] as const)("applies %s motion", (motion) => {
    render(<Die face={3} motion={motion} order={7} size="md" label="custom" />);
    const el = screen.getByRole("img", { name: "custom" });
    if (motion === "rest") expect(el.className).not.toContain("animate-");
    else expect(el.className).toContain(`animate-dice-${motion}`);
  });

  it("toggles as a pressable die in 10,000", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(<Die face={5} size="sm" onToggle={onToggle} />);
    const button = screen.getByRole("button", { name: "Die showing 5" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalled();
    rerender(<Die face={5} onToggle={onToggle} selected dead />);
    expect(screen.getByRole("button", { name: "Die showing 5, set aside" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("DiceSpot", () => {
  it("shows dice in hand, a craps point and the set-aside tray", () => {
    render(
      <DiceSpot
        dice={null}
        rollKey="k"
        count={2}
        size="lg"
        rolling={false}
        landing={false}
        quick={false}
        onSkip={vi.fn()}
        point={6}
        kept={[1, 5]}
      >
        <p>caption</p>
      </DiceSpot>,
    );
    expect(screen.getAllByRole("img", { name: "Die, not rolled" })).toHaveLength(2);
    expect(screen.getByText("Point 6")).toBeInTheDocument();
    expect(screen.getByText("Set aside")).toBeInTheDocument();
    expect(screen.getByText("caption")).toBeInTheDocument();
  });

  it("rattles while rolling, quick-fades, and lets a tap skip the landing", async () => {
    const onSkip = vi.fn();
    const { rerender } = render(
      <DiceSpot
        dice={[1, 2, 3]}
        rollKey="k"
        count={3}
        size="md"
        rolling
        landing={false}
        quick={false}
        onSkip={onSkip}
      />,
    );
    expect(screen.getAllByRole("img", { name: "Die, rolling" })[0]?.className).toContain("animate-dice-rattle");
    rerender(
      <DiceSpot dice={[1, 2, 3]} rollKey="k" count={3} size="md" rolling={false} landing quick onSkip={onSkip} />,
    );
    expect(screen.getByRole("img", { name: "Die showing 1" }).className).toContain("animate-dice-fade");
    rerender(
      <DiceSpot
        dice={[1, 2, 3]}
        rollKey="k"
        count={3}
        size="md"
        rolling={false}
        landing
        quick={false}
        onSkip={onSkip}
      />,
    );
    expect(screen.getByRole("img", { name: "Die showing 1" }).className).toContain("animate-dice-land");
    await userEvent.click(screen.getByTestId("dice-spot"));
    expect(onSkip).toHaveBeenCalled();
    rerender(
      <DiceSpot dice={[1, 2, 3]} rollKey="k" count={3} size="md" rolling quick onSkip={onSkip} landing={false} />,
    );
    expect(screen.getAllByRole("img", { name: "Die, rolling" })[0]?.className).not.toContain("animate-");
  });

  it("lets you pick scoring dice once they land", async () => {
    const onToggle = vi.fn();
    render(
      <DiceSpot
        dice={[1, 2, 5]}
        rollKey="k"
        count={3}
        size="md"
        rolling={false}
        landing={false}
        quick={false}
        onSkip={vi.fn()}
        selection={{ selected: new Set([0]), live: new Set([0, 2]), onToggle }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Die showing 5" }));
    expect(onToggle).toHaveBeenCalledWith(2);
    expect(screen.getByRole("button", { name: "Die showing 1, set aside" })).toBeInTheDocument();
  });
});

describe("useReveal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not replay the roll already on screen", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useReveal("r1", 3, false, vi.fn(), onDone));
    expect(result.current.landing).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("lands each die, then finishes", () => {
    const onLand = vi.fn();
    const onDone = vi.fn();
    const { result, rerender } = renderHook(({ k }: { k: string | null }) => useReveal(k, 3, false, onLand, onDone), {
      initialProps: { k: null as string | null },
    });
    rerender({ k: "r2" });
    expect(result.current.landing).toBe(true);
    act(() => vi.advanceTimersByTime(2 * LAND_STEP_MS + LAND_MS));
    expect(onLand).toHaveBeenCalledTimes(3);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(result.current.landing).toBe(false);
  });

  it("lands at once in quick mode, and a tap skips", () => {
    const onLand = vi.fn();
    const onDone = vi.fn();
    const { result, rerender } = renderHook(({ k }: { k: string }) => useReveal(k, 6, true, onLand, onDone), {
      initialProps: { k: "a" },
    });
    rerender({ k: "b" });
    act(() => vi.advanceTimersByTime(200));
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    rerender({ k: "c" });
    act(() => result.current.skip());
    expect(result.current.landing).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(2);
    act(() => result.current.skip());
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});
