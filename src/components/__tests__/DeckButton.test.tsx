import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DeckButton } from "../DeckButton";

const playHaptic = vi.fn();
vi.mock("../../services/haptics", () => ({
  playHaptic: (...a: unknown[]) => playHaptic(...a),
  hapticForVariant: () => "medium",
}));

describe("DeckButton", () => {
  afterEach(() => vi.useRealTimers());

  it("ollies once on press, plays a haptic, and calls onClick", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(<DeckButton onClick={onClick}>START PLAYING</DeckButton>);
    const btn = screen.getByRole("button", { name: "START PLAYING" });
    const board = btn.firstElementChild as HTMLElement;
    expect(board.className).not.toContain("animate-ollie");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
    expect(playHaptic).toHaveBeenCalledWith("medium");
    expect(board.className).toContain("animate-ollie");
    act(() => vi.advanceTimersByTime(500));
    expect(board.className).not.toContain("animate-ollie");
  });

  it("clears a pending ollie timer on unmount and respects disabled", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const { unmount } = render(<DeckButton onClick={onClick}>GO</DeckButton>);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    render(
      <DeckButton onClick={onClick} disabled>
        GO
      </DeckButton>,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
