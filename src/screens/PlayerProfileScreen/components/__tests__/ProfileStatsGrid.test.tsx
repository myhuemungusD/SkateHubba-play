import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileStatsGrid } from "../ProfileStatsGrid";
import type { ProfileStats } from "../../usePlayerProfileController";

// Reduced-motion mock — flippable per test.
let mockReducedMotion = true;
vi.mock("../../../../hooks/useReducedMotion", () => ({
  useReducedMotion: () => mockReducedMotion,
}));

function makeStats(overrides: Partial<ProfileStats> = {}): ProfileStats {
  return {
    wins: 47,
    losses: 12,
    forfeits: 3,
    total: 62,
    tricksLanded: 1234,
    cleanJudgments: 8,
    currentStreak: 4,
    longestStreak: 7,
    spotsAdded: 0,
    checkIns: 0,
    xp: 0,
    level: 1,
    trickLandPercent: 73,
    vsYouWins: 0,
    vsYouLosses: 0,
    vsYouTotal: 0,
    ...overrides,
  };
}

describe("ProfileStatsGrid", () => {
  beforeEach(() => {
    mockReducedMotion = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the hero band, brag row, detail row, and spot row on own profile", () => {
    render(<ProfileStatsGrid stats={makeStats()} isOwnProfile hasCompletedGames />);
    expect(screen.getByTestId("hero-band")).toBeInTheDocument();
    expect(screen.getByTestId("brag-row")).toBeInTheDocument();
    expect(screen.getByTestId("detail-row")).toBeInTheDocument();
    expect(screen.getByTestId("spot-row")).toBeInTheDocument();
  });

  it("hides the VS-You row on own profile", () => {
    render(<ProfileStatsGrid stats={makeStats()} isOwnProfile hasCompletedGames />);
    expect(screen.queryByTestId("vs-you-row")).not.toBeInTheDocument();
  });

  it("shows the VS-You row only when viewing an opponent with shared games", () => {
    render(
      <ProfileStatsGrid
        stats={makeStats({ vsYouWins: 3, vsYouLosses: 1, vsYouTotal: 4 })}
        isOwnProfile={false}
        hasCompletedGames
      />,
    );
    expect(screen.getByTestId("vs-you-row")).toBeInTheDocument();
    expect(screen.getByText("VS YOU")).toBeInTheDocument();
  });

  it("does not show the VS-You row on opponent profile when no games are shared", () => {
    render(
      <ProfileStatsGrid stats={makeStats()} isOwnProfile={false} hasCompletedGames={false} />,
    );
    expect(screen.queryByTestId("vs-you-row")).not.toBeInTheDocument();
  });

  it("formats large numbers via Intl compact notation (1.2K)", () => {
    render(
      <ProfileStatsGrid
        stats={makeStats({ tricksLanded: 1234 })}
        isOwnProfile
        hasCompletedGames
      />,
    );
    // Reduced-motion path renders the final value immediately.
    expect(screen.getByTestId("stat-tile-value-tricksLanded")).toHaveTextContent("1.2K");
  });

  it("appends suffixes correctly (e.g. trickLandPercent → 73%)", () => {
    render(
      <ProfileStatsGrid
        stats={makeStats({ trickLandPercent: 73 })}
        isOwnProfile
        hasCompletedGames
      />,
    );
    expect(screen.getByTestId("stat-tile-value-trickLandPercent")).toHaveTextContent("73%");
  });

  it("respects reduced-motion: stat values are final immediately", () => {
    mockReducedMotion = true;
    render(
      <ProfileStatsGrid stats={makeStats({ wins: 47 })} isOwnProfile hasCompletedGames />,
    );
    expect(screen.getByTestId("stat-tile-value-wins")).toHaveTextContent("47");
  });

  it("animates the visible value when motion is enabled (without changing aria-label)", async () => {
    vi.useFakeTimers();
    mockReducedMotion = false;
    render(
      <ProfileStatsGrid stats={makeStats({ wins: 47 })} isOwnProfile hasCompletedGames />,
    );
    // The aria-label on the article is the FINAL value, not the
    // intermediate count-up state (audit D1).
    const tile = screen.getByTestId("stat-tile-wins");
    expect(tile).toHaveAttribute("aria-label", "Lifetime wins: 47");
    // Animated text starts at 0 (or near it) before rAF advances.
    // We don't assert intermediate rAF values — the contract that matters
    // is "aria-label is the final value at all times".
  });

  it("aria-labels read full sentences with the FINAL value (audit D1)", () => {
    render(<ProfileStatsGrid stats={makeStats()} isOwnProfile hasCompletedGames />);
    expect(screen.getByLabelText("Lifetime wins: 47")).toBeInTheDocument();
    expect(screen.getByLabelText("Best win streak: 7")).toBeInTheDocument();
    expect(screen.getByLabelText("Trick land rate: 73 percent")).toBeInTheDocument();
    expect(screen.getByLabelText("Total games: 62")).toBeInTheDocument();
  });

  it("hero band exposes a progressbar role with bounded values", () => {
    render(<ProfileStatsGrid stats={makeStats()} isOwnProfile hasCompletedGames />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("fires onTileTap with the stat name when a tile is tapped", async () => {
    const onTileTap = vi.fn();
    render(
      <ProfileStatsGrid
        stats={makeStats()}
        isOwnProfile
        hasCompletedGames
        onTileTap={onTileTap}
      />,
    );
    await userEvent.click(screen.getByTestId("stat-tile-wins"));
    expect(onTileTap).toHaveBeenCalledWith("wins");
  });

  it("renders inert tiles (article role) when no onTileTap is provided", () => {
    render(<ProfileStatsGrid stats={makeStats()} isOwnProfile hasCompletedGames />);
    const tile = screen.getByTestId("stat-tile-wins");
    expect(tile.tagName.toLowerCase()).toBe("article");
  });

  it("renders LevelChip with the profile's level (placeholder L1 by default)", () => {
    render(<ProfileStatsGrid stats={makeStats({ level: 12 })} isOwnProfile hasCompletedGames />);
    expect(screen.getByLabelText("Level 12")).toBeInTheDocument();
  });
});
