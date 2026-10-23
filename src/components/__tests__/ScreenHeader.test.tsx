import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
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

  it("lets a screen own its exit with onBack", async () => {
    const onBack = vi.fn();
    render(
      <MemoryRouter>
        <ScreenHeader title="Settings" fallback="/lobby" label="Back to lobby" onBack={onBack} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Back to lobby" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
