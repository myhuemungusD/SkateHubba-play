import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LobbyTimer } from "../LobbyTimer";

describe("LobbyTimer", () => {
  it("returns null when deadline is 0", () => {
    const { container } = render(<LobbyTimer deadline={0} isMyTurn={true} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows time remaining with hours and minutes", () => {
    const deadline = Date.now() + 5 * 3_600_000; // 5 hours
    render(<LobbyTimer deadline={deadline} isMyTurn={true} />);
    expect(screen.getByLabelText(/Time remaining/)).toBeInTheDocument();
  });

  it("shows Expired when deadline has passed", () => {
    const deadline = Date.now() - 1000;
    // deadline > 0 but already passed: the effect should set "Expired"
    render(<LobbyTimer deadline={deadline} isMyTurn={true} />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });
});
