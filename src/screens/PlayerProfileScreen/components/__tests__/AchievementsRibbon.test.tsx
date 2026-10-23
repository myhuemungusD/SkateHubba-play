import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AchievementsRibbon } from "../AchievementsRibbon";
import { ACHIEVEMENTS } from "../../../../constants/xp";

describe("AchievementsRibbon", () => {
  it("paints no locked tiles on the profile, only the unlocked count and a hint", () => {
    render(<AchievementsRibbon />);
    const ribbon = screen.getByTestId("achievements-ribbon");
    expect(within(ribbon).queryAllByRole("img")).toHaveLength(0);
    expect(screen.queryByTestId("lock-icon")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `0 of ${ACHIEVEMENTS.length} unlocked` })).toBeInTheDocument();
    expect(screen.getByText("Win games and post clips to unlock your first one.")).toBeInTheDocument();
  });

  it("lays lit tiles in a 4-col grid on mobile and 6 columns from the md breakpoint", () => {
    render(<AchievementsRibbon clipsPosted={1} />);
    const grid = screen.getByTestId("achievements-ribbon").querySelector("ul");
    expect(grid?.className).toContain("grid-cols-4");
    expect(grid?.className).toMatch(/md:grid-cols-6/);
  });

  it("drops the lock and names the tier when the doc is earned", () => {
    render(
      <AchievementsRibbon
        achievements={[{ id: "shutout_1", earnedAt: null, reason: "Win a game without taking a letter." }]}
      />,
    );
    expect(screen.getByRole("img", { name: /Shutout, Bronze, unlocked/ })).toBeInTheDocument();
    expect(screen.queryByTestId("lock-icon")).not.toBeInTheDocument();
  });

  it("opens every family, locks included, from the unlocked count and lights a clip tile from the counter", async () => {
    const user = userEvent.setup();
    render(<AchievementsRibbon clipsPosted={1} />);
    const ribbon = screen.getByTestId("achievements-ribbon");
    expect(within(ribbon).getAllByRole("img")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: `1 of ${ACHIEVEMENTS.length} unlocked` }));
    const dialog = screen.getByRole("dialog", { name: "All achievements" });
    expect(within(dialog).getByText("1,000 lands")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("img", { name: /Shutout, locked\. Win a game without taking a letter\./ }),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByTestId("lock-icon")).toHaveLength(ACHIEVEMENTS.length - 1);
    expect(within(dialog).getByRole("img", { name: /1 clip, Bronze, unlocked/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
