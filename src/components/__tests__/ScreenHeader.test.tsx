import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ScreenHeader } from "../ScreenHeader";

describe("ScreenHeader", () => {
  it("renders the title, a labelled back button and an optional right slot", () => {
    render(
      <MemoryRouter>
        <ScreenHeader title="Roll Dice" fallback="/lobby" label="Back to home" right={<span>extra</span>} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Roll Dice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to home" })).toHaveClass("min-h-11", "min-w-11");
    expect(screen.getByText("extra")).toBeInTheDocument();
  });
});
