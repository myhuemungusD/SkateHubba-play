import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LevelChip } from "../LevelChip";

describe("LevelChip", () => {
  it("renders the caller-supplied level", () => {
    render(<LevelChip level={1} />);
    expect(screen.getByText("L1")).toBeInTheDocument();
  });

  it("renders a higher caller-supplied level verbatim", () => {
    render(<LevelChip level={27} />);
    expect(screen.getByText("L27")).toBeInTheDocument();
  });

  it("clamps levels above 30 to the 30 maximum", () => {
    render(<LevelChip level={9999} />);
    expect(screen.getByText("L30")).toBeInTheDocument();
  });

  it("clamps levels below 1 (or NaN) to the 1 minimum", () => {
    render(<LevelChip level={0} />);
    expect(screen.getByText("L1")).toBeInTheDocument();
  });

  it("defaults to L1 when the prop is omitted", () => {
    render(<LevelChip />);
    expect(screen.getByText("L1")).toBeInTheDocument();
  });

  it("uses verbose aria-label so screen readers announce the level", () => {
    render(<LevelChip level={5} />);
    expect(screen.getByLabelText("Level 5")).toBeInTheDocument();
  });

  it("exposes role=img so SR pickers identify it as an icon-style chip", () => {
    render(<LevelChip level={12} />);
    expect(screen.getByRole("img", { name: "Level 12" })).toBeInTheDocument();
  });
});
