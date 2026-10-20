import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { RollDiceButton } from "../RollDiceButton";

function NewMatch() {
  const location = useLocation();
  return <p>new match {JSON.stringify(location.state)}</p>;
}

describe("RollDiceButton", () => {
  it("opens the new-match screen with this skater preselected", async () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<RollDiceButton opponentUid="u2" opponentUsername="fox" />} />
          <Route path="/dice/new" element={<NewMatch />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Roll Dice" }));
    expect(screen.getByText('new match {"opponent":{"uid":"u2","username":"fox"}}')).toBeInTheDocument();
  });
});
