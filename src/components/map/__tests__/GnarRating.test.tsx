import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GnarRating } from "../GnarRating";
import { BustRisk } from "../BustRisk";

// Both are thin RatingMeter wrappers (RatingMeter.test covers the meter);
// these pin the label, unit and color each one passes in.
describe("GnarRating", () => {
  it("reads as a gnar rating in flames, filled orange", () => {
    render(<GnarRating value={3} />);
    expect(screen.getByRole("group", { name: "Gnar rating: 3 of 5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 flame" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3 flames" }).querySelector("svg")).toHaveAttribute("fill", "#ff6b00");
  });
});

describe("BustRisk", () => {
  it("reads as bust risk in shields, filled red", () => {
    render(<BustRisk value={2} size="sm" />);
    expect(screen.getByRole("group", { name: "Bust risk: 2 of 5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 shield" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 shields" }).querySelector("svg")).toHaveAttribute("fill", "#EF4444");
  });
});
