import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BadgesRow } from "../BadgesRow";
import type { Achievement } from "../../services/achievements";

function badge(id: string, overrides?: Partial<Achievement>): Achievement {
  return { id, earnedAt: null, reason: null, ...overrides };
}

describe("BadgesRow", () => {
  it("renders nothing when the player has no achievements", () => {
    const { container } = render(<BadgesRow achievements={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a chip per known badge with its display label", () => {
    render(<BadgesRow achievements={[badge("century"), badge("club150"), badge("pioneer")]} />);
    expect(screen.getByTestId("badges-row")).toBeInTheDocument();
    expect(screen.getByText("CENTURY")).toBeInTheDocument();
    expect(screen.getByText("150 CLUB")).toBeInTheDocument();
    expect(screen.getByText("PIONEER")).toBeInTheDocument();
  });

  it("skips ids this build does not recognise rather than rendering a raw key", () => {
    render(<BadgesRow achievements={[badge("og"), badge("future_badge_v9")]} />);
    expect(screen.getByTestId("badge-og")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-future_badge_v9")).not.toBeInTheDocument();
    expect(screen.queryByText(/future_badge_v9/i)).not.toBeInTheDocument();
  });

  it("renders nothing when every id is unknown", () => {
    const { container } = render(<BadgesRow achievements={[badge("nope"), badge("also_nope")]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels each chip with name, earn condition, and the earned month", () => {
    render(<BadgesRow achievements={[badge("streak10", { earnedAt: new Date("2026-01-15T12:00:00Z") })]} />);
    expect(screen.getByRole("img", { name: "Streak — 10 wins in a row. Earned Jan 2026" })).toBeInTheDocument();
  });

  it("omits the earned date from the label when the grant has no timestamp", () => {
    render(<BadgesRow achievements={[badge("century")]} />);
    expect(screen.getByRole("img", { name: "Century — Complete 100 games" })).toBeInTheDocument();
  });

  it("uses the grant reason as the tooltip when present, falling back to the description", () => {
    render(<BadgesRow achievements={[badge("og", { reason: "Joined in the founding year" }), badge("club150")]} />);
    expect(screen.getByTestId("badge-og")).toHaveAttribute("title", "Joined in the founding year");
    expect(screen.getByTestId("badge-club150")).toHaveAttribute("title", "Win 150 games");
  });

  it("keeps chips at the 44px touch-target floor", () => {
    render(<BadgesRow achievements={[badge("pioneer")]} />);
    const chip = screen.getByTestId("badge-pioneer").querySelector("span");
    expect(chip?.className).toContain("h-11");
    expect(chip?.className).toContain("w-11");
  });
});
