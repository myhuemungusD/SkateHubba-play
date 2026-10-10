import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LevelChip } from "../LevelChip";

describe("LevelChip", () => {
  it("renders level 1 when no level is passed", () => {
    render(<LevelChip />);
    expect(screen.getByText("L1")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Level 1" })).toBeInTheDocument();
  });

  it("renders the caller-supplied level", () => {
    render(<LevelChip level={27} />);
    expect(screen.getByText("L27")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Level 27" })).toBeInTheDocument();
  });

  it("clamps to 1..50", () => {
    const { rerender } = render(<LevelChip level={0} />);
    expect(screen.getByText("L1")).toBeInTheDocument();
    rerender(<LevelChip level={80} />);
    expect(screen.getByText("L50")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Level 50" })).toBeInTheDocument();
  });
});
