import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RulesSheet } from "../RulesSheet";

describe("RulesSheet", () => {
  it("renders as a modal dialog with the rules title and every rule", () => {
    render(<RulesSheet onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: /^RULES$/ })).toBeInTheDocument();
    expect(screen.getByText("You set the first trick")).toBeInTheDocument();
    expect(screen.getByText("One-take video only — no retries")).toBeInTheDocument();
    expect(screen.getByText("24 hours per turn or forfeit")).toBeInTheDocument();
    expect(screen.getByText("Miss a match = earn a letter")).toBeInTheDocument();
    expect(screen.getByText("Spell S.K.A.T.E. = you lose")).toBeInTheDocument();
  });

  it("calls onClose when the Close button is clicked", async () => {
    const onClose = vi.fn();
    render(<RulesSheet onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /close rules/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(<RulesSheet onClose={onClose} />);
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when the panel itself is clicked", async () => {
    const onClose = vi.fn();
    render(<RulesSheet onClose={onClose} />);
    await userEvent.click(screen.getByText("Spell S.K.A.T.E. = you lose"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<RulesSheet onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
