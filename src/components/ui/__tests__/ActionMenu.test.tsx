import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionMenu } from "../ActionMenu";

function renderMenu(onReport = vi.fn(), onMute = vi.fn()) {
  render(
    <ActionMenu
      label="More options for @sk8r"
      items={[
        { label: "Report", destructive: true, onSelect: onReport },
        { label: "Mute", disabled: true, onSelect: onMute },
      ]}
    />,
  );
  return { onReport, onMute };
}

describe("ActionMenu", () => {
  it("is a 44px ••• button that opens a labelled sheet portalled to the body", async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole("button", { name: "More options for @sk8r" });
    expect(trigger).toHaveClass("h-11", "w-11");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    const sheet = screen.getByRole("dialog", { name: "More options for @sk8r" });
    expect(sheet.parentElement).toBe(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(sheet).getByRole("button", { name: "Report" })).toHaveClass("text-brand-red");
    expect(within(sheet).getByRole("button", { name: "Mute" })).toBeDisabled();
  });

  it("closes, then runs the item, on select", async () => {
    const user = userEvent.setup();
    const { onReport } = renderMenu();
    await user.click(screen.getByRole("button", { name: "More options for @sk8r" }));
    await user.click(screen.getByRole("button", { name: "Report" }));
    expect(onReport).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes from Cancel, the scrim, or Escape without running anything", async () => {
    const user = userEvent.setup();
    const { onReport } = renderMenu();
    const open = () => user.click(screen.getByRole("button", { name: "More options for @sk8r" }));

    await open();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await open();
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await open();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onReport).not.toHaveBeenCalled();
  });

  it("keeps a click inside the panel from closing the sheet", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "More options for @sk8r" }));
    fireEvent.click(screen.getByRole("heading", { name: "More options for @sk8r", hidden: true }).parentElement!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("swallows Escape so a sheet underneath it stays open", async () => {
    const user = userEvent.setup();
    const underneath = vi.fn();
    document.addEventListener("keydown", underneath);
    renderMenu();
    await user.click(screen.getByRole("button", { name: "More options for @sk8r" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(underneath).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    document.removeEventListener("keydown", underneath);
    expect(underneath).toHaveBeenCalledTimes(1);
  });
});
