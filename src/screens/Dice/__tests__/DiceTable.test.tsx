import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiceCallResult, DiceGameDoc } from "../../../services/dice";
import { diceGame, diceRoll } from "../../../__tests__/harness/diceFixtures";

const env = vi.hoisted(() => ({
  user: { uid: "u1" } as { uid: string } | null,
  online: true,
  reduced: true,
  table: { game: null as DiceGameDoc | null, loading: false, missing: false },
}));

vi.mock("../../../context/AuthContext", () => ({ useAuthContext: () => ({ user: env.user }) }));
vi.mock("../../../hooks/useDice", async () => {
  const { toDiceStats } = await import("../../../services/dice.mappers");
  return { useDiceGame: () => env.table, useDiceStats: () => ({ ...toDiceStats(undefined), rep: 1016 }) };
});
vi.mock("../../../hooks/useOnlineStatus", () => ({ useOnlineStatus: () => env.online }));
vi.mock("../../../hooks/useReducedMotion", () => ({ useReducedMotion: () => env.reduced }));
vi.mock("../../../services/diceFeel", () => ({
  isQuickRolls: () => false,
  setQuickRolls: vi.fn(),
  playDiceCue: vi.fn(),
}));
vi.mock("../../../services/haptics", () => ({
  playHaptic: vi.fn(),
  hapticForVariant: () => "light",
  isHapticsEnabled: () => true,
  setHapticsEnabled: vi.fn(),
}));
vi.mock("../../../services/sounds", () => ({ isSoundEnabled: () => true, setSoundEnabled: vi.fn() }));
vi.mock("../../../services/dice", async () => {
  const mappers = await import("../../../services/dice.mappers");
  return {
    DICE_MODES: mappers.DICE_MODES,
    acceptDice: vi.fn(),
    bankDice: vi.fn(),
    claimDiceTimeout: vi.fn(),
    declineDice: vi.fn(),
    nudgeDice: vi.fn(),
    quitDice: vi.fn(),
    rematchDice: vi.fn(),
    rollDice: vi.fn(),
    diceErrorMessage: (err: unknown) => (err instanceof Error ? err.message : "failed"),
    diceErrorCode: (err: unknown) =>
      err instanceof Error && err.message === "game_over" ? "game_over" : "dice_failed",
  };
});

import { DiceTable } from "../DiceTable";
import {
  acceptDice,
  bankDice,
  claimDiceTimeout,
  declineDice,
  nudgeDice,
  quitDice,
  rematchDice,
  rollDice,
} from "../../../services/dice";
import { playDiceCue } from "../../../services/diceFeel";

function result(o: Partial<DiceCallResult> = {}): DiceCallResult {
  return {
    gameId: "g1",
    status: "active",
    label: "Trips 4s",
    outcome: "win",
    callout: null,
    dice: [4, 4, 4],
    rollId: "r2",
    currentTurn: "u2",
    scores: {},
    winner: null,
    applied: true,
    ...o,
  };
}

function show(game: DiceGameDoc | null, o: Partial<typeof env.table> = {}) {
  env.table = { game, loading: false, missing: false, ...o };
  return render(
    <MemoryRouter initialEntries={["/dice/g1"]}>
      <Routes>
        <Route path="/dice/:gameId" element={<DiceTable />} />
        <Route path="/dice" element={<p>hub</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function refresh(view: ReturnType<typeof show>): void {
  view.rerender(
    <MemoryRouter initialEntries={["/dice/g1"]}>
      <Routes>
        <Route path="/dice/:gameId" element={<DiceTable />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

beforeEach(() => {
  env.user = { uid: "u1" };
  env.online = true;
  env.reduced = true;
  for (const fn of [acceptDice, bankDice, claimDiceTimeout, declineDice, nudgeDice, quitDice, rematchDice, rollDice]) {
    vi.mocked(fn).mockReset().mockResolvedValue(result());
  }
  vi.mocked(playDiceCue).mockClear();
});

describe("DiceTable shell", () => {
  it("shows a skeleton while loading", () => {
    show(null, { loading: true });
    expect(screen.getByTestId("dice-table-loading")).toBeInTheDocument();
  });

  it("explains a missing match and goes back", async () => {
    show(null, { missing: true });
    await userEvent.click(screen.getByRole("button", { name: "Back to Roll Dice" }));
    expect(screen.getByText("hub")).toBeInTheDocument();
  });
});

describe("pending challenge", () => {
  it("lets the challenged skater accept", async () => {
    env.user = { uid: "u2" };
    show(diceGame({ status: "pending", currentTurn: null, accepted: false }));
    await userEvent.click(screen.getByRole("button", { name: "Accept challenge" }));
    expect(acceptDice).toHaveBeenCalledWith("g1");
  });

  it("confirms a decline, and backs out", async () => {
    env.user = { uid: "u2" };
    show(diceGame({ status: "pending", currentTurn: null }));
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Decline" }));
    expect(declineDice).toHaveBeenCalledWith("g1");
  });

  it("lets the challenger call it off and read the rules", async () => {
    show(diceGame({ status: "pending", currentTurn: null }));
    expect(screen.getByTestId("dice-waiting")).toHaveTextContent("Waiting for @fox to accept");
    await userEvent.click(screen.getByRole("button", { name: "Call off challenge" }));
    expect(quitDice).toHaveBeenCalledWith("g1");
    await userEvent.click(screen.getByRole("button", { name: "How C-Lo works" }));
    expect(screen.getByTestId("dice-info")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByTestId("dice-info")).not.toBeInTheDocument();
  });
});

describe("live match", () => {
  it("rolls, shows the server's roll before the snapshot, and announces it", async () => {
    show(diceGame({ lastRoll: diceRoll({ rollId: "r1" }) }));
    expect(screen.getByTestId("dice-need")).toHaveTextContent("Throw until");
    await userEvent.click(screen.getByRole("button", { name: "Roll" }));
    expect(rollDice).toHaveBeenCalledWith("g1", []);
    expect(playDiceCue).toHaveBeenCalledWith("throw");
    expect(await screen.findByText(/You: Trips 4s/)).toBeInTheDocument();
  });

  it("shows an error from the server", async () => {
    vi.mocked(rollDice).mockRejectedValueOnce(new Error("Give it a second."));
    show(diceGame());
    await userEvent.click(screen.getByRole("button", { name: "Roll" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Give it a second.");
  });

  it("sends one move for a double tap", async () => {
    let finish: (r: DiceCallResult) => void = () => undefined;
    vi.mocked(rollDice).mockReturnValueOnce(new Promise((r) => (finish = r)));
    show(diceGame({ lastRoll: diceRoll({ rollId: "r1" }) }));
    const button = screen.getByRole("button", { name: "Roll" });
    act(() => {
      button.click();
      button.click();
    });
    expect(rollDice).toHaveBeenCalledTimes(1);
    await act(async () => finish(result({ currentTurn: "u1", outcome: "none", label: "No point" })));
  });

  it("holds the next roll until the snapshot has the last one", async () => {
    const before = diceGame({ lastRoll: diceRoll({ rollId: "r1" }) });
    const view = show(before);
    vi.mocked(rollDice).mockResolvedValueOnce(result({ currentTurn: "u1", outcome: "none", label: "No point" }));
    await userEvent.click(screen.getByRole("button", { name: "Roll" }));
    expect(await screen.findByText(/You: No point/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Roll" })).toBeDisabled();
    env.table = { ...env.table, game: { ...before, lastRoll: diceRoll({ rollId: "r2", label: "No point" }) } };
    refresh(view);
    expect(screen.getByRole("button", { name: "Roll" })).toBeEnabled();
  });

  it("stays quiet when someone else already closed the expired turn", async () => {
    vi.mocked(claimDiceTimeout).mockRejectedValueOnce(new Error("game_over"));
    show(diceGame({ turnDeadline: Date.now() - 1 }));
    await wait(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("waits on the other skater and nudges once", async () => {
    show(
      diceGame({
        currentTurn: "u2",
        lastRoll: diceRoll({ uid: "u2", callout: "Clean", label: "4-5-6", dice: [4, 5, 6] }),
      }),
    );
    expect(screen.getByTestId("dice-waiting")).toHaveTextContent("@fox is up");
    expect(screen.getByTestId("dice-caption")).toHaveTextContent("@fox: 4-5-6· Clean");
    await userEvent.click(screen.getByRole("button", { name: "Nudge @fox" }));
    expect(nudgeDice).toHaveBeenCalledWith("g1");
  });

  it("disables nudge during the cooldown", () => {
    show(diceGame({ currentTurn: "u2", nudgedAt: Date.now() }));
    expect(screen.getByRole("button", { name: "Nudged" })).toBeDisabled();
  });

  it("confirms a forfeit", async () => {
    show(diceGame());
    await userEvent.click(screen.getByRole("button", { name: "Forfeit match" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(quitDice).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Forfeit match" }));
    await userEvent.click(screen.getByRole("button", { name: "Forfeit" }));
    expect(quitDice).toHaveBeenCalledWith("g1");
  });

  it("locks moves offline", () => {
    env.online = false;
    show(diceGame());
    expect(screen.getByText(/You're offline/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Roll" })).toBeDisabled();
  });

  it("claims an expired turn once", () => {
    const view = show(diceGame({ turnDeadline: Date.now() - 1 }));
    refresh(view);
    expect(claimDiceTimeout).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed timeout claim", async () => {
    vi.mocked(claimDiceTimeout).mockRejectedValueOnce(new Error("nope"));
    show(diceGame({ turnDeadline: Date.now() - 1 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
  });

  it("shows the craps point and the round log", () => {
    show(
      diceGame({
        mode: "craps",
        point: 6,
        round: 3,
        rounds: [{ round: 1, winner: "u1", points: 2, label: "Made the 6", hands: {}, at: 1 }],
      }),
    );
    expect(screen.getByText("Point 6")).toBeInTheDocument();
    expect(screen.getByTestId("dice-meta")).toHaveTextContent("Craps · Race to 5 · Hand 3");
    expect(screen.getByText("Hands · 1")).toBeInTheDocument();
  });

  it("plays the reveal with sound when motion is allowed", async () => {
    env.reduced = false;
    const view = show(diceGame({ currentTurn: "u2", lastRoll: diceRoll({ rollId: "a" }) }));
    env.table = {
      game: diceGame({
        lastRoll: diceRoll({ uid: "u2", rollId: "b", callout: "Bail", dice: [1, 2, 3], label: "1-2-3" }),
      }),
      loading: false,
      missing: false,
    };
    refresh(view);
    await wait(900);
    expect(playDiceCue).toHaveBeenCalledWith("land");
    expect(playDiceCue).toHaveBeenCalledWith("bail");
  });
});

describe("10,000", () => {
  const ten = (o: Partial<DiceGameDoc> = {}) =>
    diceGame({
      mode: "ten",
      target: 5000,
      ten: { turnScore: 200, kept: [5, 5], rolled: [1, 2, 3, 4] },
      lastRoll: diceRoll({ dice: [1, 2, 3, 4], rollId: "t1", label: "Up to 100 on the table" }),
      ...o,
    });

  it("picks scoring dice, previews the bank, and rolls the rest", async () => {
    show(ten());
    expect(screen.getByRole("button", { name: "Pick scoring dice" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Die showing 2" }));
    expect(screen.getByRole("button", { name: "Those dice don't score" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Die showing 2, set aside" }));
    await userEvent.click(screen.getByRole("button", { name: "Die showing 1" }));
    expect(screen.getByRole("button", { name: "Bank 300" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Roll 3 dice" }));
    expect(rollDice).toHaveBeenCalledWith("g1", [0]);
  });

  it("banks the turn", async () => {
    show(ten());
    await userEvent.click(screen.getByRole("button", { name: "Die showing 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Bank 300" }));
    expect(bankDice).toHaveBeenCalledWith("g1", [0]);
  });

  it("offers hot dice and the opening roll", async () => {
    const view = show(
      ten({
        ten: { turnScore: 200, kept: [5, 5], rolled: [1, 1, 1, 5] },
        lastRoll: diceRoll({ dice: [1, 1, 1, 5], rollId: "t2" }),
      }),
    );
    for (const name of ["Die showing 1", "Die showing 1", "Die showing 1", "Die showing 5"]) {
      await userEvent.click(screen.getAllByRole("button", { name })[0] as HTMLElement);
    }
    expect(screen.getByRole("button", { name: "Hot dice: roll all six" })).toBeEnabled();
    view.unmount();
    show(ten({ ten: { turnScore: 0, kept: [], rolled: [] }, lastRoll: null }));
    expect(screen.getByRole("button", { name: "Roll six dice" })).toBeEnabled();
  });

  it("names a single die", async () => {
    show(
      ten({
        ten: { turnScore: 0, kept: [5, 5, 5, 2], rolled: [1, 3] },
        lastRoll: diceRoll({ dice: [1, 3], rollId: "t3" }),
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Die showing 1" }));
    expect(screen.getByRole("button", { name: "Roll 1 die" })).toBeEnabled();
  });
});

describe("finished match", () => {
  it("shows the result with Rep and sends a rematch", async () => {
    vi.mocked(rematchDice).mockResolvedValueOnce(result({ gameId: "g9", status: "pending" }));
    show(
      diceGame({
        status: "complete",
        winner: "u1",
        endReason: "target",
        currentTurn: null,
        scores: { u1: 5, u2: 3 },
        repChange: { u1: 16, u2: -16 },
      }),
    );
    expect(screen.getByTestId("dice-result")).toHaveTextContent("You won");
    expect(screen.getByTestId("dice-result")).toHaveTextContent("5 – 3");
    expect(screen.getByTestId("dice-result")).toHaveTextContent("1,016");
    await userEvent.click(screen.getByRole("button", { name: "Rematch" }));
    expect(rematchDice).toHaveBeenCalledWith("g1");
  });

  it("opens an existing rematch and goes back to the hub", async () => {
    show(diceGame({ status: "forfeit", winner: "u2", endReason: "quit", rematchGameId: "g9" }));
    await userEvent.click(screen.getByRole("button", { name: "Open rematch" }));
    expect(rematchDice).not.toHaveBeenCalled();
    show(diceGame({ status: "declined", endReason: "decline", player2Username: "" }));
    expect(screen.getAllByRole("button", { name: "Challenge again" }).length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole("button", { name: "Back to Roll Dice" })[0] as HTMLElement);
    expect(screen.getByText("hub")).toBeInTheDocument();
  });

  it("plays the win cue when the final roll lands", async () => {
    const view = show(diceGame({ lastRoll: diceRoll({ rollId: "a" }) }));
    env.table = {
      game: diceGame({ status: "complete", winner: "u1", lastRoll: diceRoll({ rollId: "z" }) }),
      loading: false,
      missing: false,
    };
    refresh(view);
    await wait(300);
    expect(playDiceCue).toHaveBeenCalledWith("win");
  });
});
