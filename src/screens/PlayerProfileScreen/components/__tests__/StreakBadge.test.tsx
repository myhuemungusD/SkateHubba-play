import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StreakBadge } from "../StreakBadge";

const mockProfileStreakBadgeDisplayed = vi.fn();
vi.mock("../../../../services/analytics", () => ({
  analytics: {
    profileStreakBadgeDisplayed: (n: number) => mockProfileStreakBadgeDisplayed(n),
  },
}));

beforeEach(() => mockProfileStreakBadgeDisplayed.mockClear());

describe("StreakBadge", () => {
  it("does not render when streak is below 3", () => {
    const { container, rerender } = render(<StreakBadge currentWinStreak={0} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<StreakBadge currentWinStreak={2} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders at the locked streak threshold of 3", () => {
    render(<StreakBadge currentWinStreak={3} />);
    expect(screen.getByTestId("streak-badge")).toBeInTheDocument();
    expect(screen.getByText("3-GAME STREAK")).toBeInTheDocument();
  });

  it("renders larger streaks", () => {
    render(<StreakBadge currentWinStreak={12} />);
    expect(screen.getByText("12-GAME STREAK")).toBeInTheDocument();
  });

  it("uses celebratory aria-label, never warns about danger or loss (plan §1)", () => {
    render(<StreakBadge currentWinStreak={5} />);
    const status = screen.getByRole("status");
    const label = status.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/on a 5 game win streak/i);
    expect(label).not.toMatch(/danger|warning|risk|losing|broken/i);
  });

  it("does not include any 'in danger' or punitive copy in the rendered DOM", () => {
    render(<StreakBadge currentWinStreak={4} />);
    expect(screen.queryByText(/danger/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/in risk/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/lose your streak/i)).not.toBeInTheDocument();
  });

  it("fires profile_streak_badge_displayed once per streak length on mount (plan §7.2)", () => {
    render(<StreakBadge currentWinStreak={5} />);
    expect(mockProfileStreakBadgeDisplayed).toHaveBeenCalledTimes(1);
    expect(mockProfileStreakBadgeDisplayed).toHaveBeenCalledWith(5);
  });

  it("does NOT fire when streak is below the threshold", () => {
    render(<StreakBadge currentWinStreak={2} />);
    expect(mockProfileStreakBadgeDisplayed).not.toHaveBeenCalled();
  });

  it("re-fires when streak length increases (3 → 4 → 5)", () => {
    const { rerender } = render(<StreakBadge currentWinStreak={3} />);
    expect(mockProfileStreakBadgeDisplayed).toHaveBeenCalledTimes(1);
    rerender(<StreakBadge currentWinStreak={4} />);
    expect(mockProfileStreakBadgeDisplayed).toHaveBeenCalledTimes(2);
    rerender(<StreakBadge currentWinStreak={5} />);
    expect(mockProfileStreakBadgeDisplayed).toHaveBeenCalledTimes(3);
  });

  it("does NOT double-fire across re-renders for the same streak length", () => {
    const { rerender } = render(<StreakBadge currentWinStreak={4} />);
    expect(mockProfileStreakBadgeDisplayed).toHaveBeenCalledTimes(1);
    rerender(<StreakBadge currentWinStreak={4} />);
    rerender(<StreakBadge currentWinStreak={4} />);
    expect(mockProfileStreakBadgeDisplayed).toHaveBeenCalledTimes(1);
  });
});
