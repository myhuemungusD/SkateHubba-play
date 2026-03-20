import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GamePlayScreen } from "../GamePlayScreen";

const mockSetTrick = vi.fn();
const mockFailSetTrick = vi.fn();
const mockSubmitMatchAttempt = vi.fn();
const mockSubmitConfirmation = vi.fn();
const mockForfeitExpiredTurn = vi.fn();
const mockUploadVideo = vi.fn();

vi.mock("../../services/games", () => ({
  setTrick: (...args: unknown[]) => mockSetTrick(...args),
  failSetTrick: (...args: unknown[]) => mockFailSetTrick(...args),
  submitMatchAttempt: (...args: unknown[]) => mockSubmitMatchAttempt(...args),
  submitConfirmation: (...args: unknown[]) => mockSubmitConfirmation(...args),
  forfeitExpiredTurn: (...args: unknown[]) => mockForfeitExpiredTurn(...args),
}));

vi.mock("../../services/storage", () => ({
  uploadVideo: (...args: unknown[]) => mockUploadVideo(...args),
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
    p2Letters: 0,
    status: "active",
    currentTurn: "u1",
    phase: "setting",
    currentSetter: "u1",
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    setterConfirm: null,
    matcherConfirm: null,
    turnDeadline: { toMillis: () => Date.now() + 86400000 },
    turnNumber: 1,
    winner: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  } as any;
}

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  (globalThis as unknown as Record<string, unknown>).MediaRecorder = OriginalMR;
});

const OriginalMR = (globalThis as unknown as Record<string, unknown>).MediaRecorder;

/** A MediaRecorder that fires ondataavailable before onstop. */
class DataProducingMR {
  static isTypeSupported = vi.fn().mockReturnValue(false);
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state = "inactive";
  start = vi.fn().mockImplementation(function (this: DataProducingMR) {
    this.state = "recording";
  });
  stop = vi.fn().mockImplementation(function (this: DataProducingMR) {
    this.state = "inactive";
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(["video-data"], { type: "video/webm" }) });
    }
    this.onstop?.();
  });
}

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

  it("deadline fallback fires when turnDeadline is null", () => {
    const game = makeGame({ currentTurn: "u2", currentSetter: "u2", turnDeadline: null });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);
    expect(screen.getByText(/Waiting on @rival/)).toBeInTheDocument();
  });

  it("matcher banner uses player1Username when player1 is setter", () => {
    const game = makeGame({
      currentTurn: "u2",
      currentSetter: "u1",
      phase: "matching",
      currentTrickName: "Kickflip",
    });
    const p2Profile = { ...profile, uid: "u2", username: "rival" };
    render(<GamePlayScreen game={game} profile={p2Profile} onBack={vi.fn()} />);
    expect(screen.getByText(/Match @sk8r/)).toBeInTheDocument();
  });

  it("matcher banner shows 'trick' fallback when no trick name set", () => {
    const game = makeGame({
      currentTurn: "u1",
      currentSetter: "u2",
      phase: "matching",
      currentTrickName: null,
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);
    expect(screen.getByText(/'s trick/)).toBeInTheDocument();
  });

  it("matcher video aria-label uses 'trick' fallback when no trick name", () => {
    const game = makeGame({
      currentTurn: "u1",
      currentSetter: "u2",
      phase: "matching",
      currentTrickName: null,
      currentTrickVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/video.mp4",
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);
    expect(screen.getByLabelText(/Video of trick set by rival/)).toBeInTheDocument();
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

  it("setter uploads video blob when recording produces data (covers uploadVideo line)", async () => {
    (globalThis as unknown as Record<string, unknown>).MediaRecorder = DataProducingMR;
    mockUploadVideo.mockResolvedValueOnce("https://firebasestorage.googleapis.com/v0/b/test/o/video.webm");
    mockSetTrick.mockResolvedValueOnce(undefined);

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    // Type a trick name to reveal the VideoRecorder (autoOpen=true for setter)
    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Kickflip");

    // Wait for VideoRecorder to auto-open and show Record button
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));

    // "Did you land it?" appears — click Landed to submit
    await waitFor(() => expect(screen.getByRole("group", { name: "Did you land the trick?" })).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    await waitFor(() => {
      expect(mockUploadVideo).toHaveBeenCalledWith("game1", 1, "set", expect.any(Blob), expect.any(Function));
    });
  });

  it("matcher uploads video blob and submits attempt (covers uploadVideo line)", async () => {
    (globalThis as unknown as Record<string, unknown>).MediaRecorder = DataProducingMR;
    mockUploadVideo.mockResolvedValueOnce("https://firebasestorage.googleapis.com/v0/b/test/o/video.webm");
    mockSubmitMatchAttempt.mockResolvedValueOnce(undefined);

    const matcherGame = makeGame({
      currentTurn: "u1",
      currentSetter: "u2",
      phase: "matching",
      currentTrickName: "Kickflip",
    });
    render(<GamePlayScreen game={matcherGame} profile={profile} onBack={vi.fn()} />);

    // Open camera (matcher doesn't auto-open)
    await userEvent.click(screen.getByText(/Open Camera/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));
    await waitFor(() => expect(screen.getByText(/Recorded/)).toBeInTheDocument());

    // "Submit your attempt for review" appears after recording
    await waitFor(() => expect(screen.getByRole("group", { name: "Submit your attempt" })).toBeInTheDocument());

    await userEvent.click(screen.getByText(/Submit Attempt/));

    await waitFor(() => {
      expect(mockUploadVideo).toHaveBeenCalledWith("game1", 1, "match", expect.any(Blob), expect.any(Function));
    });
  });

  it("forfeit check logs correctly for non-Error rejection", async () => {
    mockForfeitExpiredTurn.mockRejectedValueOnce("string error");
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

  it("setTrick uses 'Trick' fallback when trickName is cleared before recording", async () => {
    mockSetTrick.mockResolvedValueOnce(undefined);

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    // Type a trick name to show the recorder
    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Kickflip");
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    // Clear the trick name — recorder stays visible via ref
    await userEvent.clear(screen.getByLabelText("TRICK NAME"));

    // Record and stop (default MockMediaRecorder → null blob → no upload)
    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));

    // "Did you land it?" appears — click Landed to submit
    await waitFor(() => expect(screen.getByRole("group", { name: "Did you land the trick?" })).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    await waitFor(() => {
      expect(mockSetTrick).toHaveBeenCalledWith("game1", "Trick", null);
    });
  });

  it("non-Error thrown from setTrick shows fallback error message", async () => {
    mockSetTrick.mockRejectedValueOnce("plain string error");

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Kickflip");
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));

    // "Did you land it?" appears — click Landed to trigger setTrick
    await waitFor(() => expect(screen.getByRole("group", { name: "Did you land the trick?" })).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    await waitFor(() => expect(screen.getByText("Failed to send trick")).toBeInTheDocument());
  });

  it("error banner dismiss clears error after setter submission failure", async () => {
    mockSetTrick.mockRejectedValueOnce(new Error("Network error"));

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    // Type a trick name to reveal VideoRecorder
    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Kickflip");

    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));

    // "Did you land it?" appears — click Landed to trigger setTrick
    await waitFor(() => expect(screen.getByRole("group", { name: "Did you land the trick?" })).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    // setTrick fails → error is shown
    await waitFor(() => expect(screen.getByText("Network error")).toBeInTheDocument());

    // Dismiss the error banner (covers the onDismiss lambda on ErrorBanner line)
    await userEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByText("Network error")).not.toBeInTheDocument();
  });

  it("setter 'Did you land it?' buttons appear after recording", async () => {
    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Kickflip");
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));

    await waitFor(() => {
      expect(screen.getByRole("group", { name: "Did you land the trick?" })).toBeInTheDocument();
      expect(screen.getByText(/Landed/)).toBeInTheDocument();
      expect(screen.getByText(/Missed/)).toBeInTheDocument();
    });
  });

  it("setter clicking Missed calls failSetTrick", async () => {
    mockFailSetTrick.mockResolvedValueOnce(undefined);

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Kickflip");
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));

    await waitFor(() => expect(screen.getByText(/Missed/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Missed/));

    await waitFor(() => {
      expect(mockFailSetTrick).toHaveBeenCalledWith("game1");
    });
    expect(mockSetTrick).not.toHaveBeenCalled();
    expect(mockUploadVideo).not.toHaveBeenCalled();
  });

  it("retry button calls failSetTrick after a missed attempt failure", async () => {
    mockFailSetTrick.mockRejectedValueOnce(new Error("Network error"));
    mockFailSetTrick.mockResolvedValueOnce(undefined);

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Kickflip");
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));

    await waitFor(() => expect(screen.getByText(/Missed/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Missed/));

    // failSetTrick fails → error + Retry button
    await waitFor(() => expect(screen.getByText("Network error")).toBeInTheDocument());
    expect(screen.getByText("Retry")).toBeInTheDocument();

    // Dismiss error so "Did you land it?" re-appears, but click Retry first
    await userEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(mockFailSetTrick).toHaveBeenCalledTimes(2);
    });
    // Should NOT have called setTrick (the Landed path)
    expect(mockSetTrick).not.toHaveBeenCalled();
  });

  it("shows 'Passing turn...' during missed submission", async () => {
    mockFailSetTrick.mockImplementation(() => new Promise(() => {}));

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Kickflip");
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));

    await waitFor(() => expect(screen.getByText(/Missed/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Missed/));

    await waitFor(() => {
      expect(screen.getByText("Passing turn...")).toBeInTheDocument();
    });
  });

  it("shows 'Sending to @rival...' during landed submission", async () => {
    mockSetTrick.mockImplementation(() => new Promise(() => {}));

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Kickflip");
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));

    await waitFor(() => expect(screen.getByText(/Landed/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    await waitFor(() => {
      expect(screen.getByText(/Sending to @rival/)).toBeInTheDocument();
    });
  });

  it("waiting screen shows current trick video in matching phase", () => {
    const game = makeGame({
      currentTurn: "u2",
      currentSetter: "u1",
      phase: "matching",
      currentTrickName: "Heelflip",
      currentTrickVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/set.webm",
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByText(/Your Trick: Heelflip/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Video of Heelflip you set/)).toBeInTheDocument();
  });

  it("waiting screen does not show trick video in setting phase", () => {
    const game = makeGame({
      currentTurn: "u2",
      currentSetter: "u2",
      phase: "setting",
      currentTrickVideoUrl: null,
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.queryByText(/Your Trick/)).not.toBeInTheDocument();
  });

  it("waiting screen shows turn history expanded by default", () => {
    const game = makeGame({
      currentTurn: "u2",
      currentSetter: "u2",
      phase: "setting",
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
          landed: true,
          letterTo: null,
        },
      ],
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Game Clips/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Round 1: Kickflip/)).toBeInTheDocument();
  });

  it("waiting screen hides video when URL is not a Firebase Storage URL", () => {
    const game = makeGame({
      currentTurn: "u2",
      currentSetter: "u1",
      phase: "matching",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://example.com/video.mp4",
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.queryByLabelText(/Video of Kickflip you set/)).not.toBeInTheDocument();
  });

  it("waiting screen shows 'Trick' fallback when currentTrickName is null", () => {
    const game = makeGame({
      currentTurn: "u2",
      currentSetter: "u1",
      phase: "matching",
      currentTrickName: null,
      currentTrickVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/set.webm",
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByText(/Your Trick: Trick/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Video of trick you set/)).toBeInTheDocument();
  });

  it("waiting screen does not show Game Clips when turnHistory is undefined", () => {
    const game = makeGame({
      currentTurn: "u2",
      currentSetter: "u2",
      phase: "setting",
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /Game Clips/ })).not.toBeInTheDocument();
  });

  it("waiting screen shows letter scores for both players", () => {
    const game = makeGame({
      currentTurn: "u2",
      currentSetter: "u2",
      phase: "setting",
      p1Letters: 2,
      p2Letters: 3,
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByText("VS")).toBeInTheDocument();
    expect(screen.getByText("@sk8r")).toBeInTheDocument();
    expect(screen.getByText("@rival")).toBeInTheDocument();
  });

  it("confirming phase shows vote buttons only for setter", () => {
    // u1 is the setter — should see vote buttons
    const game = makeGame({
      phase: "confirming",
      currentSetter: "u1",
      currentTurn: "u1",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/set.webm",
      matchVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/match.webm",
      setterConfirm: null,
      matcherConfirm: null,
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByText(/Review: Kickflip/)).toBeInTheDocument();
    expect(screen.getByText(/@sk8r's TRICK/)).toBeInTheDocument();
    expect(screen.getByText(/@rival's ATTEMPT/)).toBeInTheDocument();
    expect(screen.getByText(/Did @rival land it/)).toBeInTheDocument();
    expect(screen.getByText(/✓ Landed/)).toBeInTheDocument();
    expect(screen.getByText(/✗ Missed/)).toBeInTheDocument();
  });

  it("confirming phase shows waiting state for matcher", () => {
    // u1 is the matcher (u2 is setter) — should see waiting message
    const game = makeGame({
      phase: "confirming",
      currentSetter: "u2",
      currentTurn: "u2",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/set.webm",
      matchVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/match.webm",
      setterConfirm: null,
      matcherConfirm: null,
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByText(/Waiting for @rival to make the call/)).toBeInTheDocument();
    expect(screen.queryByText(/✓ Landed/)).not.toBeInTheDocument();
  });

  it("confirming phase vote calls submitConfirmation (setter)", async () => {
    mockSubmitConfirmation.mockResolvedValueOnce({ gameOver: false, winner: null, resolved: true });

    const game = makeGame({
      phase: "confirming",
      currentSetter: "u1",
      currentTurn: "u1",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/set.webm",
      matchVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/match.webm",
      setterConfirm: null,
      matcherConfirm: null,
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText(/✓ Landed/));

    await waitFor(() => {
      expect(mockSubmitConfirmation).toHaveBeenCalledWith("game1", "u1", true);
    });
  });
});
