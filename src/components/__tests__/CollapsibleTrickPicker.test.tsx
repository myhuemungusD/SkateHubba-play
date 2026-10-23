import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollapsibleTrickPicker } from "../CollapsibleTrickPicker";
import type { TrickSelection } from "../../constants/tricks";

const kickflip: TrickSelection = { trickId: "kickflip", stance: "regular", obstacle: null, trickNameCustom: null };

describe("CollapsibleTrickPicker", () => {
  it("starts as a one-row summary so the camera preview leads", () => {
    render(<CollapsibleTrickPicker selection={null} onChange={vi.fn()} disabled={false} />);
    expect(screen.getByTestId("trick-picker-summary")).toHaveTextContent("No trick picked yet");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("names the picked trick and offers Change", () => {
    render(<CollapsibleTrickPicker selection={kickflip} onChange={vi.fn()} disabled={false} />);
    expect(screen.getByText("Set your Kickflip")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeEnabled();
  });

  it("stays shut once the take is recorded", () => {
    render(<CollapsibleTrickPicker selection={kickflip} onChange={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "Change" })).toBeDisabled();
  });

  it("folds away on DONE, and stays open while an Other name is typed", async () => {
    const onChange = vi.fn();
    render(<CollapsibleTrickPicker selection={null} onChange={onChange} disabled={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Pick a trick" }));
    await userEvent.click(await screen.findByRole("option", { name: "Other" }));
    expect(screen.getByRole("listbox", { name: "Tricks" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "DONE" }));
    expect(screen.getByTestId("trick-picker-summary")).toBeInTheDocument();
  });

  it("stays open when the stance changes on an already-picked trick", async () => {
    render(<CollapsibleTrickPicker selection={kickflip} onChange={vi.fn()} disabled={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    await userEvent.click(await screen.findByRole("button", { name: "Switch" }));
    expect(screen.getByRole("listbox", { name: "Tricks" })).toBeInTheDocument();
  });
});
