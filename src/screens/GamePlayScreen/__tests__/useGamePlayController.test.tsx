import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GameDoc } from "../../../services/games";
import type { UserProfile } from "../../../services/users";
import { useGamePlayController } from "../useGamePlayController";
import { GamePlayScreen } from "..";

const svc = vi.hoisted(() => ({
  setTrick: vi.fn(),
  failSetTrick: vi.fn(),
  submitMatchAttempt: vi.fn(),
  forfeitExpiredTurn: vi.fn(),
  uploadVideo: vi.fn(),
  playHaptic: vi.fn(),
  captureException: vi.fn(),
  submitReport: vi.fn(),
}));

vi.mock("../../../services/games", () => ({
  setTrick: svc.setTrick,
  failSetTrick: svc.failSetTrick,
  submitMatchAttempt: svc.submitMatchAttempt,
  forfeitExpiredTurn: svc.forfeitExpiredTurn,
  isJudgeActive: () => false,
}));
vi.mock("../../../services/disputes", () => ({
  canRaiseDispute: () => false,
  subscribeToGameDispute: () => () => {},
}));
vi.mock("../../../services/storage", () => ({ uploadVideo: svc.uploadVideo }));
vi.mock("../../../services/haptics", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  playHaptic: svc.playHaptic,
}));
vi.mock("../../../lib/sentry", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  captureException: svc.captureException,
}));
vi.mock("../../../services/reports", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  submitReport: svc.submitReport,
}));

const me = { uid: "u1", username: "sk8r", stance: "regular", emailVerified: true } as unknown as UserProfile;

function game(overrides: Record<string, unknown> = {}): GameDoc {
  return {
    id: "g1",
    status: "active",
    phase: "setting",
    player1Uid: "u1",
    player2Uid: "u2",
    player1Username: "sk8r",
    player2Username: "rival",
    p1Letters: 0,
    p2Letters: 0,
    currentSetter: "u1",
    currentTurn: "u1",
    currentTrickName: null,
    turnNumber: 2,
    turnDeadline: { toMillis: () => Date.now() + 3_600_000 },
    ...overrides,
  } as unknown as GameDoc;
}

function abortError(): Error {
  return Object.assign(new Error("aborted"), { name: "AbortError" });
}

const blob = new Blob(["x".repeat(2048)], { type: "video/webm" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useGamePlayController submissions", () => {
  it("stays quiet when the setter's upload is aborted", async () => {
    svc.uploadVideo.mockRejectedValueOnce(abortError());
    const { result } = renderHook(() => useGamePlayController(game(), me));
    await act(() => result.current.submitSetterTrick(blob));
    expect(result.current.error).toBe("");
    expect(svc.setTrick).not.toHaveBeenCalled();
    expect(svc.captureException).not.toHaveBeenCalled();
    expect(result.current.submitting).toBe(false);
  });

  it("stays quiet when the matcher's upload is aborted", async () => {
    svc.uploadVideo.mockRejectedValueOnce(abortError());
    const { result } = renderHook(() => useGamePlayController(game({ phase: "matching", currentSetter: "u2" }), me));
    act(() => result.current.handleRecorded(blob));
    await act(() => result.current.submitMatchWithCall(true));
    expect(result.current.error).toBe("");
    expect(svc.submitMatchAttempt).not.toHaveBeenCalled();
    expect(svc.captureException).not.toHaveBeenCalled();
  });

  it("buzzes a miss for a missed match with no video", async () => {
    svc.submitMatchAttempt.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useGamePlayController(game({ phase: "matching", currentSetter: "u2" }), me));
    await act(() => result.current.submitMatchWithCall(false));
    expect(svc.playHaptic).toHaveBeenCalledWith("trick_missed");
    expect(svc.submitMatchAttempt).toHaveBeenCalledWith("g1", null, false);
    expect(result.current.matcherLanded).toBe(false);
  });

  it("sends a missed set only once while it is in flight", async () => {
    let finish!: () => void;
    svc.failSetTrick.mockReturnValueOnce(new Promise<void>((r) => (finish = r)));
    const { result } = renderHook(() => useGamePlayController(game(), me));
    let first!: Promise<void>;
    act(() => {
      first = result.current.submitSetterMissed();
    });
    await act(() => result.current.submitSetterMissed());
    expect(svc.failSetTrick).toHaveBeenCalledTimes(1);
    finish();
    await act(() => first);
    expect(result.current.submitting).toBe(false);
  });

  it("uses a generic message when a missed set fails with a non-Error", async () => {
    svc.failSetTrick.mockRejectedValueOnce("nope");
    const { result } = renderHook(() => useGamePlayController(game(), me));
    await act(() => result.current.submitSetterMissed());
    expect(result.current.error).toBe("Failed to submit result");
  });

  it("opens, closes and marks the report", () => {
    const { result } = renderHook(() => useGamePlayController(game(), me));
    act(() => result.current.openReport());
    expect(result.current.showReport).toBe(true);
    act(() => result.current.closeReport());
    expect(result.current.showReport).toBe(false);
    act(() => result.current.openReport());
    act(() => result.current.markReported());
    expect(result.current).toMatchObject({ showReport: false, reported: true });
  });
});

describe("GamePlayScreen report and history", () => {
  it("shows earlier rounds under the active turn", () => {
    const turnHistory = [
      {
        turnNumber: 1,
        trickName: "Kickflip",
        setterUid: "u2",
        setterUsername: "rival",
        matcherUid: "u1",
        matcherUsername: "sk8r",
        setVideoUrl: null,
        matchVideoUrl: null,
        landed: true,
        letterTo: null,
      },
    ];
    render(<GamePlayScreen game={game({ turnHistory })} profile={me} onBack={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Game Clips/ })).toBeInTheDocument();
  });

  it("files a report against the opponent and then locks the button", async () => {
    const user = userEvent.setup();
    svc.submitReport.mockResolvedValueOnce("r-1");
    render(<GamePlayScreen game={game()} profile={me} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Report opponent" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Report opponent" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Report @rival");
    await user.selectOptions(screen.getByLabelText("Reason"), "cheating");
    await user.click(screen.getByRole("button", { name: "Submit Report" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));

    expect(svc.submitReport).toHaveBeenCalledWith(
      expect.objectContaining({ reporterUid: "u1", reportedUid: "u2", gameId: "g1", reason: "cheating" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Reported" })).toBeDisabled();
  });
});
