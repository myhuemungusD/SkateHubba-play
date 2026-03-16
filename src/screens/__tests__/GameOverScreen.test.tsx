import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameOverScreen } from "../GameOverScreen";

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
}));

const profile = { uid: "u1", username: "sk8r", stance: "regular", emailVerified: true, createdAt: null };

function makeGame(overrides: Record<string, unknown> = {}) {
  return {
    id: "game1",
    player1Uid: "u1",
    player2Uid: "u2",
    player1Username: "sk8r",
    player2Username: "rival",
    p1Letters: 0,
    p2Letters: 5,
    status: "complete",
    currentTurn: "u1",
    phase: "setting",
    currentSetter: "u1",
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: { toMillis: () => Date.now() + 86400000 },
    turnNumber: 1,
    winner: "u1",
    createdAt: null,
    updatedAt: null,
    ...overrides,
  } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("GameOverScreen", () => {
  it("calls onRematch and shows Starting... then resets", async () => {
    let resolveRematch: () => void;
    const onRematch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRematch = resolve;
        }),
    );
    const onBack = vi.fn();

    render(<GameOverScreen game={makeGame()} profile={profile} onRematch={onRematch} onBack={onBack} />);

    expect(screen.getByText("You Win")).toBeInTheDocument();

    await userEvent.click(screen.getByText(/Rematch/));

    expect(screen.getByText("Starting...")).toBeInTheDocument();
    expect(onRematch).toHaveBeenCalledTimes(1);

    // Resolve the rematch promise
    resolveRematch!();

    await waitFor(() => {
      // After resolution, "Starting..." goes away
      expect(screen.getByText(/Rematch/)).toBeInTheDocument();
    });
  });

  it("prevents double-click on rematch", async () => {
    const onRematch = vi.fn(() => new Promise<void>(() => {})); // never resolves
    render(<GameOverScreen game={makeGame()} profile={profile} onRematch={onRematch} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText(/Rematch/));
    await userEvent.click(screen.getByText("Starting...")); // try again

    expect(onRematch).toHaveBeenCalledTimes(1);
  });

  it("shows disabled button when onRematch is undefined", () => {
    render(<GameOverScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);
    expect(screen.getByText("Verify email to rematch")).toBeInTheDocument();
  });

  it("shows loser view with S.K.A.T.E. title", () => {
    render(
      <GameOverScreen
        game={makeGame({ winner: "u2", p1Letters: 5, p2Letters: 2 })}
        profile={profile}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText("S.K.A.T.E.")).toBeInTheDocument();
  });

  it("shows forfeit view for winner", () => {
    render(<GameOverScreen game={makeGame({ status: "forfeit", winner: "u1" })} profile={profile} onBack={vi.fn()} />);
    expect(screen.getByText("You Win")).toBeInTheDocument();
    expect(screen.getByText(/@rival ran out of time/)).toBeInTheDocument();
  });

  it("shows forfeit view for loser", () => {
    render(<GameOverScreen game={makeGame({ status: "forfeit", winner: "u2" })} profile={profile} onBack={vi.fn()} />);
    expect(screen.getByText("Forfeit")).toBeInTheDocument();
    expect(screen.getByText("You ran out of time.")).toBeInTheDocument();
  });

  it("shows non-forfeit loser description", () => {
    render(
      <GameOverScreen
        game={makeGame({ winner: "u2", p1Letters: 5, p2Letters: 2, status: "complete" })}
        profile={profile}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/@rival outlasted you/)).toBeInTheDocument();
  });

  it("shows non-forfeit winner description", () => {
    render(
      <GameOverScreen
        game={makeGame({ winner: "u1", p1Letters: 0, p2Letters: 5, status: "complete" })}
        profile={profile}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/@rival spelled S.K.A.T.E./)).toBeInTheDocument();
  });

  it("calls onBack when Back to Lobby is clicked", async () => {
    const onBack = vi.fn();
    render(<GameOverScreen game={makeGame()} profile={profile} onBack={onBack} />);

    await userEvent.click(screen.getByText("Back to Lobby"));
    expect(onBack).toHaveBeenCalled();
  });

  it("shows player2 perspective when profile is player2", () => {
    render(
      <GameOverScreen
        game={makeGame({ winner: "u2" })}
        profile={{ ...profile, uid: "u2", username: "rival" }}
        onBack={vi.fn()}
      />,
    );
    // player2 won
    expect(screen.getByText("You Win")).toBeInTheDocument();
  });
});
