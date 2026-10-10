import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AchievementsRibbon } from "../AchievementsRibbon";

describe("AchievementsRibbon", () => {
  it("renders the 12 bronze tiles with their short names and locks", () => {
    render(<AchievementsRibbon />);
    const ribbon = screen.getByTestId("achievements-ribbon");
    const tiles = within(ribbon).getAllByRole("img");
    expect(tiles).toHaveLength(12);
    expect(screen.getByText("10 wins")).toBeInTheDocument();
    expect(screen.getByText("Shutout")).toBeInTheDocument();
    expect(screen.getAllByTestId("lock-icon")).toHaveLength(12);
    expect(
      screen.getByRole("img", { name: /Shutout, locked\. Win a game without taking a letter\./ }),
    ).toBeInTheDocument();
  });

  it("renders a 4-col grid on mobile and 6 columns from the md breakpoint", () => {
    render(<AchievementsRibbon />);
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
    expect(screen.getAllByTestId("lock-icon")).toHaveLength(11);
  });

  it("opens every family from See all and lights a clip tile from the counter", async () => {
    const user = userEvent.setup();
    render(<AchievementsRibbon clipsPosted={1} />);
    await user.click(screen.getByRole("button", { name: "See all" }));
    const dialog = screen.getByRole("dialog", { name: "All achievements" });
    expect(within(dialog).getByText("1,000 lands")).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: /1 clip, Bronze, unlocked/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
