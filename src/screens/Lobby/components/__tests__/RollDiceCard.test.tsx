import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { RollDiceCard } from "../RollDiceCard";

describe("RollDiceCard", () => {
  it("opens the dice hub", async () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<RollDiceCard />} />
          <Route path="/dice" element={<p>dice hub</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByTestId("roll-dice-card"));
    expect(screen.getByText("dice hub")).toBeInTheDocument();
  });
});
