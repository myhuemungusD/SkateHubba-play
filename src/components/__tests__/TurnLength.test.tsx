import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TurnLengthChip } from "../TurnLengthChip";
import { TurnLengthPicker } from "../TurnLengthPicker";

describe("TurnLengthChip", () => {
  it("renders nothing for a legacy game with no turn length", () => {
    const { container } = render(<TurnLengthChip hours={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the game's turn length", () => {
    render(<TurnLengthChip hours={72} className="mt-3" />);
    expect(screen.getByTestId("turn-length-chip")).toHaveTextContent("3-day turns");
  });
});

describe("TurnLengthPicker", () => {
  it("marks the current value and reports a new pick", async () => {
    const onChange = vi.fn();
    render(<TurnLengthPicker value={24} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "24 hours" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "3 days" })).toHaveAttribute("aria-checked", "false");
    await userEvent.click(screen.getByRole("radio", { name: "3 days" }));
    expect(onChange).toHaveBeenCalledWith(72);
  });

  it("disables every option while sending", () => {
    render(<TurnLengthPicker value={168} onChange={vi.fn()} disabled />);
    for (const name of ["24 hours", "3 days", "7 days"]) {
      expect(screen.getByRole("radio", { name })).toBeDisabled();
    }
  });
});
