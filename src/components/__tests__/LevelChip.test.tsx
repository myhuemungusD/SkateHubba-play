import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LevelChip } from "../LevelChip";

describe("LevelChip", () => {
  it("renders the L1 placeholder regardless of caller-supplied level", () => {
    render(<LevelChip level={1} />);
    expect(screen.getByText("L1")).toBeInTheDocument();
  });

  it("ignores higher caller-supplied levels until the level counter ships", () => {
    render(<LevelChip level={27} />);
    expect(screen.getByText("L1")).toBeInTheDocument();
  });

  it("uses verbose aria-label so screen readers announce 'Level 1'", () => {
    render(<LevelChip level={5} />);
    expect(screen.getByLabelText("Level 1")).toBeInTheDocument();
  });

  it("exposes role=img so SR pickers identify it as an icon-style chip", () => {
    render(<LevelChip level={12} />);
    expect(screen.getByRole("img", { name: "Level 1" })).toBeInTheDocument();
  });
});
