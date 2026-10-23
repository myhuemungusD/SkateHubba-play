import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GamePlayHeader } from "../GamePlayHeader";

const base = { deadline: Date.now() + 3_600_000, onBack: vi.fn(), onReport: vi.fn() };

describe("GamePlayHeader", () => {
  it("gives a player one back chevron, the timer and a Report button", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onReport = vi.fn();
    render(<GamePlayHeader {...base} isPlayer reported={false} onBack={onBack} onReport={onReport} />);
    await user.click(screen.getByRole("button", { name: "Back to games" }));
    await user.click(screen.getByRole("button", { name: "Report opponent" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/^Turn timer:/)).toBeInTheDocument();
  });

  it("disables Report once reported", () => {
    render(<GamePlayHeader {...base} isPlayer reported />);
    const report = screen.getByRole("button", { name: "Reported" });
    expect(report).toBeDisabled();
    expect(report).toHaveAttribute("title", "Already reported");
  });

  it("drops Report for a spectator and the timer when the body already shows it", () => {
    render(<GamePlayHeader {...base} isPlayer={false} reported={false} showTimer={false} />);
    expect(screen.queryByRole("button", { name: /report/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Turn timer:/)).not.toBeInTheDocument();
  });
});
