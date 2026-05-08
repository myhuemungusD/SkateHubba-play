import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LevelChip } from "../LevelChip";

describe("LevelChip", () => {
  it("renders the level number prefixed with L", () => {
    render(<LevelChip level={1} />);
    expect(screen.getByText("L1")).toBeInTheDocument();
  });

  it("renders higher levels", () => {
    render(<LevelChip level={27} />);
    expect(screen.getByText("L27")).toBeInTheDocument();
  });

  it("uses verbose aria-label so screen readers announce 'Level N'", () => {
    render(<LevelChip level={5} />);
    expect(screen.getByLabelText("Level 5")).toBeInTheDocument();
  });

  it("exposes role=img so SR pickers identify it as an icon-style chip", () => {
    render(<LevelChip level={12} />);
    expect(screen.getByRole("img", { name: "Level 12" })).toBeInTheDocument();
  });
});
