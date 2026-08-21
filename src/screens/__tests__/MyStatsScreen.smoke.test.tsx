import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyStatsScreen } from "../MyStatsScreen";
import type { UserProfile } from "../../services/users";

/**
 * Smoke coverage for the owner-only analytics screen.
 *
 * The own-profile gate lives on the route (App.tsx renders this only for
 * `auth.activeProfile`), so it is pinned at the route level in
 * src/__tests__/smoke-deeplink.test.tsx. What is asserted here is that the
 * screen reads the counters it is handed, degrades a legacy doc to zeros and
 * dashes rather than NaN, and surfaces the negative counters the public
 * profile deliberately hides.
 */

function buildProfile(overrides?: Partial<UserProfile>): UserProfile {
  return { uid: "me", username: "viewer", stance: "regular", createdAt: null, ...overrides };
}

const HOUR_MS = 3_600_000;

describe("MyStatsScreen", () => {
  it("renders every section for a fully populated profile", () => {
    const profile = buildProfile({
      gamesPlayed: 10,
      forfeitLosses: 2,
      gamesWithDuration: 10,
      totalGameDurationMs: 10 * 5 * HOUR_MS,
      tricksLanded: 30,
      tricksFailed: 10,
      lettersGiven: 12,
      lettersTaken: 8,
      cleanWins: 3,
      comebackWins: 1,
      gamesJudged: 4,
      turnsJudged: 17,
    });
    render(<MyStatsScreen profile={profile} onBack={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "My Stats" })).toBeInTheDocument();
    expect(screen.getByTestId("my-stats-games-row")).toHaveTextContent("5h");
    expect(screen.getByTestId("my-stats-tricks-row")).toHaveTextContent("75%");
    expect(screen.getByTestId("my-stats-letters-row")).toHaveTextContent("0.8");
    expect(screen.getByTestId("my-stats-wins-row")).toHaveTextContent("Comeback Wins");
    expect(screen.getByTestId("my-stats-judging-row")).toHaveTextContent("17");
  });

  it("surfaces the abandon count the public profile withholds", () => {
    const profile = buildProfile({ gamesPlayed: 10, forfeitLosses: 2 });
    render(<MyStatsScreen profile={profile} onBack={vi.fn()} />);
    const games = screen.getByTestId("my-stats-games-row");
    expect(games).toHaveTextContent("Games Abandoned");
    expect(games).toHaveTextContent("2");
  });

  it("reads a legacy profile as zeros and dashes, never NaN", () => {
    render(<MyStatsScreen profile={buildProfile()} onBack={vi.fn()} />);
    expect(screen.getByText("Finish a game and these start filling in.")).toBeInTheDocument();
    // Avg game length, letters-per-game and consistency all lack a
    // denominator here — each renders the unavailable dash.
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("dashes the average game length when no game contributed a duration", () => {
    // A doc with games played and a summed duration but no gamesWithDuration
    // counter (closed out before it shipped) must not average over gamesPlayed.
    const profile = buildProfile({ gamesPlayed: 10, totalGameDurationMs: 10 * 5 * HOUR_MS });
    render(<MyStatsScreen profile={profile} onBack={vi.fn()} />);
    expect(screen.getByTestId("my-stats-games-row")).not.toHaveTextContent("5h");
    expect(screen.getByTestId("my-stats-games-row")).toHaveTextContent("—");
  });

  it("hides the empty-state hint once a game has been played", () => {
    render(<MyStatsScreen profile={buildProfile({ gamesPlayed: 1 })} onBack={vi.fn()} />);
    expect(screen.queryByText("Finish a game and these start filling in.")).not.toBeInTheDocument();
  });

  it("calls onBack from the header control", async () => {
    const onBack = vi.fn();
    render(<MyStatsScreen profile={buildProfile()} onBack={onBack} />);
    await userEvent.click(screen.getByLabelText("Back to profile"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
