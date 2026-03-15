import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GamePlayScreen } from "../GamePlayScreen";

const mockSetTrick = vi.fn();
const mockSubmitMatchResult = vi.fn();
const mockForfeitExpiredTurn = vi.fn();
const mockUploadVideo = vi.fn();

vi.mock("../../services/games", () => ({
  setTrick: (...args: unknown[]) => mockSetTrick(...args),
  submitMatchResult: (...args: unknown[]) => mockSubmitMatchResult(...args),
  forfeitExpiredTurn: (...args: unknown[]) => mockForfeitExpiredTurn(...args),
}));

vi.mock("../../services/storage", () => ({
  uploadVideo: (...args: unknown[]) => mockUploadVideo(...args),
}));

const profile = { uid: "u1", username: "sk8r", stance: "regular", email: "a@b.com", emailVerified: true };

function makeGame(overrides: Record<string, unknown> = {}) {
  return {
    id: "game1",
    player1Uid: "u1",
    player2Uid: "u2",
    player1Username: "sk8r",
    player2Username: "rival",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: "u1",
    phase: "setting",
    currentSetter: "u1",
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: { toMillis: () => Date.now() + 86400000 },
    turnNumber: 1,
    winner: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("GamePlayScreen", () => {
  it("shows waiting screen when not setter or matcher", () => {
    const game = makeGame({ currentTurn: "u2", currentSetter: "u2", phase: "setting" });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByText(/Waiting on @rival/)).toBeInTheDocument();
    expect(screen.getByText(/setting a trick for you/)).toBeInTheDocument();
  });

  it("shows matching context on waiting screen", () => {
    const game = makeGame({ currentTurn: "u2", currentSetter: "u1", phase: "matching" });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByText(/attempting to match your trick/)).toBeInTheDocument();
  });

  it("onBack callback works on waiting screen", async () => {
    const onBack = vi.fn();
    const game = makeGame({ currentTurn: "u2", currentSetter: "u2" });
    render(<GamePlayScreen game={game} profile={profile} onBack={onBack} />);

    await userEvent.click(screen.getByText("← Back to Games"));
    expect(onBack).toHaveBeenCalled();
  });

  it("onBack callback works on gameplay screen", async () => {
    const onBack = vi.fn();
    const game = makeGame();
    render(<GamePlayScreen game={game} profile={profile} onBack={onBack} />);

    await userEvent.click(screen.getByText("← Games"));
    expect(onBack).toHaveBeenCalled();
  });

  it("setter UI shows trick name input and phase banner", () => {
    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByText("Name your trick")).toBeInTheDocument();
    expect(screen.getByLabelText("TRICK NAME")).toBeInTheDocument();
    expect(screen.getByText("Name your trick to start recording")).toBeInTheDocument();
  });

  it("forfeit check runs for expired deadline", async () => {
    mockForfeitExpiredTurn.mockResolvedValue({ forfeited: false, winner: null });
    const game = makeGame({
      currentTurn: "u2",
      currentSetter: "u2",
      turnDeadline: { toMillis: () => Date.now() - 1000 },
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(mockForfeitExpiredTurn).toHaveBeenCalledWith("game1");
    });
  });

  it("forfeit check error does not crash", async () => {
    mockForfeitExpiredTurn.mockRejectedValueOnce(new Error("fail"));
    const game = makeGame({
      currentTurn: "u2",
      currentSetter: "u2",
      turnDeadline: { toMillis: () => Date.now() - 1000 },
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(mockForfeitExpiredTurn).toHaveBeenCalled();
    });
  });

  it("does not check forfeit for non-active games", () => {
    const game = makeGame({ status: "complete", turnDeadline: { toMillis: () => Date.now() - 1000 } });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(mockForfeitExpiredTurn).not.toHaveBeenCalled();
  });

  it("does not check forfeit when deadline is in the future", () => {
    const game = makeGame({
      currentTurn: "u2",
      currentSetter: "u2",
      turnDeadline: { toMillis: () => Date.now() + 86400000 },
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(mockForfeitExpiredTurn).not.toHaveBeenCalled();
  });

  it("shows letter display for both players", () => {
    const game = makeGame({ p1Letters: 2, p2Letters: 3 });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByText("VS")).toBeInTheDocument();
  });

  it("matcher UI shows trick name and match prompt", () => {
    const game = makeGame({
      currentTurn: "u1",
      currentSetter: "u2",
      phase: "matching",
      currentTrickName: "Kickflip",
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByText(/Match @/)).toBeInTheDocument();
    expect(screen.getByText(/Kickflip/)).toBeInTheDocument();
  });

  it("matcher UI shows setter video when available", () => {
    const game = makeGame({
      currentTurn: "u1",
      currentSetter: "u2",
      phase: "matching",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/video.mp4",
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByLabelText(/Video of Kickflip/)).toBeInTheDocument();
  });

  it("shows player2 perspective correctly", () => {
    const game = makeGame({
      currentTurn: "u2",
      currentSetter: "u2",
      phase: "setting",
    });
    const p2Profile = { ...profile, uid: "u2", username: "rival" };
    render(<GamePlayScreen game={game} profile={p2Profile} onBack={vi.fn()} />);

    expect(screen.getByText("Name your trick")).toBeInTheDocument();
  });
});
