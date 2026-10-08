import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../services/dice", () => ({
  createDiceGame: vi.fn(),
  diceErrorMessage: (err: unknown) => (err instanceof Error ? err.message : "failed"),
}));

import { RollDiceButton } from "../RollDiceButton";
import { createDiceGame } from "../../../../services/dice";

describe("RollDiceButton", () => {
  beforeEach(() => {
    vi.mocked(createDiceGame).mockReset();
  });

  function renderButton(): void {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<RollDiceButton opponentUid="u2" />} />
          <Route path="/dice/:gameId" element={<p>table</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("opens the match it just created", async () => {
    vi.mocked(createDiceGame).mockResolvedValue({
      gameId: "g1",
      status: "active",
      label: null,
      currentTurn: "u1",
      roundsWon: {},
      winner: null,
      applied: true,
    });
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Roll Dice" }));
    expect(await screen.findByText("table")).toBeInTheDocument();
  });

  it("shows the error and ignores a second tap while the first is in flight", async () => {
    let rejectCreate: (err: Error) => void = () => {};
    vi.mocked(createDiceGame).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectCreate = reject;
        }),
    );
    renderButton();
    const button = screen.getByRole("button", { name: "Roll Dice" });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(createDiceGame).toHaveBeenCalledTimes(1);
    rejectCreate(new Error("That challenge isn't available."));
    expect(await screen.findByRole("alert")).toHaveTextContent("That challenge isn't available.");
  });
});
