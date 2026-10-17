/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedModeToggle } from "../FeedModeToggle";

describe("FeedModeToggle", () => {
  it("renders all modes when showJudge and showNameIt are true", () => {
    render(<FeedModeToggle mode="scroll" onChange={vi.fn()} disabled={false} showJudge={true} showNameIt={true} />);

    expect(screen.getByRole("button", { name: /scroll/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /name it/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /vote/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /judge/i })).toBeInTheDocument();
  });

  it("hides Judge when showJudge is false", () => {
    render(<FeedModeToggle mode="scroll" onChange={vi.fn()} disabled={false} showJudge={false} showNameIt={true} />);

    expect(screen.getByRole("button", { name: /scroll/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /name it/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /vote/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /judge/i })).not.toBeInTheDocument();
  });

  it("hides Name It when showNameIt is false", () => {
    render(<FeedModeToggle mode="scroll" onChange={vi.fn()} disabled={false} showJudge={true} showNameIt={false} />);

    expect(screen.getByRole("button", { name: /scroll/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /name it/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /vote/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /judge/i })).toBeInTheDocument();
  });

  it("marks active mode as pressed", () => {
    render(<FeedModeToggle mode="name-it" onChange={vi.fn()} disabled={false} showJudge={true} showNameIt={true} />);

    const nameItButton = screen.getByRole("button", { name: /name it/i });
    const scrollButton = screen.getByRole("button", { name: /scroll/i });

    expect(nameItButton).toHaveAttribute("aria-pressed", "true");
    expect(scrollButton).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange when mode button is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<FeedModeToggle mode="scroll" onChange={onChange} disabled={false} showJudge={true} showNameIt={true} />);

    await user.click(screen.getByRole("button", { name: /name it/i }));

    expect(onChange).toHaveBeenCalledWith("name-it");
  });

  it("does not call onChange when clicking active mode", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<FeedModeToggle mode="scroll" onChange={onChange} disabled={false} showJudge={true} showNameIt={true} />);

    await user.click(screen.getByRole("button", { name: /scroll/i }));

    // onChange is called even for active mode (re-selecting is allowed)
    expect(onChange).toHaveBeenCalledWith("scroll");
  });

  it("disables all buttons when disabled prop is true", () => {
    render(<FeedModeToggle mode="scroll" onChange={vi.fn()} disabled={true} showJudge={true} showNameIt={true} />);

    const buttons = screen.getAllByRole("button");
    buttons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  it("always shows Scroll and Vote modes", () => {
    render(<FeedModeToggle mode="scroll" onChange={vi.fn()} disabled={false} showJudge={false} showNameIt={false} />);

    expect(screen.getByRole("button", { name: /scroll/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /vote/i })).toBeInTheDocument();
  });

  function swipe(fromX: number, toX: number) {
    const bar = screen.getByRole("button", { name: /scroll/i }).parentElement as HTMLElement;
    fireEvent.touchStart(bar, { touches: [{ clientX: fromX }] });
    fireEvent.touchEnd(bar, { changedTouches: [{ clientX: toX }] });
  }

  it("swipes left to the next mode and right to the previous one", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FeedModeToggle mode="scroll" onChange={onChange} showJudge showNameIt />);
    swipe(300, 100);
    expect(onChange).toHaveBeenLastCalledWith("name-it");

    rerender(<FeedModeToggle mode="vote" onChange={onChange} showJudge showNameIt />);
    swipe(100, 300);
    expect(onChange).toHaveBeenLastCalledWith("name-it");
  });

  it("ignores short swipes and swipes past either end", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FeedModeToggle mode="scroll" onChange={onChange} showJudge={false} showNameIt={false} />,
    );
    swipe(200, 180);
    swipe(100, 300);
    rerender(<FeedModeToggle mode="vote" onChange={onChange} showJudge={false} showNameIt={false} />);
    swipe(300, 100);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("dots inactive Judge and Name It when something is waiting", () => {
    const { container, rerender } = render(
      <FeedModeToggle mode="scroll" onChange={vi.fn()} showJudge showNameIt disputesPending streakDue />,
    );
    expect(container.querySelectorAll("span.-top-1")).toHaveLength(2);
    rerender(<FeedModeToggle mode="judge" onChange={vi.fn()} showJudge showNameIt disputesPending />);
    expect(container.querySelectorAll("span.-top-1")).toHaveLength(0);
  });
});
