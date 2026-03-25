import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyRecordScreen } from "../MyRecordScreen";

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("../../components/TurnHistoryViewer", () => ({
  TurnHistoryViewer: () => <div data-testid="turn-history-viewer" />,
}));

vi.mock("../../components/GameReplay", () => ({
  GameReplay: () => <div data-testid="game-replay" />,
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
    turnNumber: 3,
    winner: "u1",
    createdAt: null,
    updatedAt: { toMillis: () => Date.now() },
    turnHistory: [
      {
        turnNumber: 1,
        trickName: "Kickflip",
        setterUid: "u1",
        setterUsername: "sk8r",
        matcherUid: "u2",
        matcherUsername: "rival",
        setVideoUrl: null,
        matchVideoUrl: null,
        landed: false,
        letterTo: "u2",
      },
    ],
    ...overrides,
  } as any;
}

const defaultProps = {
  profile,
  games: [] as any[],
  onOpenGame: vi.fn(),
  onBack: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

describe("MyRecordScreen", () => {
  it("renders player identity and stats", () => {
    render(<MyRecordScreen {...defaultProps} />);
    expect(screen.getByText("@sk8r")).toBeInTheDocument();
    expect(screen.getByText("Wins")).toBeInTheDocument();
    expect(screen.getByText("Losses")).toBeInTheDocument();
    expect(screen.getByText("Win Rate")).toBeInTheDocument();
  });

  it("shows empty state when no completed games", () => {
    render(<MyRecordScreen {...defaultProps} games={[]} />);
    expect(screen.getByText("No games played yet")).toBeInTheDocument();
  });

  it("renders completed game in history", () => {
    const game = makeGame();
    render(<MyRecordScreen {...defaultProps} games={[game]} />);
    expect(screen.getByText(/vs @rival/)).toBeInTheDocument();
    expect(screen.getByText("WIN")).toBeInTheDocument();
  });

  it("renders loss badge for lost games", () => {
    const game = makeGame({ winner: "u2", p1Letters: 5, p2Letters: 0 });
    render(<MyRecordScreen {...defaultProps} games={[game]} />);
    expect(screen.getByText("LOSS")).toBeInTheDocument();
  });

  it("renders opponent section for completed games", () => {
    const game = makeGame();
    render(<MyRecordScreen {...defaultProps} games={[game]} />);
    expect(screen.getByText("OPPONENTS")).toBeInTheDocument();
  });

  it("calculates stats correctly", () => {
    const win = makeGame({ id: "g1", winner: "u1" });
    const loss = makeGame({ id: "g2", winner: "u2", p1Letters: 5, p2Letters: 0 });
    render(<MyRecordScreen {...defaultProps} games={[win, loss]} />);
    expect(screen.getByText("50%")).toBeInTheDocument(); // win rate
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    render(<MyRecordScreen {...defaultProps} onBack={onBack} />);
    await userEvent.click(screen.getByLabelText("Back to lobby"));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("expands game card on click and shows replay", async () => {
    const game = makeGame();
    render(<MyRecordScreen {...defaultProps} games={[game]} />);
    await userEvent.click(screen.getByText(/vs @rival/));
    expect(screen.getByTestId("game-replay")).toBeInTheDocument();
    expect(screen.getByTestId("turn-history-viewer")).toBeInTheDocument();
  });

  it("does not show active games in history", () => {
    const active = makeGame({ status: "active", winner: null });
    render(<MyRecordScreen {...defaultProps} games={[active]} />);
    expect(screen.getByText("No games played yet")).toBeInTheDocument();
  });

  it("shows forfeit label", () => {
    const game = makeGame({ status: "forfeit" });
    render(<MyRecordScreen {...defaultProps} games={[game]} />);
    expect(screen.getByText("forfeit")).toBeInTheDocument();
  });

  it("shows win streak callout when streak >= 2", () => {
    const g1 = makeGame({ id: "g1", updatedAt: { toMillis: () => 1000 } });
    const g2 = makeGame({ id: "g2", updatedAt: { toMillis: () => 2000 } });
    render(<MyRecordScreen {...defaultProps} games={[g1, g2]} />);
    expect(screen.getByText("2 WIN STREAK")).toBeInTheDocument();
  });
});
