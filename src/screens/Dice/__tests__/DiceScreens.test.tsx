import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiceGameDoc } from "../../../services/dice";

const auth = vi.hoisted(() => ({ user: { uid: "u1" } as { uid: string } | null }));
const hubState = vi.hoisted(() => ({
  current: {
    games: [] as DiceGameDoc[],
    stats: { wins: 1, losses: 2, gamesPlayed: 3 },
    loading: false,
  },
}));
const tableState = vi.hoisted(() => ({
  current: { game: null as DiceGameDoc | null, loading: false, missing: false },
}));

vi.mock("../../../context/AuthContext", () => ({
  useAuthContext: () => ({ user: auth.user }),
}));
vi.mock("../../../hooks/useDice", () => ({
  useMyDiceGames: () => hubState.current,
  useDiceGame: () => tableState.current,
}));
vi.mock("../../../components/OpponentPicker", () => ({
  OpponentPicker: ({ onSelect }: { onSelect: (username: string) => void }) => (
    <button type="button" onClick={() => onSelect("remy")}>
      Pick remy
    </button>
  ),
}));
vi.mock("../../../services/users", () => ({ getUidByUsername: vi.fn() }));
vi.mock("../../../services/dice", () => ({
  createDiceGame: vi.fn(),
  rollDice: vi.fn(),
  quitDice: vi.fn(),
  declineDice: vi.fn(),
  claimDiceTimeout: vi.fn(),
  diceErrorMessage: (err: unknown) => (err instanceof Error ? err.message : "failed"),
}));
vi.mock("../../../services/haptics", () => ({
  playHaptic: vi.fn(),
  hapticForVariant: () => "light",
}));

import { DiceHub } from "../DiceHub";
import { DiceNew } from "../DiceNew";
import { DiceTable } from "../DiceTable";
import { getUidByUsername } from "../../../services/users";
import { claimDiceTimeout, createDiceGame, declineDice, quitDice, rollDice } from "../../../services/dice";

function match(overrides: Partial<DiceGameDoc> = {}): DiceGameDoc {
  return {
    id: "g1",
    player1Uid: "u1",
    player2Uid: "u2",
    player1Username: "jay",
    player2Username: "remy",
    status: "active",
    currentTurn: "u1",
    round: 1,
    roundsWon: { u1: 0, u2: 0 },
    rollCount: 0,
    winner: null,
    endReason: null,
    updatedAt: 1,
    turnDeadline: Date.now() + 60_000,
    lastRoll: null,
    ...overrides,
  };
}

function renderTable(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={["/dice/g1"]}>
      <Routes>
        <Route path="/dice/:gameId" element={<DiceTable />} />
        <Route path="/dice" element={<p>hub</p>} />
        <Route path="/dice/new" element={<p>newer</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DiceHub", () => {
  beforeEach(() => {
    auth.user = { uid: "u1" };
    hubState.current = { games: [], stats: { wins: 3, losses: 1, gamesPlayed: 4 }, loading: false };
  });

  it("shows the record, the empty state, and opens the picker", async () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<DiceHub />} />
          <Route path="/dice/new" element={<p>picker</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("dice-record")).toHaveTextContent("3–1");
    expect(screen.getByText("No dice matches yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Roll someone" }));
    expect(screen.getByText("picker")).toBeInTheDocument();
  });

  it("lists a live match and a finished one", async () => {
    hubState.current = {
      ...hubState.current,
      games: [match(), match({ id: "g2", status: "forfeit", roundsWon: { u1: 2, u2: 1 } })],
    };
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<DiceHub />} />
          <Route path="/dice/:gameId" element={<p>table</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /remy · round 1/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /remy · 2–1/ }));
    expect(screen.getByText("table")).toBeInTheDocument();
  });

  it("shows a loading line and skips the listener without a user", () => {
    auth.user = null;
    hubState.current = { ...hubState.current, loading: true, games: [] };
    render(
      <MemoryRouter>
        <DiceHub />
      </MemoryRouter>,
    );
    expect(screen.getByText("Loading matches…")).toBeInTheDocument();
  });
});

describe("DiceNew", () => {
  beforeEach(() => {
    auth.user = { uid: "u1" };
    vi.mocked(getUidByUsername).mockReset();
    vi.mocked(createDiceGame).mockReset();
  });

  function renderNew(): void {
    render(
      <MemoryRouter initialEntries={["/dice/new"]}>
        <Routes>
          <Route path="/dice/new" element={<DiceNew />} />
          <Route path="/dice" element={<p>hub</p>} />
          <Route path="/dice/:gameId" element={<p>opened</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("opens a match with the skater you picked", async () => {
    vi.mocked(getUidByUsername).mockResolvedValue("u2");
    vi.mocked(createDiceGame).mockResolvedValue({
      gameId: "g9",
      status: "active",
      label: "POINT 4",
      currentTurn: "u2",
      roundsWon: { u1: 0 },
      winner: null,
      applied: true,
    });
    renderNew();
    await userEvent.click(screen.getByRole("button", { name: "Pick remy" }));
    expect(await screen.findByText("opened")).toBeInTheDocument();
  });

  it("says when the name is not a skater", async () => {
    vi.mocked(getUidByUsername).mockResolvedValue(null);
    renderNew();
    await userEvent.click(screen.getByRole("button", { name: "Pick remy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No skater with that name.");
  });

  it("shows the callable error", async () => {
    vi.mocked(getUidByUsername).mockResolvedValue("u2");
    vi.mocked(createDiceGame).mockRejectedValue(new Error("Verify your email first."));
    renderNew();
    await userEvent.click(screen.getByRole("button", { name: "Pick remy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Verify your email first.");
  });

  it("asks a signed-out visitor to sign in, and goes back", async () => {
    auth.user = null;
    renderNew();
    expect(screen.getByText("Sign in to roll.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("hub")).toBeInTheDocument();
  });
});

describe("DiceTable", () => {
  beforeEach(() => {
    auth.user = { uid: "u1" };
    tableState.current = { game: match(), loading: false, missing: false };
    vi.mocked(rollDice)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(quitDice)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(declineDice)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(claimDiceTimeout)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(createDiceGame).mockReset();
  });

  it("rolls when it is your turn and shows the error when the roll fails", async () => {
    let rejectRoll: (err: Error) => void = () => {};
    vi.mocked(rollDice).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRoll = reject;
        }),
    );
    renderTable();
    const roll = screen.getByRole("button", { name: "ROLL" });
    await userEvent.click(roll);
    await userEvent.click(roll);
    expect(rollDice).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("img", { name: "Rolling" })).toHaveLength(3);
    rejectRoll(new Error("Wait for their roll."));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wait for their roll.");
  });

  it("waits, and lets the opponent decline before anyone rolls", async () => {
    auth.user = { uid: "u2" };
    tableState.current = { game: match({ currentTurn: "u1", player1Username: "" }), loading: false, missing: false };
    renderTable();
    expect(screen.getByText(/Waiting on/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(declineDice).toHaveBeenCalledWith("g1");
  });

  it("leaves the match", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Leave the match" }));
    expect(quitDice).toHaveBeenCalledWith("g1");
  });

  it("claims a turn that already expired", async () => {
    vi.mocked(claimDiceTimeout).mockRejectedValue(new Error("That didn't work. Try again."));
    tableState.current = { game: match({ turnDeadline: 1, currentTurn: "u2" }), loading: false, missing: false };
    renderTable();
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't work. Try again.");
    expect(claimDiceTimeout).toHaveBeenCalledWith("g1");
  });

  it("shows the result and runs it back", async () => {
    tableState.current = {
      game: match({
        status: "forfeit",
        winner: "u1",
        endReason: "quit",
        currentTurn: null,
        lastRoll: { uid: "u2", dice: [4, 5, 6], outcome: "456", label: "4-5-6" },
      }),
      loading: false,
      missing: false,
    };
    vi.mocked(createDiceGame).mockResolvedValue({
      gameId: "g2",
      status: "active",
      label: null,
      currentTurn: "u1",
      roundsWon: { u2: 1 },
      winner: null,
      applied: true,
    });
    render(
      <MemoryRouter initialEntries={["/dice/g1"]}>
        <Routes>
          <Route path="/dice/:gameId" element={<DiceTable />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("You got the win")).toBeInTheDocument();
    expect(screen.getByText("4-5-6")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Run it back" }));
    expect(createDiceGame).toHaveBeenCalledWith("u2");
  });

  it("shows the loading and missing states", async () => {
    tableState.current = { game: null, loading: true, missing: false };
    const { unmount } = renderTable();
    expect(screen.getByText("Loading the table…")).toBeInTheDocument();
    unmount();
    tableState.current = { game: null, loading: false, missing: true };
    renderTable();
    expect(screen.getByText("That match is gone.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to Roll Dice" }));
    expect(screen.getByText("hub")).toBeInTheDocument();
  });
});
