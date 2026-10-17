/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
