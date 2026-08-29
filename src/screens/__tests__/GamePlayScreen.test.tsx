import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GamePlayScreen } from "../GamePlayScreen";

const mockSetTrick = vi.fn();
const mockFailSetTrick = vi.fn();
const mockSubmitMatchAttempt = vi.fn();
const mockResolveDispute = vi.fn();
const mockForfeitExpiredTurn = vi.fn();
const mockUploadVideo = vi.fn();
/** The download URL every successful take resolves to in this suite. */
const VIDEO_URL = "https://firebasestorage.googleapis.com/v0/b/test/o/video.webm";
const mockCallBS = vi.fn();
const mockJudgeRuleSetTrick = vi.fn();
const mockAcceptJudgeInvite = vi.fn();
const mockDeclineJudgeInvite = vi.fn();
const mockAcceptLanded = vi.fn();
const mockRaiseDispute = vi.fn();
const mockCanRaiseDispute = vi.fn();
const mockSubscribeToGameDispute = vi.fn();

vi.mock("../../services/games", () => ({
  setTrick: (...args: unknown[]) => mockSetTrick(...args),
  failSetTrick: (...args: unknown[]) => mockFailSetTrick(...args),
  submitMatchAttempt: (...args: unknown[]) => mockSubmitMatchAttempt(...args),
  resolveDispute: (...args: unknown[]) => mockResolveDispute(...args),
  forfeitExpiredTurn: (...args: unknown[]) => mockForfeitExpiredTurn(...args),
  callBSOnSetTrick: (...args: unknown[]) => mockCallBS(...args),
  judgeRuleSetTrick: (...args: unknown[]) => mockJudgeRuleSetTrick(...args),
  acceptJudgeInvite: (...args: unknown[]) => mockAcceptJudgeInvite(...args),
  declineJudgeInvite: (...args: unknown[]) => mockDeclineJudgeInvite(...args),
  acceptLanded: (...args: unknown[]) => mockAcceptLanded(...args),
  isJudgeActive: (game: { judgeId?: string | null; judgeStatus?: string | null }) =>
    !!game.judgeId && game.judgeStatus === "accepted",
}));

vi.mock("../../services/disputes", () => ({
  raiseDispute: (...args: unknown[]) => mockRaiseDispute(...args),
  canRaiseDispute: (...args: unknown[]) => mockCanRaiseDispute(...args),
  subscribeToGameDispute: (...args: unknown[]) => mockSubscribeToGameDispute(...args),
}));

vi.mock("../../services/storage", () => ({
  uploadVideo: (...args: unknown[]) => mockUploadVideo(...args),
}));

const mockPlayHaptic = vi.fn();

// Stub `playHaptic` (the side-effect) but defer to the real `hapticForVariant`
// table — the mapping is production logic, not test-owned.
vi.mock("../../services/haptics", async () => {
  const actual = await vi.importActual<typeof import("../../services/haptics")>("../../services/haptics");
  return {
    ...actual,
    playHaptic: (...args: unknown[]) => mockPlayHaptic(...args),
  };
});

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
    turnDeadline: { toMillis: () => Date.now() + 86400000 },
    turnNumber: 1,
    winner: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: a landed claim is disputable unless a test says otherwise.
  mockCanRaiseDispute.mockReturnValue(true);
  mockSubscribeToGameDispute.mockReturnValue(vi.fn());
  // Every take that produces bytes uploads before setTrick/submitMatchAttempt
  // runs, so the upload has to resolve to a URL by default. Without it the
  // upload settles as `undefined` and the screen sits on the progress bar
  // instead of the submit copy the assertions look for.
  mockUploadVideo.mockResolvedValue(VIDEO_URL);
});

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
      // Must exceed MIN_UPLOAD_BYTES (1 KB): the recorder rejects anything at
      // or below that as a failed encode, so a short fixture would make every
      // "records and uploads" case here take the rejection path instead.
      this.ondataavailable({ data: new Blob(["video-data".padEnd(2048, ".")], { type: "video/webm" }) });
    }
    this.onstop?.();
  });
}

/**
 * Drive the setter through one complete take: name the trick to reveal the
 * recorder, tap the camera open, record, stop. The tap is not optional — the
 * recorder never acquires a stream outside a user gesture unless camera and mic
 * are already granted, which no test here arranges. Leaves the screen on the
 * "Did you land it?" decision.
 */
async function setterRecordsATake() {
  // A REAL take. The global default MockMediaRecorder emits no data, so the
  // recorder reports the take as failed (onRecorded(null)) — the setter then
  // has nothing to upload and setTrick would go out with a null videoUrl,
  // which firestore.rules rejects outright (the setting→matching branch
  // requires a bucket-pinned currentTrickVideoUrl). These cases are about
  // what happens AFTER a successful take, so install the recorder that
  // actually produces bytes.
  (globalThis as unknown as Record<string, unknown>).MediaRecorder = DataProducingMR;
  await userEvent.type(screen.getByLabelText("TRICK NAME"), "Kickflip");
  await userEvent.click(await screen.findByText(/Open Camera/));
  await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: /Record/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));
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

    expect(screen.getByPlaceholderText("Name your trick")).toBeInTheDocument();
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
      expect(mockForfeitExpiredTurn).toHaveBeenCalledWith("game1", "u1");
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

    expect(
      screen.getByText(
        (_, el) => el?.tagName === "SPAN" && /Match/.test(el?.textContent ?? "") && /@/.test(el?.textContent ?? ""),
      ),
    ).toBeInTheDocument();
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
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "SPAN" &&
          (el?.textContent?.includes("Match") ?? false) &&
          (el?.textContent?.includes("@sk8r") ?? false),
      ),
    ).toBeInTheDocument();
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

    expect(screen.getByPlaceholderText("Name your trick")).toBeInTheDocument();
  });

  it("setter uploads video blob when recording produces data (covers uploadVideo line)", async () => {
    (globalThis as unknown as Record<string, unknown>).MediaRecorder = DataProducingMR;
    mockUploadVideo.mockResolvedValueOnce("https://firebasestorage.googleapis.com/v0/b/test/o/video.webm");
    mockSetTrick.mockResolvedValueOnce(undefined);

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    await setterRecordsATake();

    // "Did you land it?" appears — click Landed to submit
    await waitFor(() => expect(screen.getByRole("group", { name: "Did you land the trick?" })).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    await waitFor(() => {
      // Call signature: (gameId, turnNumber, role, blob, onProgress, maxRetries, signal)
      // maxRetries is left as `undefined` (screen doesn't override the default);
      // signal is an AbortSignal so a future cancel-button can plug in.
      expect(mockUploadVideo).toHaveBeenCalledWith(
        "game1",
        1,
        "set",
        expect.any(Blob),
        expect.any(Function),
        undefined,
        expect.any(AbortSignal),
      );
    });
  });

  it("matcher records, reviews, and self-judges landed (uploads video and submits)", async () => {
    (globalThis as unknown as Record<string, unknown>).MediaRecorder = DataProducingMR;
    mockUploadVideo.mockResolvedValueOnce("https://firebasestorage.googleapis.com/v0/b/test/o/video.webm");
    mockSubmitMatchAttempt.mockResolvedValueOnce({ gameOver: false, winner: null });

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

    // "Did you land it?" appears — matcher self-judges
    await waitFor(() => expect(screen.getByRole("group", { name: "Did you land the trick?" })).toBeInTheDocument());

    await userEvent.click(screen.getByText(/✓ Landed/));

    await waitFor(() => {
      // See setter-upload test for the 7-argument signature rationale.
      expect(mockUploadVideo).toHaveBeenCalledWith(
        "game1",
        1,
        "match",
        expect.any(Blob),
        expect.any(Function),
        undefined,
        expect.any(AbortSignal),
      );
      expect(mockSubmitMatchAttempt).toHaveBeenCalledWith(
        "game1",
        "https://firebasestorage.googleapis.com/v0/b/test/o/video.webm",
        true,
      );
    });
    expect(mockPlayHaptic).toHaveBeenCalledWith("trick_landed");
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

  it("setTrick receives empty string when trickName is cleared before recording", async () => {
    mockSetTrick.mockRejectedValueOnce(new Error("Trick name cannot be empty"));

    (globalThis as unknown as Record<string, unknown>).MediaRecorder = DataProducingMR;

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    // Type a trick name to show the recorder
    await userEvent.type(screen.getByLabelText("TRICK NAME"), "Kickflip");
    await userEvent.click(await screen.findByText(/Open Camera/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    // Clear the trick name — recorder stays visible via ref
    await userEvent.clear(screen.getByLabelText("TRICK NAME"));

    // Record and stop. The take has to produce real bytes: a setter whose
    // recording yields nothing never reaches the decision panel at all (the
    // null-take guard in useGamePlayController), and this case is about the
    // trick NAME, not the video.
    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));

    // "Did you land it?" appears — click Landed to submit
    await waitFor(() => expect(screen.getByRole("group", { name: "Did you land the trick?" })).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    await waitFor(() => {
      expect(mockSetTrick).toHaveBeenCalledWith("game1", "", VIDEO_URL);
    });

    // Service-level validation surfaces the error
    await waitFor(() => {
      expect(screen.getByText("Trick name cannot be empty")).toBeInTheDocument();
    });
  });

  it("non-Error thrown from setTrick shows fallback error message", async () => {
    mockSetTrick.mockRejectedValueOnce("plain string error");

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    await setterRecordsATake();

    // "Did you land it?" appears — click Landed to trigger setTrick
    await waitFor(() => expect(screen.getByRole("group", { name: "Did you land the trick?" })).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    await waitFor(() => expect(screen.getByText("Failed to send trick")).toBeInTheDocument());
  });

  it("error banner dismiss clears error after setter submission failure", async () => {
    mockSetTrick.mockRejectedValueOnce(new Error("Network error"));

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    await setterRecordsATake();

    // "Did you land it?" appears — click Landed to trigger setTrick
    await waitFor(() => expect(screen.getByRole("group", { name: "Did you land the trick?" })).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Landed/));

    // setTrick fails → error is shown
    await waitFor(() => expect(screen.getByText("Network error")).toBeInTheDocument());

    // Dismiss the error banner (covers the onDismiss lambda on ErrorBanner line)
    await userEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByText("Network error")).not.toBeInTheDocument();
  });

  it("setter sees 'Did you land it?' immediately after recording", async () => {
    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    await setterRecordsATake();

    // Decision buttons appear immediately — no review step
    await waitFor(() => {
      expect(screen.getByRole("group", { name: "Did you land the trick?" })).toBeInTheDocument();
      expect(screen.getByText(/Landed/)).toBeInTheDocument();
      expect(screen.getByText(/Missed/)).toBeInTheDocument();
    });
  });

  it("setter clicking Missed calls failSetTrick and fires trick_missed haptic", async () => {
    mockFailSetTrick.mockResolvedValueOnce(undefined);

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    await setterRecordsATake();

    await waitFor(() => expect(screen.getByText(/Missed/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Missed/));

    await waitFor(() => {
      expect(mockFailSetTrick).toHaveBeenCalledWith("game1");
    });
    expect(mockSetTrick).not.toHaveBeenCalled();
    expect(mockUploadVideo).not.toHaveBeenCalled();
    expect(mockPlayHaptic).toHaveBeenCalledWith("trick_missed");
  });

  it("retry button calls failSetTrick after a missed attempt failure", async () => {
    mockFailSetTrick.mockRejectedValueOnce(new Error("Network error"));
    mockFailSetTrick.mockResolvedValueOnce(undefined);

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    await setterRecordsATake();

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

    await setterRecordsATake();

    await waitFor(() => expect(screen.getByText(/Missed/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Missed/));

    await waitFor(() => {
      expect(screen.getByText("Passing turn...")).toBeInTheDocument();
    });
  });

  it("shows 'Sending to @rival...' during landed submission", async () => {
    mockSetTrick.mockImplementation(() => new Promise(() => {}));

    render(<GamePlayScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);

    await setterRecordsATake();

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

  it("matcher sees 'Did you land it?' immediately after recording (self-judging)", async () => {
    const game = makeGame({
      currentTurn: "u1",
      currentSetter: "u2",
      phase: "matching",
      currentTrickName: "Kickflip",
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    // Open camera
    await userEvent.click(screen.getByText(/Open Camera/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Record/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop Recording/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Stop Recording/ }));

    // Self-judge buttons appear
    await waitFor(() => {
      expect(screen.getByRole("group", { name: "Did you land the trick?" })).toBeInTheDocument();
      expect(screen.getByText(/✓ Landed/)).toBeInTheDocument();
      expect(screen.getByText(/✗ Missed/)).toBeInTheDocument();
    });
  });

  // ── Dispute review (judge rules on matcher's "landed" claim) ──
  // Disputes only exist in games with an active judge. The setter never
  // self-judges. These tests pivot the acting profile to the judge.

  const judgeProfile = { ...profile, uid: "u3", username: "judge" };
  function makeJudgeGame(overrides: Record<string, unknown> = {}) {
    return makeGame({
      judgeId: "u3",
      judgeUsername: "judge",
      judgeStatus: "accepted",
      ...overrides,
    });
  }

  it("shows judge review UI when phase is disputable and user is the judge", () => {
    const game = makeJudgeGame({
      phase: "disputable",
      currentTurn: "u3", // judge reviews
      currentSetter: "u1",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/set.webm",
      matchVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/match.webm",
    });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    expect(screen.getByText(/REFEREE'S CALL/)).toBeInTheDocument();
    expect(screen.getByText(/claims they landed/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Rule landed or missed" })).toBeInTheDocument();
    expect(screen.getByText("Landed")).toBeInTheDocument();
    expect(screen.getByText("Missed")).toBeInTheDocument();
  });

  it("shows setter's trick video and matcher's attempt video in dispute review", () => {
    const game = makeJudgeGame({
      phase: "disputable",
      currentTurn: "u3",
      currentSetter: "u1",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/set.webm",
      matchVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/match.webm",
    });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    expect(screen.getByLabelText(/sk8r's Kickflip video/)).toBeInTheDocument();
    expect(screen.getByLabelText(/rival's match attempt video/)).toBeInTheDocument();
  });

  it("calls resolveDispute(true) when judge clicks Landed", async () => {
    mockResolveDispute.mockResolvedValueOnce({ gameOver: false, winner: null });
    const game = makeJudgeGame({
      phase: "disputable",
      currentTurn: "u3",
      currentSetter: "u1",
      currentTrickName: "Kickflip",
    });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Landed"));

    await waitFor(() => {
      expect(mockResolveDispute).toHaveBeenCalledWith("game1", true);
    });
  });

  it("calls resolveDispute(false) when judge clicks Missed", async () => {
    mockResolveDispute.mockResolvedValueOnce({ gameOver: false, winner: null });
    const game = makeJudgeGame({
      phase: "disputable",
      currentTurn: "u3",
      currentSetter: "u1",
      currentTrickName: "Kickflip",
    });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Missed"));

    await waitFor(() => {
      expect(mockResolveDispute).toHaveBeenCalledWith("game1", false);
    });
  });

  it("shows error when resolveDispute fails", async () => {
    mockResolveDispute.mockRejectedValueOnce(new Error("Network error"));
    const game = makeJudgeGame({
      phase: "disputable",
      currentTurn: "u3",
      currentSetter: "u1",
      currentTrickName: "Kickflip",
    });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Landed"));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("shows waiting screen when matcher is waiting during disputable phase", () => {
    const game = makeJudgeGame({
      phase: "disputable",
      currentTurn: "u3", // judge reviews, matcher (u1) waits
      currentSetter: "u2",
      currentTrickName: "Kickflip",
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    // Waiting-on label flips to the referee when they hold the turn.
    expect(screen.getByText(/Referee is reviewing the match call/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting on @judge/)).toBeInTheDocument();
  });

  it("shows 'Resolving...' during dispute submission", async () => {
    mockResolveDispute.mockImplementation(() => new Promise(() => {}));
    const game = makeJudgeGame({
      phase: "disputable",
      currentTurn: "u3",
      currentSetter: "u1",
      currentTrickName: "Kickflip",
    });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Landed"));

    await waitFor(() => {
      expect(screen.getByText("Resolving...")).toBeInTheDocument();
    });
  });

  it("shows fallback text when no videos in dispute review", () => {
    const game = makeJudgeGame({
      phase: "disputable",
      currentTurn: "u3",
      currentSetter: "u1",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: null,
      matchVideoUrl: null,
    });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    expect(screen.getByText(/No videos recorded/)).toBeInTheDocument();
  });

  it("dispute retry preserves the original action (false for Missed)", async () => {
    mockResolveDispute.mockRejectedValueOnce(new Error("Network error"));
    mockResolveDispute.mockResolvedValueOnce({ gameOver: false, winner: null });
    const game = makeJudgeGame({
      phase: "disputable",
      currentTurn: "u3",
      currentSetter: "u1",
      currentTrickName: "Kickflip",
    });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    // Judge clicks Missed, which fails
    await userEvent.click(screen.getByText("Missed"));
    await waitFor(() => expect(screen.getByText("Network error")).toBeInTheDocument());

    // Retry should call resolveDispute(game1, false) — NOT true
    await userEvent.click(screen.getByText("Retry"));
    await waitFor(() => {
      expect(mockResolveDispute).toHaveBeenCalledTimes(2);
      expect(mockResolveDispute).toHaveBeenLastCalledWith("game1", false);
    });
  });

  it("shows setReview UI with Clean/Sketchy buttons", () => {
    const game = makeJudgeGame({
      phase: "setReview",
      currentTurn: "u3",
      currentSetter: "u1",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/set.webm",
    });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    expect(screen.getByText(/CALL BS REVIEW/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Rule clean or sketchy" })).toBeInTheDocument();
    expect(screen.getByText("Clean")).toBeInTheDocument();
    expect(screen.getByText("Sketchy")).toBeInTheDocument();
  });

  it("calls judgeRuleSetTrick(true) when judge clicks Clean", async () => {
    mockJudgeRuleSetTrick.mockResolvedValueOnce(undefined);
    const game = makeJudgeGame({
      phase: "setReview",
      currentTurn: "u3",
      currentSetter: "u1",
      currentTrickName: "Kickflip",
    });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Clean"));
    await waitFor(() => {
      expect(mockJudgeRuleSetTrick).toHaveBeenCalledWith("game1", true);
    });
  });

  it("calls judgeRuleSetTrick(false) when judge clicks Sketchy", async () => {
    mockJudgeRuleSetTrick.mockResolvedValueOnce(undefined);
    const game = makeJudgeGame({
      phase: "setReview",
      currentTurn: "u3",
      currentSetter: "u1",
      currentTrickName: "Kickflip",
    });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Sketchy"));
    await waitFor(() => {
      expect(mockJudgeRuleSetTrick).toHaveBeenCalledWith("game1", false);
    });
  });

  it("shows retry for setReview when judgeRuleSetTrick fails, preserving the action", async () => {
    mockJudgeRuleSetTrick.mockRejectedValueOnce(new Error("Timeout"));
    mockJudgeRuleSetTrick.mockResolvedValueOnce(undefined);
    const game = makeJudgeGame({
      phase: "setReview",
      currentTurn: "u3",
      currentSetter: "u1",
      currentTrickName: "Kickflip",
    });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Sketchy"));
    await waitFor(() => expect(screen.getByText("Timeout")).toBeInTheDocument());

    // Retry should call judgeRuleSetTrick(game1, false)
    await userEvent.click(screen.getByText("Retry"));
    await waitFor(() => {
      expect(mockJudgeRuleSetTrick).toHaveBeenCalledTimes(2);
      expect(mockJudgeRuleSetTrick).toHaveBeenLastCalledWith("game1", false);
    });
  });

  it("shows judge pending badge to players", () => {
    const game = makeGame({
      judgeId: "u3",
      judgeUsername: "judge",
      judgeStatus: "pending",
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByTestId("judge-pending-badge")).toBeInTheDocument();
    expect(screen.getByText(/honor system applies/)).toBeInTheDocument();
  });

  it("shows judge active badge to players", () => {
    const game = makeJudgeGame();
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByTestId("judge-active-badge")).toBeInTheDocument();
    expect(screen.getByText(/@judge rules disputes/)).toBeInTheDocument();
  });

  it("shows judge invite card for pending judge", () => {
    const game = makeJudgeGame({ judgeStatus: "pending" });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    expect(screen.getByTestId("judge-invite-card")).toBeInTheDocument();
    expect(screen.getByText(/REFEREE INVITE/)).toBeInTheDocument();
  });

  it("calls acceptJudgeInvite when judge clicks Accept", async () => {
    mockAcceptJudgeInvite.mockResolvedValueOnce(undefined);
    const game = makeJudgeGame({ judgeStatus: "pending" });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Accept"));
    await waitFor(() => {
      expect(mockAcceptJudgeInvite).toHaveBeenCalledWith("game1");
    });
  });

  it("calls declineJudgeInvite when judge clicks Decline", async () => {
    mockDeclineJudgeInvite.mockResolvedValueOnce(undefined);
    const game = makeJudgeGame({ judgeStatus: "pending" });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Decline"));
    await waitFor(() => {
      expect(mockDeclineJudgeInvite).toHaveBeenCalledWith("game1");
    });
  });

  it("guards against double-submit while accept is in flight", async () => {
    // First click hangs (never resolves). The in-flight guard keeps the accept
    // from firing twice: the card swaps the buttons for a "Submitting..." state,
    // and the judgeActionSubmittedRef short-circuits any racing re-entry.
    mockAcceptJudgeInvite.mockImplementation(() => new Promise(() => {}));
    const game = makeJudgeGame({ judgeStatus: "pending" });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Accept"));

    await waitFor(() => {
      expect(screen.getByText("Submitting...")).toBeInTheDocument();
    });
    // Buttons are gone while in flight, so no second click is possible.
    expect(screen.queryByText("Accept")).not.toBeInTheDocument();
    expect(mockAcceptJudgeInvite).toHaveBeenCalledTimes(1);
  });

  it("re-arms accept after a failed attempt so the judge can retry", async () => {
    // A rejected accept must reset judgeActionSubmittedRef so a subsequent
    // click can retry (mirrors callBS / dispute retry semantics).
    mockAcceptJudgeInvite.mockRejectedValueOnce(new Error("Network error"));
    mockAcceptJudgeInvite.mockResolvedValueOnce(undefined);
    const game = makeJudgeGame({ judgeStatus: "pending" });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Accept"));
    await waitFor(() => expect(screen.getByText("Network error")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Accept"));
    await waitFor(() => {
      expect(mockAcceptJudgeInvite).toHaveBeenCalledTimes(2);
    });
  });

  it("shows 'Ruling...' during setReview submission", async () => {
    mockJudgeRuleSetTrick.mockImplementation(() => new Promise(() => {}));
    const game = makeJudgeGame({
      phase: "setReview",
      currentTurn: "u3",
      currentSetter: "u1",
      currentTrickName: "Kickflip",
    });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Clean"));
    await waitFor(() => {
      expect(screen.getByText("Ruling...")).toBeInTheDocument();
    });
  });

  it("matcher sees Call BS button when judge is active", () => {
    const game = makeJudgeGame({
      currentTurn: "u1",
      currentSetter: "u2",
      phase: "matching",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/set.webm",
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByText("Call BS on this trick")).toBeInTheDocument();
    expect(screen.getByText(/Referee @judge will rule/)).toBeInTheDocument();
  });

  it("calls callBSOnSetTrick when matcher clicks Call BS", async () => {
    mockCallBS.mockResolvedValueOnce(undefined);
    const game = makeJudgeGame({
      currentTurn: "u1",
      currentSetter: "u2",
      phase: "matching",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/set.webm",
    });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Call BS on this trick"));
    await waitFor(() => {
      expect(mockCallBS).toHaveBeenCalledWith("game1");
    });
  });

  it("hides Flag button for judges (only players can report)", () => {
    const game = makeJudgeGame({
      phase: "disputable",
      currentTurn: "u3",
      currentSetter: "u1",
      currentTrickName: "Kickflip",
    });
    render(<GamePlayScreen game={game} profile={judgeProfile} onBack={vi.fn()} />);

    expect(screen.queryByLabelText("Report opponent")).not.toBeInTheDocument();
  });

  // ── Binding community dispute (honor-system pendingReview / communityReview) ──

  function makePendingReviewGame(overrides: Record<string, unknown> = {}) {
    return makeGame({
      phase: "pendingReview",
      currentSetter: "u1", // u1 is the setter who accepts/disputes
      currentTurn: "u2", // pinned matcher
      reviewFor: "u2", // u2 claimed the landed trick
      currentTrickName: "Kickflip",
      matchVideoUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/match.webm",
      reviewDeadline: { toMillis: () => Date.now() + 86400000 },
      ...overrides,
    });
  }

  function makeCommunityDispute(overrides: Record<string, unknown> = {}) {
    return {
      id: "game1_1",
      gameId: "game1",
      landVotes: 0,
      turnNumber: 1,
      trickName: "Kickflip",
      setterUid: "u1",
      setterUsername: "sk8r",
      status: "open",
      matcherUid: "u2",
      matcherUsername: "rival",
      setVideoUrl: null,
      matchVideoUrl: "https://example.com/match.webm",
      spotId: null,
      createdAt: null,
      moderationStatus: "active",
      bailVotes: 0,
      ...overrides,
    };
  }

  it("shows the setter Accept/Dispute surface with the matcher's attempt in pendingReview", () => {
    render(<GamePlayScreen game={makePendingReviewGame()} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByText("THEY CLAIM THEY LANDED")).toBeInTheDocument();
    expect(screen.getByText(/@rival says they matched your Kickflip/)).toBeInTheDocument();
    expect(screen.getByLabelText(/rival's match attempt video/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Accept the landed claim or dispute it" })).toBeInTheDocument();
    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Dispute")).toBeInTheDocument();
  });

  it("calls acceptLanded when the setter accepts the landed claim", async () => {
    mockAcceptLanded.mockResolvedValueOnce(undefined);
    render(<GamePlayScreen game={makePendingReviewGame()} profile={profile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Accept"));
    await waitFor(() => expect(mockAcceptLanded).toHaveBeenCalledWith("game1"));
  });

  it("calls raiseDispute when the setter disputes the landed claim", async () => {
    mockRaiseDispute.mockResolvedValueOnce(undefined);
    render(<GamePlayScreen game={makePendingReviewGame()} profile={profile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Dispute"));
    await waitFor(() => expect(mockRaiseDispute).toHaveBeenCalledWith("game1"));
  });

  it("hides the Dispute button when the claim can no longer be disputed", () => {
    mockCanRaiseDispute.mockReturnValue(false);
    render(<GamePlayScreen game={makePendingReviewGame()} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.queryByText("Dispute")).not.toBeInTheDocument();
  });

  it("re-arms the setter surface after a failed accept so it can retry", async () => {
    mockAcceptLanded.mockRejectedValueOnce(new Error("Network error"));
    mockAcceptLanded.mockResolvedValueOnce(undefined);
    render(<GamePlayScreen game={makePendingReviewGame()} profile={profile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Accept"));
    await waitFor(() => expect(screen.getByText("Network error")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(mockAcceptLanded).toHaveBeenCalledTimes(2));
  });

  it("shows the matcher a read-only waiting surface during pendingReview", () => {
    const p2Profile = { ...profile, uid: "u2", username: "rival" };
    render(<GamePlayScreen game={makePendingReviewGame()} profile={p2Profile} onBack={vi.fn()} />);

    expect(screen.getByText("AWAITING THEIR CALL")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for @sk8r to accept or dispute your landed claim/)).toBeInTheDocument();
    expect(screen.queryByText("Accept")).not.toBeInTheDocument();
    expect(screen.queryByText("Dispute")).not.toBeInTheDocument();
  });

  it("shows both players the current community tally", () => {
    const game = makePendingReviewGame({ phase: "communityReview" });
    const dispute = makeCommunityDispute({ landVotes: 2, bailVotes: 1 });
    mockSubscribeToGameDispute.mockImplementation(
      (_gameId: string, _turn: number, onChange: (value: unknown) => void) => {
        onChange(dispute);
        return vi.fn();
      },
    );
    const { unmount } = render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(screen.getByText("UNDER COMMUNITY REVIEW")).toBeInTheDocument();
    expect(screen.getByText("LAND 2")).toBeInTheDocument();
    expect(screen.getByText("1 BAIL")).toBeInTheDocument();
    expect(screen.getByText("3 TOTAL")).toBeInTheDocument();
    unmount();

    render(<GamePlayScreen game={game} profile={{ ...profile, uid: "u2", username: "rival" }} onBack={vi.fn()} />);
    expect(screen.getByText("LAND 2")).toBeInTheDocument();
    expect(screen.getByText("1 BAIL")).toBeInTheDocument();
  });

  it("keeps the visible community tally current and handles a closed update", async () => {
    let push: ((value: unknown) => void) | undefined;
    mockSubscribeToGameDispute.mockImplementation(
      (_gameId: string, _turn: number, onChange: (value: unknown) => void) => {
        push = onChange;
        return vi.fn();
      },
    );
    render(
      <GamePlayScreen game={makePendingReviewGame({ phase: "communityReview" })} profile={profile} onBack={vi.fn()} />,
    );
    push?.(makeCommunityDispute({ landVotes: 1 }));
    expect(await screen.findByText("LAND 1")).toBeInTheDocument();
    push?.(makeCommunityDispute({ status: "closed", landVotes: 3, bailVotes: 2 }));
    expect(await screen.findByText("LAND 3")).toBeInTheDocument();
    expect(screen.getByText("2 BAIL")).toBeInTheDocument();
    expect(screen.getByText(/Voting has closed/)).toBeInTheDocument();
  });

  it.each([
    ["missing document", "The vote count is not available yet.", null],
    ["permission denial", "You don't have permission to view the vote count.", "permission-denied"],
    ["listener failure", "The vote count is temporarily unavailable.", "unavailable"],
  ])("keeps gameplay visible during a %s", async (_case, message, errorCode) => {
    mockSubscribeToGameDispute.mockImplementation(
      (
        _gameId: string,
        _turn: number,
        onChange: (value: unknown) => void,
        onError: (error: Error & { code?: string }) => void,
      ) => {
        if (errorCode === null) onChange(null);
        else onError(Object.assign(new Error("listener failed"), { code: errorCode }));
        return vi.fn();
      },
    );

    render(
      <GamePlayScreen game={makePendingReviewGame({ phase: "communityReview" })} profile={profile} onBack={vi.fn()} />,
    );

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText("UNDER COMMUNITY REVIEW")).toBeInTheDocument();
    expect(screen.getByTestId("letter-display-sk8r")).toBeInTheDocument();
    expect(screen.getByTestId("letter-display-rival")).toBeInTheDocument();
  });

  it("does not fire a forfeit for a frozen game with a lapsed turnDeadline", () => {
    const game = makePendingReviewGame({ turnDeadline: { toMillis: () => Date.now() - 1000 } });
    render(<GamePlayScreen game={game} profile={profile} onBack={vi.fn()} />);

    expect(mockForfeitExpiredTurn).not.toHaveBeenCalled();
  });
});
