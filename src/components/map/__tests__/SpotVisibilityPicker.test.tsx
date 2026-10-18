import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SpotVisibilityPicker } from "../SpotVisibilityPicker";

describe("SpotVisibilityPicker", () => {
  it("marks the chosen option and reports changes", () => {
    const onChange = vi.fn();
    const onCrewText = vi.fn();
    render(<SpotVisibilityPicker visibility="crew" onChange={onChange} crewText="mike" onCrewText={onCrewText} />);
    expect(screen.getByRole("button", { name: "Crew only" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Only you and the skaters you add.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Public" }));
    expect(onChange).toHaveBeenCalledWith("public");
    fireEvent.change(screen.getByLabelText("Crew usernames"), { target: { value: "mike, jason" } });
    expect(onCrewText).toHaveBeenCalledWith("mike, jason");
  });
});
