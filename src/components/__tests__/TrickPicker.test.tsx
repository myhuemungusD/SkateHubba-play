import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrickPicker } from "../TrickPicker";
import { rememberRecentTrick, type TrickSelection } from "../../constants/tricks";

function renderPicker(overrides: Partial<{ selection: TrickSelection | null; disabled: boolean }> = {}) {
  const onChange = vi.fn();
  render(
    <TrickPicker
      selection={overrides.selection ?? null}
      onChange={onChange}
      disabled={overrides.disabled ?? false}
      trickCategory="custom"
      customRules="No powerslides"
    />,
  );
  return onChange;
}

describe("TrickPicker", () => {
  it("shows the game constraint, recent tricks, and a search miss", async () => {
    localStorage.clear();
    rememberRecentTrick("ollie");
    const onChange = renderPicker();
    expect(screen.getByText("No powerslides")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search tricks"), "zzzz");
    expect(screen.getByText("No tricks match that.")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Search tricks"));
    await userEvent.click(screen.getByRole("button", { name: "Any" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("emits a catalog pick and updates stance and obstacle", async () => {
    const onChange = renderPicker();
    await userEvent.click(screen.getByRole("option", { name: "Kickflip" }));
    expect(onChange).toHaveBeenCalledWith({
      trickId: "kickflip",
      stance: "regular",
      obstacle: null,
      trickNameCustom: null,
    });

    cleanup();
    const next = renderPicker({
      selection: { trickId: "kickflip", stance: "regular", obstacle: null, trickNameCustom: null },
    });
    await userEvent.click(screen.getByRole("button", { name: "Fakie" }));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ stance: "fakie", trickId: "kickflip" }));
    await userEvent.click(screen.getByRole("button", { name: "Rail" }));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ obstacle: "rail" }));
  });

  it("clears Other until the custom name is usable and locks after a take", async () => {
    const onChange = renderPicker();
    await userEvent.click(screen.getByRole("option", { name: "Other" }));
    expect(onChange).toHaveBeenCalledWith(null);
    await userEvent.type(screen.getByLabelText("Custom trick name"), "Casper");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ trickId: "other", trickNameCustom: "Casper" }));

    cleanup();
    renderPicker({
      disabled: true,
      selection: { trickId: "other", stance: "regular", obstacle: "flat", trickNameCustom: "Casper" },
    });
    expect(screen.getByLabelText("Custom trick name")).toBeDisabled();
    expect(screen.getByLabelText("Search tricks")).toBeDisabled();
  });
});
