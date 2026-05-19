import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddedSpotsPlaceholder } from "../AddedSpotsPlaceholder";

describe("AddedSpotsPlaceholder", () => {
  it("renders the empty-state copy", () => {
    render(<AddedSpotsPlaceholder />);
    expect(screen.getByTestId("added-spots-placeholder")).toBeInTheDocument();
    expect(screen.getByText(/spots you've added/i)).toBeInTheDocument();
    expect(screen.getByText(/Add spots to see them here/i)).toBeInTheDocument();
  });

  it("renders the ADD A SPOT button with min-h-[44px] for Apple HIG", () => {
    render(<AddedSpotsPlaceholder onAddSpot={() => {}} />);
    const button = screen.getByRole("button", { name: /add a spot/i });
    expect(button).toBeInTheDocument();
    expect(button.className).toContain("min-h-[44px]");
  });

  it("disables the button when no onAddSpot callback is provided", () => {
    render(<AddedSpotsPlaceholder />);
    const button = screen.getByRole("button", { name: /add a spot/i });
    expect(button).toBeDisabled();
  });

  it("invokes onAddSpot when the button is tapped", async () => {
    const user = userEvent.setup();
    const onAddSpot = vi.fn();
    render(<AddedSpotsPlaceholder onAddSpot={onAddSpot} />);
    await user.click(screen.getByRole("button", { name: /add a spot/i }));
    expect(onAddSpot).toHaveBeenCalledTimes(1);
  });
});
