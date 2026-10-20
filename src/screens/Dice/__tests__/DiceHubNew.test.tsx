import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiceGameDoc, DiceStatsDoc } from "../../../services/dice";
import { toDiceStats } from "../../../services/dice.mappers";
import { diceGame } from "../../../__tests__/harness/diceFixtures";

const env = vi.hoisted(() => ({
  user: { uid: "u1" } as { uid: string } | null,
  hub: { games: [] as DiceGameDoc[], stats: null as unknown, loading: false, error: false, retry: () => {} },
}));

vi.mock("../../../context/AuthContext", () => ({ useAuthContext: () => ({ user: env.user }) }));
vi.mock("../../../hooks/useDice", () => ({ useMyDiceGames: () => env.hub }));
vi.mock("../../../components/OpponentPicker", () => ({
  OpponentPicker: ({ onSelect }: { onSelect: (username: string) => void }) => (
    <button type="button" onClick={() => onSelect("fox")}>
      Pick fox
    </button>
  ),
}));
vi.mock("../../../services/users", () => ({ getUidByUsername: vi.fn() }));
vi.mock("../../../services/diceFeel", () => ({ isQuickRolls: () => false, setQuickRolls: vi.fn() }));
vi.mock("../../../services/haptics", () => ({
  playHaptic: vi.fn(),
  hapticForVariant: () => "light",
  isHapticsEnabled: () => false,
  setHapticsEnabled: vi.fn(),
}));
vi.mock("../../../services/sounds", () => ({ isSoundEnabled: () => false, setSoundEnabled: vi.fn() }));
vi.mock("../../../services/dice", async () => {
  const m = await import("../../../services/dice.mappers");
  return {
    DICE_MODES: m.DICE_MODES,
    DICE_TARGETS: m.DICE_TARGETS,
    createDiceGame: vi.fn(),
    diceErrorMessage: (err: unknown) => (err instanceof Error ? err.message : "failed"),
  };
});

import { DiceHub } from "../DiceHub";
import { DiceNew } from "../DiceNew";
import { createDiceGame } from "../../../services/dice";
import { getUidByUsername } from "../../../services/users";
import { setQuickRolls } from "../../../services/diceFeel";
import { setHapticsEnabled } from "../../../services/haptics";
import { setSoundEnabled } from "../../../services/sounds";

function stats(o: Partial<DiceStatsDoc> = {}): DiceStatsDoc {
  return { ...toDiceStats(undefined), ...o };
}

function renderAt(path: string, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/dice" element={<DiceHub />} />
        <Route path="/dice/new" element={<DiceNew />} />
        <Route path="/dice/:gameId" element={<p>table</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  env.user = { uid: "u1" };
  env.hub = { games: [], stats: stats(), loading: false, error: false, retry: vi.fn() };
  vi.mocked(createDiceGame).mockReset();
  vi.mocked(getUidByUsername).mockReset();
});

describe("DiceHub", () => {
  it("shows Rep, record and streak, and an empty state", async () => {
    env.hub.stats = stats({ rep: 1040, peakRep: 1060, wins: 3, losses: 1, gamesPlayed: 4, streak: 2, bestStreak: 3 });
    renderAt("/dice");
    expect(screen.getByTestId("dice-record")).toHaveTextContent("1,040");
    expect(screen.getByTestId("dice-record")).toHaveTextContent("3–1");
    expect(screen.getByTestId("dice-record")).toHaveTextContent("Best 3");
    expect(screen.getByTestId("dice-hub-empty")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "How the games work" }));
    expect(screen.getByTestId("dice-info")).toBeInTheDocument();
  });

  it("shows a skeleton, and an error with retry", async () => {
    env.hub.loading = true;
    const view = renderAt("/dice");
    expect(screen.getByTestId("dice-hub-loading")).toBeInTheDocument();
    view.unmount();
    env.hub.loading = false;
    env.hub.error = true;
    renderAt("/dice");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(env.hub.retry).toHaveBeenCalled();
  });

  it("groups matches by whose move it is and opens one", async () => {
    const done = Array.from({ length: 10 }, (_, i) => diceGame({ id: `d${i}`, status: "complete", winner: "u1" }));
    env.hub.games = [diceGame({ id: "m1" }), diceGame({ id: "w1", currentTurn: "u2" }), ...done];
    renderAt("/dice");
    expect(screen.getByText("Your move · 1")).toBeInTheDocument();
    expect(screen.getByText("Waiting on them · 1")).toBeInTheDocument();
    expect(screen.getByText("Finished · 10")).toBeInTheDocument();
    expect(screen.getAllByTestId("dice-match-row")).toHaveLength(10);
    await userEvent.click(screen.getByRole("button", { name: "Show all 10" }));
    expect(screen.getAllByTestId("dice-match-row")).toHaveLength(12);
    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    await userEvent.click(screen.getAllByTestId("dice-match-row")[0] as HTMLElement);
    expect(screen.getByText("table")).toBeInTheDocument();
  });

  it("starts a new match and works signed out", async () => {
    env.user = null;
    renderAt("/dice");
    await userEvent.click(screen.getByRole("button", { name: "New match" }));
    expect(screen.getByText("Sign in to roll.")).toBeInTheDocument();
  });
});

describe("DiceNew", () => {
  it("sends a 10,000 race to 10,000 to the picked skater", async () => {
    vi.mocked(getUidByUsername).mockResolvedValue("u2");
    vi.mocked(createDiceGame).mockResolvedValue({ gameId: "g7" } as never);
    renderAt("/dice/new");
    await userEvent.click(screen.getByRole("radio", { name: /^10,000/ }));
    expect(screen.getByRole("radio", { name: /first to 5,000/ })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: /first to 10,000/ }));
    await userEvent.click(screen.getByRole("button", { name: "Pick fox" }));
    expect(createDiceGame).toHaveBeenCalledWith("u2", "ten", 10000);
    expect(await screen.findByText("table")).toBeInTheDocument();
  });

  it("explains an unknown skater and a server error", async () => {
    vi.mocked(getUidByUsername).mockResolvedValueOnce(null);
    renderAt("/dice/new");
    await userEvent.click(screen.getByRole("button", { name: "Pick fox" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No skater with that name.");
    vi.mocked(getUidByUsername).mockResolvedValueOnce("u2");
    vi.mocked(createDiceGame).mockRejectedValueOnce(new Error("You already have 10 open dice matches."));
    await userEvent.click(screen.getByRole("button", { name: "Pick fox" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("10 open dice matches");
  });

  it("challenges a skater handed over from their profile", async () => {
    vi.mocked(createDiceGame).mockResolvedValue({ gameId: "g8" } as never);
    renderAt("/dice/new", { opponent: { uid: "u2", username: "fox" } });
    expect(screen.getByRole("heading", { name: "Roll @fox" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /^Craps/ }));
    await userEvent.click(screen.getByRole("button", { name: "Send challenge" }));
    expect(createDiceGame).toHaveBeenCalledWith("u2", "craps", 5);
    expect(getUidByUsername).not.toHaveBeenCalled();
  });

  it("ignores a malformed hand-off and asks signed-out users to sign in", () => {
    env.user = null;
    renderAt("/dice/new", { opponent: { uid: 3 } });
    expect(screen.getByRole("heading", { name: "New match" })).toBeInTheDocument();
    expect(screen.getByText("Sign in to roll.")).toBeInTheDocument();
  });
});

describe("DiceInfoSheet", () => {
  it("switches games and flips every table setting", async () => {
    renderAt("/dice/new");
    await userEvent.click(screen.getByRole("button", { name: "How to play" }));
    expect(screen.getByRole("tab", { name: "C-Lo" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "Craps" }));
    expect(screen.getByRole("tabpanel", { name: "Craps" })).toHaveTextContent("hard 4 or 10");
    await userEvent.click(screen.getByRole("switch", { name: /Sound/ }));
    await userEvent.click(screen.getByRole("switch", { name: /Haptics/ }));
    await userEvent.click(screen.getByRole("switch", { name: /Quick rolls/ }));
    expect(setSoundEnabled).toHaveBeenCalledWith(true);
    expect(setHapticsEnabled).toHaveBeenCalledWith(true);
    expect(setQuickRolls).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByTestId("dice-info"));
    expect(screen.queryByTestId("dice-info")).not.toBeInTheDocument();
  });
});
