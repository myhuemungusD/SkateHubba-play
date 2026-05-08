import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AchievementsRibbon } from "../AchievementsRibbon";

describe("AchievementsRibbon", () => {
  it("renders 12 placeholder tiles", () => {
    render(<AchievementsRibbon />);
    const ribbon = screen.getByTestId("achievements-ribbon");
    const tiles = within(ribbon).getAllByLabelText("Locked achievement");
    expect(tiles).toHaveLength(12);
  });

  it("each tile has a lock icon (color-blind safe per audit D2)", () => {
    render(<AchievementsRibbon />);
    const lockIcons = screen.getAllByTestId("lock-icon");
    expect(lockIcons).toHaveLength(12);
  });

  it("each tile has a text label (??? placeholder) so locked state isn't color-only", () => {
    render(<AchievementsRibbon />);
    const labels = screen.getAllByText("???");
    expect(labels).toHaveLength(12);
  });

  it("renders a 4-col grid on mobile via Tailwind classes", () => {
    render(<AchievementsRibbon />);
    const ribbon = screen.getByTestId("achievements-ribbon");
    const grid = ribbon.querySelector("ul");
    expect(grid).not.toBeNull();
    expect(grid?.className).toContain("grid-cols-4");
  });

  it("scales to 6 columns on tablet/desktop via md: breakpoint", () => {
    render(<AchievementsRibbon />);
    const grid = screen.getByTestId("achievements-ribbon").querySelector("ul");
    expect(grid?.className).toMatch(/md:grid-cols-6/);
  });

  it("forcePlaceholder is accepted (PR-F handoff prop)", () => {
    const { container } = render(<AchievementsRibbon forcePlaceholder />);
    expect(container.querySelectorAll('[data-testid^="achievement-tile-"]')).toHaveLength(12);
  });
});
