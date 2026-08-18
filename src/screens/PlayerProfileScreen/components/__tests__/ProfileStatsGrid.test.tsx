import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileStatsGrid } from "../ProfileStatsGrid";
import type { ProfileStats } from "../../usePlayerProfileController";

/**
 * Focused coverage for the win-streak tiles activated once the server-side
 * `currentWinStreak` / `bestWinStreak` counters shipped. Render states for the
 * rest of the grid are asserted through PlayerProfileScreen's specs.
 */

function buildStats(overrides?: Partial<ProfileStats>): ProfileStats {
  return {
    wins: 0,
    losses: 0,
    total: 0,
    winRate: null,
    currentWinStreak: 0,
    bestWinStreak: 0,
    vsYouWins: 0,
    vsYouLosses: 0,
    vsYouTotal: 0,
    tricksDisputed: 0,
    disputesRaised: 0,
    disputesRight: 0,
    disputesWrong: 0,
    lettersGiven: 0,
    lettersTaken: 0,
    ...overrides,
  };
}

describe("ProfileStatsGrid streak tiles", () => {
  it("renders both streak tiles in the detail row", () => {
    render(<ProfileStatsGrid stats={buildStats()} isOwnProfile hasCompletedGames={false} />);
    const detailRow = screen.getByTestId("detail-row");
    expect(detailRow).toHaveTextContent("Best Streak");
    expect(detailRow).toHaveTextContent("Current Streak");
  });

  it("labels each streak tile with its final value, not the count-up frame", () => {
    render(
      <ProfileStatsGrid
        stats={buildStats({ bestWinStreak: 12, currentWinStreak: 3 })}
        isOwnProfile
        hasCompletedGames={false}
      />,
    );
    expect(screen.getByLabelText("Best win streak: 12")).toBeInTheDocument();
    expect(screen.getByLabelText("Current win streak: 3")).toBeInTheDocument();
  });

  it("reads 0 for legacy profiles predating the streak counters", () => {
    render(<ProfileStatsGrid stats={buildStats()} isOwnProfile hasCompletedGames={false} />);
    expect(screen.getByLabelText("Best win streak: 0")).toBeInTheDocument();
    expect(screen.getByLabelText("Current win streak: 0")).toBeInTheDocument();
  });

  it("reports the tapped streak tile names to the telemetry handler", async () => {
    const onTileTap = vi.fn();
    render(
      <ProfileStatsGrid
        stats={buildStats({ bestWinStreak: 5, currentWinStreak: 5 })}
        isOwnProfile
        hasCompletedGames={false}
        onTileTap={onTileTap}
      />,
    );
    await userEvent.click(screen.getByLabelText("Best win streak: 5"));
    await userEvent.click(screen.getByLabelText("Current win streak: 5"));
    expect(onTileTap).toHaveBeenNthCalledWith(1, "bestStreak");
    expect(onTileTap).toHaveBeenNthCalledWith(2, "currentStreak");
  });
});

describe("ProfileStatsGrid letter tiles", () => {
  it("renders both letter tiles in the letters row", () => {
    render(<ProfileStatsGrid stats={buildStats()} isOwnProfile hasCompletedGames={false} />);
    const lettersRow = screen.getByTestId("letters-row");
    expect(lettersRow).toHaveTextContent("Letters Given");
    expect(lettersRow).toHaveTextContent("Letters Taken");
  });

  it("labels each letter tile with its final value, not the count-up frame", () => {
    render(
      <ProfileStatsGrid stats={buildStats({ lettersGiven: 17, lettersTaken: 6 })} isOwnProfile hasCompletedGames />,
    );
    expect(screen.getByLabelText("Letters given: 17")).toBeInTheDocument();
    expect(screen.getByLabelText("Letters taken: 6")).toBeInTheDocument();
  });

  it("reports the tapped letter tile names to the telemetry handler", async () => {
    const onTileTap = vi.fn();
    render(
      <ProfileStatsGrid
        stats={buildStats({ lettersGiven: 2, lettersTaken: 3 })}
        isOwnProfile
        hasCompletedGames={false}
        onTileTap={onTileTap}
      />,
    );
    await userEvent.click(screen.getByLabelText("Letters given: 2"));
    await userEvent.click(screen.getByLabelText("Letters taken: 3"));
    expect(onTileTap).toHaveBeenNthCalledWith(1, "lettersGiven");
    expect(onTileTap).toHaveBeenNthCalledWith(2, "lettersTaken");
  });
});
