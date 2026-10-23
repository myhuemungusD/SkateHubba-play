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

/** Everything below the headline sits behind the "All stats" disclosure. */
async function openAllStats() {
  await userEvent.click(screen.getByRole("button", { name: "All stats" }));
}

describe("ProfileStatsGrid headline and disclosure", () => {
  it("shows four headline numbers and keeps the rest behind All stats", async () => {
    render(<ProfileStatsGrid stats={buildStats({ wins: 9, losses: 3 })} isOwnProfile hasCompletedGames={false} />);
    const brag = screen.getByTestId("brag-row");
    expect(brag.children).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Wins 9" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Losses 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Win % not enough games yet, 5 needed" })).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "All stats" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("detail-row")).not.toBeInTheDocument();
    expect(screen.queryByText("COMMUNITY")).not.toBeInTheDocument();

    await openAllStats();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("detail-row")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByTestId("detail-row")).not.toBeInTheDocument();
  });

  it("speaks the win rate in percent once the floor is met", () => {
    render(<ProfileStatsGrid stats={buildStats({ winRate: 62 })} isOwnProfile hasCompletedGames={false} />);
    expect(screen.getByRole("button", { name: "Win % 62 percent" })).toBeInTheDocument();
  });

  it("lights the streak tile with a flame from two wins, replacing the old banner", () => {
    const { rerender } = render(
      <ProfileStatsGrid stats={buildStats({ currentWinStreak: 1 })} isOwnProfile hasCompletedGames={false} />,
    );
    expect(screen.getByRole("button", { name: "Streak 1" })).toBeInTheDocument();
    rerender(<ProfileStatsGrid stats={buildStats({ currentWinStreak: 4 })} isOwnProfile hasCompletedGames={false} />);
    expect(screen.getByRole("button", { name: "Streak 4 game win streak" }).querySelector("svg")).not.toBeNull();
  });

  it("shows head-to-head tiles on someone else's profile once you've played", () => {
    render(
      <ProfileStatsGrid
        stats={buildStats({ vsYouWins: 2, vsYouLosses: 1, vsYouTotal: 3 })}
        isOwnProfile={false}
        hasCompletedGames
      />,
    );
    expect(screen.getByTestId("vs-you-row")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Games 3" })).toBeInTheDocument();
  });
});

describe("ProfileStatsGrid streak tiles", () => {
  it("keeps the best streak and total in the All stats detail row", async () => {
    render(<ProfileStatsGrid stats={buildStats()} isOwnProfile hasCompletedGames={false} />);
    await openAllStats();
    const detailRow = screen.getByTestId("detail-row");
    expect(detailRow).toHaveTextContent("Best Streak");
    expect(detailRow).toHaveTextContent("Total Games");
  });

  it("labels each streak tile with its final value, not the count-up frame", async () => {
    render(
      <ProfileStatsGrid
        stats={buildStats({ bestWinStreak: 12, currentWinStreak: 3 })}
        isOwnProfile
        hasCompletedGames={false}
      />,
    );
    await openAllStats();
    expect(screen.getByRole("button", { name: "Best Streak 12" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Streak 3 game win streak" })).toBeInTheDocument();
  });

  it("reads 0 for legacy profiles predating the streak counters", async () => {
    render(<ProfileStatsGrid stats={buildStats()} isOwnProfile hasCompletedGames={false} />);
    await openAllStats();
    expect(screen.getByRole("button", { name: "Best Streak 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Streak 0" })).toBeInTheDocument();
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
    await openAllStats();
    await userEvent.click(screen.getByRole("button", { name: "Best Streak 5" }));
    await userEvent.click(screen.getByRole("button", { name: "Streak 5 game win streak" }));
    expect(onTileTap).toHaveBeenNthCalledWith(1, "bestStreak");
    expect(onTileTap).toHaveBeenNthCalledWith(2, "currentStreak");
  });
});

describe("ProfileStatsGrid letter tiles", () => {
  it("renders both letter tiles in the letters row", async () => {
    render(<ProfileStatsGrid stats={buildStats()} isOwnProfile hasCompletedGames={false} />);
    await openAllStats();
    const lettersRow = screen.getByTestId("letters-row");
    expect(lettersRow).toHaveTextContent("Letters Given");
    expect(lettersRow).toHaveTextContent("Letters Taken");
  });

  it("labels each letter tile with its final value, not the count-up frame", async () => {
    render(
      <ProfileStatsGrid stats={buildStats({ lettersGiven: 17, lettersTaken: 6 })} isOwnProfile hasCompletedGames />,
    );
    await openAllStats();
    expect(screen.getByRole("button", { name: "Letters Given 17" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Letters Taken 6" })).toBeInTheDocument();
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
    await openAllStats();
    await userEvent.click(screen.getByRole("button", { name: "Letters Given 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Letters Taken 3" }));
    expect(onTileTap).toHaveBeenNthCalledWith(1, "lettersGiven");
    expect(onTileTap).toHaveBeenNthCalledWith(2, "lettersTaken");
  });
});

describe("ProfileStatsGrid category sections", () => {
  it("groups the All stats tiles under the public category headings", async () => {
    render(<ProfileStatsGrid stats={buildStats()} isOwnProfile hasCompletedGames={false} />);
    await openAllStats();
    expect(screen.getByText("GAME STYLE")).toBeInTheDocument();
    expect(screen.getByText("LETTERS")).toBeInTheDocument();
    expect(screen.getByText("COMMUNITY")).toBeInTheDocument();
  });

  it("renders the game-style tiles from their server counters", async () => {
    const stats = buildStats({ cleanWins: 7, comebackWins: 2, challengeCompletion: 92 });
    render(<ProfileStatsGrid stats={stats} isOwnProfile hasCompletedGames={false} />);
    await openAllStats();
    expect(screen.getByRole("button", { name: "Clean Wins 7" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comeback Wins 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Games Finished 92 percent" })).toBeInTheDocument();
  });

  it("explains the completion rate instead of printing a bare dash with no games", async () => {
    render(<ProfileStatsGrid stats={buildStats()} isOwnProfile hasCompletedGames={false} />);
    await openAllStats();
    expect(screen.getByRole("button", { name: "Games Finished no completed games yet" })).toBeInTheDocument();
  });

  it("puts judging credit in the community section", async () => {
    render(<ProfileStatsGrid stats={buildStats({ gamesJudged: 4 })} isOwnProfile hasCompletedGames={false} />);
    await openAllStats();
    expect(screen.getByTestId("judging-row")).toHaveTextContent("Games Judged");
    expect(screen.getByRole("button", { name: "Games Judged 4" })).toBeInTheDocument();
  });

  it("never surfaces the negative counters publicly", async () => {
    // forfeitLosses and tricksFailed are owner-only (My Stats). A public
    // abandon count invites both gaming and shaming, so the grid has no
    // shape for them at all.
    render(<ProfileStatsGrid stats={buildStats({ challengeCompletion: 50 })} isOwnProfile hasCompletedGames />);
    await openAllStats();
    expect(screen.queryByText(/abandon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/forfeit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
  });

  it("reports the tapped game-style tile names to the telemetry handler", async () => {
    const onTileTap = vi.fn();
    const stats = buildStats({ cleanWins: 1, comebackWins: 1, challengeCompletion: 100 });
    render(<ProfileStatsGrid stats={stats} isOwnProfile hasCompletedGames={false} onTileTap={onTileTap} />);
    await openAllStats();
    await userEvent.click(screen.getByRole("button", { name: "Clean Wins 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Comeback Wins 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Games Finished 100 percent" }));
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
