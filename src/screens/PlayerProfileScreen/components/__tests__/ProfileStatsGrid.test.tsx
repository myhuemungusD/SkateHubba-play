import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileStatsGrid } from "../ProfileStatsGrid";
import type { ProfileStats } from "../../usePlayerProfileController";

/**
 * Focused coverage for the win-streak tiles activated once the server-side
 * `currentWinStreak` / `bestWinStreak` counters shipped, plus the category
 * sections (GAME STYLE, COMMUNITY, last-10 form guide) added with the stats
 * overhaul. Render states for the rest of the grid are asserted through
 * PlayerProfileScreen's specs.
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
    cleanWins: 0,
    comebackWins: 0,
    challengeCompletion: null,
    recentResults: [],
    gamesJudged: 0,
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

describe("ProfileStatsGrid category sections", () => {
  it("groups the tiles under the public category headings", () => {
    render(<ProfileStatsGrid stats={buildStats()} isOwnProfile hasCompletedGames={false} />);
    expect(screen.getByText("RECORD")).toBeInTheDocument();
    expect(screen.getByText("GAME STYLE")).toBeInTheDocument();
    expect(screen.getByText("LETTERS")).toBeInTheDocument();
    expect(screen.getByText("COMMUNITY")).toBeInTheDocument();
  });

  it("renders the game-style tiles from their server counters", () => {
    const stats = buildStats({ cleanWins: 7, comebackWins: 2, challengeCompletion: 92 });
    render(<ProfileStatsGrid stats={stats} isOwnProfile hasCompletedGames={false} />);
    expect(screen.getByLabelText("Clean wins: 7")).toBeInTheDocument();
    expect(screen.getByLabelText("Comeback wins: 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Games finished: 92 percent")).toBeInTheDocument();
  });

  it("explains the completion rate instead of printing a bare dash with no games", () => {
    render(<ProfileStatsGrid stats={buildStats()} isOwnProfile hasCompletedGames={false} />);
    expect(screen.getByLabelText("Games finished: no completed games yet")).toBeInTheDocument();
  });

  it("puts judging credit in the community section", () => {
    render(<ProfileStatsGrid stats={buildStats({ gamesJudged: 4 })} isOwnProfile hasCompletedGames={false} />);
    expect(screen.getByTestId("judging-row")).toHaveTextContent("Games Judged");
    expect(screen.getByLabelText("Games judged: 4")).toBeInTheDocument();
  });

  it("never surfaces the negative counters publicly", () => {
    // forfeitLosses and tricksFailed are owner-only (My Stats). A public
    // abandon count invites both gaming and shaming, so the grid has no
    // shape for them at all.
    render(<ProfileStatsGrid stats={buildStats({ challengeCompletion: 50 })} isOwnProfile hasCompletedGames />);
    expect(screen.queryByText(/abandon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/forfeit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
  });

  it("reports the tapped game-style tile names to the telemetry handler", async () => {
    const onTileTap = vi.fn();
    const stats = buildStats({ cleanWins: 1, comebackWins: 1, challengeCompletion: 100 });
    render(<ProfileStatsGrid stats={stats} isOwnProfile hasCompletedGames={false} onTileTap={onTileTap} />);
    await userEvent.click(screen.getByLabelText("Clean wins: 1"));
    await userEvent.click(screen.getByLabelText("Comeback wins: 1"));
    await userEvent.click(screen.getByLabelText("Games finished: 100 percent"));
    expect(onTileTap.mock.calls.map(([name]) => name)).toEqual(["cleanWins", "comebackWins", "challengeCompletion"]);
  });
});

describe("ProfileStatsGrid last-10 form guide", () => {
  it("omits the pip row entirely for a profile with no recorded run", () => {
    render(<ProfileStatsGrid stats={buildStats()} isOwnProfile hasCompletedGames={false} />);
    expect(screen.queryByTestId("last-ten-row")).not.toBeInTheDocument();
  });

  it("renders one pip per result with a summarising label", () => {
    const stats = buildStats({ recentResults: ["W", "L", "W", "W"] });
    render(<ProfileStatsGrid stats={stats} isOwnProfile hasCompletedGames />);
    // Singular/plural both exercised here: 3 wins, 1 loss.
    const pips = screen.getByRole("img", { name: "Last 4 games: 3 wins, 1 loss" });
    expect(pips.childElementCount).toBe(4);
    expect(screen.getByTestId("last-ten-row")).toHaveTextContent("Last 4 — oldest first");
  });

  it("pluralises a single win and counts a full run of losses", () => {
    const stats = buildStats({ recentResults: ["L", "L", "W"] });
    render(<ProfileStatsGrid stats={stats} isOwnProfile hasCompletedGames />);
    expect(screen.getByRole("img", { name: "Last 3 games: 1 win, 2 losses" })).toBeInTheDocument();
  });
});
