import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaitingScreen } from "../WaitingScreen";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";

vi.mock("../../utils/helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/helpers")>();
  return {
    ...actual,
    isFirebaseStorageUrl: (url: string) => url?.startsWith("https://firebasestorage.googleapis.com"),
    LETTERS: ["S", "K", "A", "T", "E"],
  };
});

const mockSendNudge = vi.fn();
const mockCanNudge = vi.fn();

vi.mock("../../services/nudge", () => ({
  sendNudge: (...args: unknown[]) => mockSendNudge(...args),
  canNudge: (...args: unknown[]) => mockCanNudge(...args),
}));

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("../../services/reports", () => ({
  submitReport: vi.fn().mockResolvedValue("r1"),
  REPORT_REASON_LABELS: {
    inappropriate_video: "Inappropriate video content",
    abusive_behavior: "Abusive or threatening behavior",
    cheating: "Cheating or exploiting",
    spam: "Spam or bot activity",
    other: "Other",
  },
}));

const profile: UserProfile = {
  uid: "u1",
  username: "alice",
  stance: "regular",
  createdAt: null,
  emailVerified: true,
};

const makeGame = (overrides?: Partial<GameDoc>): GameDoc => ({
  id: "g1",
  player1Uid: "u1",
  player2Uid: "u2",
  player1Username: "alice",
  player2Username: "bob",
  p1Letters: 1,
  p2Letters: 2,
  status: "active",
  currentTurn: "u2",
  phase: "matching",
  currentSetter: "u1",
  currentTrickName: "Kickflip",
  currentTrickVideoUrl: "https://firebasestorage.googleapis.com/trick.webm",
  matchVideoUrl: null,
  turnDeadline: { toMillis: () => Date.now() + 86400000 } as GameDoc["turnDeadline"],
  turnNumber: 1,
  winner: null,
  createdAt: null,
  updatedAt: null,
  ...overrides,
});

describe("WaitingScreen", () => {
  const onBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCanNudge.mockReturnValue(true);
    mockSendNudge.mockResolvedValue(undefined);
  });

  it("renders opponent name and waiting message", () => {
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    expect(screen.getByText("Waiting on @bob")).toBeInTheDocument();
    expect(screen.getByText("They're attempting to match your trick.")).toBeInTheDocument();
  });

  it("shows setting phase message when phase is setting", () => {
    render(<WaitingScreen game={makeGame({ phase: "setting" })} profile={profile} onBack={onBack} />);
    expect(screen.getByText("They're setting a trick for you to match.")).toBeInTheDocument();
  });

  it("shows trick video in matching phase", () => {
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    expect(screen.getByText("Your Trick: Kickflip")).toBeInTheDocument();
    expect(screen.getByLabelText("Video of Kickflip you set")).toBeInTheDocument();
  });

  it("shows 'No video recorded' when no trick video URL", () => {
    render(<WaitingScreen game={makeGame({ currentTrickVideoUrl: null })} profile={profile} onBack={onBack} />);
    expect(screen.getByText("No video recorded")).toBeInTheDocument();
  });

  it("calls onBack when back button is clicked", async () => {
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    await userEvent.click(screen.getByText("← Back to Games"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("sends nudge on button click", async () => {
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    await userEvent.click(screen.getByText("Nudge"));

    await waitFor(() => {
      expect(screen.getByText("Nudge Sent")).toBeInTheDocument();
    });
    expect(mockSendNudge).toHaveBeenCalledWith({
      gameId: "g1",
      senderUid: "u1",
      senderUsername: "alice",
      recipientUid: "u2",
    });
  });

  it("shows error when nudge fails", async () => {
    mockSendNudge.mockRejectedValue(new Error("Rate limited"));

    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    await userEvent.click(screen.getByText("Nudge"));

    await waitFor(() => {
      expect(screen.getByText("Rate limited")).toBeInTheDocument();
    });
  });

  it("disables nudge when cooldown is active", () => {
    mockCanNudge.mockReturnValue(false);
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    expect(screen.getByText("Nudge Sent")).toBeDisabled();
  });

  it("renders letter displays for both players", () => {
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("@bob")).toBeInTheDocument();
  });

  it("shows Report opponent button and opens modal", async () => {
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    expect(screen.getByText("Report opponent")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Report opponent"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows non-firebase video URL fallback message", () => {
    render(
      <WaitingScreen
        game={makeGame({ currentTrickVideoUrl: "https://example.com/clip.webm" })}
        profile={profile}
        onBack={onBack}
      />,
    );
    expect(screen.getByText("No video recorded")).toBeInTheDocument();
  });

  it("shows cooldown message when nudge unavailable and not sent", () => {
    mockCanNudge.mockReturnValue(false);
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    // When nudge not available due to cooldown (not sent state), just check disabled button
    expect(screen.getByText("Nudge Sent")).toBeDisabled();
    expect(screen.getByText("They'll get a push notification")).toBeInTheDocument();
  });

  it("shows last turn clip in setting phase when available", () => {
    const turnHistory = [
      {
        turnNumber: 1,
        trickName: "Heelflip",
        setterUid: "u1",
        setterUsername: "alice",
        matcherUid: "u2",
        matcherUsername: "bob",
        setVideoUrl: "https://firebasestorage.googleapis.com/set1.webm",
        matchVideoUrl: "https://firebasestorage.googleapis.com/match1.webm",
        landed: true,
        letterTo: null,
      },
    ];
    render(
      <WaitingScreen
        game={makeGame({ phase: "setting", turnHistory, currentTrickVideoUrl: null })}
        profile={profile}
        onBack={onBack}
      />,
    );
    expect(screen.getByText("Your Heelflip")).toBeInTheDocument();
    expect(screen.getByLabelText("Your Heelflip")).toBeInTheDocument();
  });

  it("shows save/share buttons for matching phase trick video", () => {
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    expect(screen.getByText("Save Clip")).toBeInTheDocument();
    expect(screen.getByText("Share Clip")).toBeInTheDocument();
  });

  it("shows turn history when turns exist", () => {
    const turnHistory = [
      {
        turnNumber: 1,
        trickName: "Kickflip",
        setterUid: "u1",
        setterUsername: "alice",
        matcherUid: "u2",
        matcherUsername: "bob",
        setVideoUrl: "https://firebasestorage.googleapis.com/set1.webm",
        matchVideoUrl: "https://firebasestorage.googleapis.com/match1.webm",
        landed: true,
        letterTo: null,
      },
    ];
    render(<WaitingScreen game={makeGame({ turnHistory })} profile={profile} onBack={onBack} />);
    expect(screen.getByText("Game Clips (1 round)")).toBeInTheDocument();
  });

  // ── Judge viewer coverage ───────────────────────────────────────────────
  //
  // A nominated judge lands on WaitingScreen between review phases (e.g.
  // while the players are in setting/matching). The old player-centric
  // derivations silently fell back to player2's letters / player1 as
  // "opponent", which meant the judge saw the wrong scores, a wrong
  // "Waiting on @x" label, and a Nudge / Report opponent flow that would
  // have acted on a player they have no relationship with. These tests
  // lock in the neutral-observer rendering.

  describe("judge viewer", () => {
    const judgeProfile: UserProfile = {
      uid: "judge-uid",
      username: "ref",
      stance: "regular",
      createdAt: null,
      emailVerified: true,
    };
    const judgeGame = (overrides?: Partial<GameDoc>): GameDoc =>
      makeGame({
        judgeId: "judge-uid",
        judgeUsername: "ref",
        judgeStatus: "accepted",
        ...overrides,
      });

    it("shows both players' letters (not the judge's player2 fallback)", () => {
      render(
        <WaitingScreen
          game={judgeGame({ p1Letters: 3, p2Letters: 1, phase: "matching", currentTurn: "u2", currentSetter: "u1" })}
          profile={judgeProfile}
          onBack={onBack}
        />,
      );
      // Judge sees both players side by side, by name, with their own letter counts.
      expect(screen.getByText("@alice")).toBeInTheDocument();
      expect(screen.getByText("@bob")).toBeInTheDocument();
    });

    it("names the currently-acting player in the waiting label, not the judge", () => {
      // Matching phase, currentTurn → u2 (bob is matching).
      render(
        <WaitingScreen
          game={judgeGame({ phase: "matching", currentTurn: "u2", currentSetter: "u1" })}
          profile={judgeProfile}
          onBack={onBack}
        />,
      );
      expect(screen.getByText("Waiting on @bob")).toBeInTheDocument();
      expect(screen.getByText("@bob is attempting the match.")).toBeInTheDocument();
    });

    it("names the setter in the waiting label when phase is setting", () => {
      render(
        <WaitingScreen
          game={judgeGame({ phase: "setting", currentTurn: "u1", currentSetter: "u1" })}
          profile={judgeProfile}
          onBack={onBack}
        />,
      );
      expect(screen.getByText("Waiting on @alice")).toBeInTheDocument();
      expect(screen.getByText("@alice is setting a trick.")).toBeInTheDocument();
    });

    it("hides the Nudge button and Report opponent link (judges have no opponent)", () => {
      render(<WaitingScreen game={judgeGame()} profile={judgeProfile} onBack={onBack} />);
      expect(screen.queryByText("Nudge")).not.toBeInTheDocument();
      expect(screen.queryByText("Report opponent")).not.toBeInTheDocument();
    });

    it("shows active referee badge when judge is accepted", () => {
      render(
        <WaitingScreen
          game={judgeGame({ phase: "matching", currentTurn: "u2", currentSetter: "u1" })}
          profile={judgeProfile}
          onBack={onBack}
        />,
      );
      expect(screen.getByTestId("judge-active-badge")).toBeInTheDocument();
      expect(screen.getByText("@ref rules disputes")).toBeInTheDocument();
    });
  });

  it("shows active referee badge for players when judge is accepted", () => {
    render(
      <WaitingScreen
        game={makeGame({
          judgeId: "judge-uid",
          judgeUsername: "ref",
          judgeStatus: "accepted",
          phase: "matching",
          currentTurn: "u2",
          currentSetter: "u1",
        })}
        profile={profile}
        onBack={onBack}
      />,
    );
    expect(screen.getByTestId("judge-active-badge")).toBeInTheDocument();
  });

  it("references referee in disputable banner when judge is active", () => {
    render(
      <WaitingScreen
        game={makeGame({
          phase: "disputable",
          currentTurn: "judge-uid",
          currentSetter: "u2",
          judgeId: "judge-uid",
          judgeUsername: "ref",
          judgeStatus: "accepted",
          matchVideoUrl: "https://firebasestorage.googleapis.com/match.webm",
        })}
        profile={profile}
        onBack={onBack}
      />,
    );
    expect(screen.getByText(/referee @ref is ruling/)).toBeInTheDocument();
  });

  it("references opponent in disputable banner when no judge", () => {
    render(
      <WaitingScreen
        game={makeGame({
          phase: "disputable",
          currentTurn: "u2",
          currentSetter: "u2",
          matchVideoUrl: "https://firebasestorage.googleapis.com/match.webm",
        })}
        profile={profile}
        onBack={onBack}
      />,
    );
    expect(screen.getByText(/waiting for @bob's decision/)).toBeInTheDocument();
  });

  it("handles non-Error throw from sendNudge", async () => {
    mockSendNudge.mockRejectedValue("string error");
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    await userEvent.click(screen.getByText("Nudge"));

    await waitFor(() => {
      expect(screen.getByText("Failed to nudge")).toBeInTheDocument();
    });
  });

  // ── ClipShareButtons coverage (Save/Share handlers) ─────────────────────

  describe("ClipShareButtons", () => {
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;

    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => "blob:test");
      URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
      vi.unstubAllGlobals();
      // Reset navigator.share / clipboard between cases
      Object.defineProperty(navigator, "share", { value: undefined, writable: true, configurable: true });
      Object.defineProperty(navigator, "canShare", { value: undefined, writable: true, configurable: true });
    });

    it("Save Clip downloads the clip and toggles label to 'Saved!'", async () => {
      const blob = new Blob(["video"], { type: "video/webm" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(blob) }));
      // Stub anchor click to avoid jsdom navigation noise
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

      render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
      await userEvent.click(screen.getByText("Save Clip"));

      await waitFor(() => expect(screen.getByText("Saved!")).toBeInTheDocument());
      expect(clickSpy).toHaveBeenCalled();
      expect(URL.createObjectURL).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it("Save Clip shows 'Save failed' when fetch fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, blob: vi.fn() }));
      render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
      await userEvent.click(screen.getByText("Save Clip"));
      await waitFor(() => expect(screen.getByText("Save failed")).toBeInTheDocument());
    });

    it("Share Clip uses native file share when canShare returns true", async () => {
      const blob = new Blob(["video"], { type: "video/webm" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(blob) }));
      const shareFn = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "share", { value: shareFn, writable: true, configurable: true });
      Object.defineProperty(navigator, "canShare", {
        value: vi.fn().mockReturnValue(true),
        writable: true,
        configurable: true,
      });

      render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
      await userEvent.click(screen.getByText("Share Clip"));

      await waitFor(() => expect(screen.getByText("Shared!")).toBeInTheDocument());
      expect(shareFn).toHaveBeenCalledWith(expect.objectContaining({ files: expect.any(Array) }));
    });

    it("Share Clip falls back to text share when canShare is false", async () => {
      const blob = new Blob(["video"], { type: "video/webm" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(blob) }));
      const shareFn = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "share", { value: shareFn, writable: true, configurable: true });
      Object.defineProperty(navigator, "canShare", {
        value: vi.fn().mockReturnValue(false),
        writable: true,
        configurable: true,
      });

      render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
      await userEvent.click(screen.getByText("Share Clip"));

      await waitFor(() => expect(screen.getByText("Shared!")).toBeInTheDocument());
      expect(shareFn).toHaveBeenCalledWith(expect.objectContaining({ text: expect.any(String) }));
      expect(shareFn).not.toHaveBeenCalledWith(expect.objectContaining({ files: expect.anything() }));
    });

    it("Share Clip falls back to clipboard when navigator.share is unavailable", async () => {
      const blob = new Blob(["video"], { type: "video/webm" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(blob) }));
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
      await userEvent.click(screen.getByText("Share Clip"));

      await waitFor(() => expect(screen.getByText("Shared!")).toBeInTheDocument());
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Kickflip"));
    });

    it("Share Clip shows 'Share failed' when fetch fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, blob: vi.fn() }));
      render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
      await userEvent.click(screen.getByText("Share Clip"));
      await waitFor(() => expect(screen.getByText("Share failed")).toBeInTheDocument());
    });
  });

  // ── Misc uncovered branches ─────────────────────────────────────────────

  it("re-enables nudge when cooldown clears via interval tick", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Start in 'sent' state because canNudge is initially false
      mockCanNudge.mockReturnValue(false);
      render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
      expect(screen.getByText("Nudge Sent")).toBeDisabled();

      // Cooldown clears — advancing the interval should flip back to 'idle'
      mockCanNudge.mockReturnValue(true);
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });

      await waitFor(() => expect(screen.getByText("Nudge")).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables Report opponent button after submission", async () => {
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    await userEvent.click(screen.getByText("Report opponent"));

    // ReportModal uses a <select>; choose a reason then submit
    const select = await screen.findByLabelText(/REASON/i);
    await userEvent.selectOptions(select, "inappropriate_video");

    const submit = await screen.findByRole("button", { name: /Submit Report/i });
    await userEvent.click(submit);

    await waitFor(() => expect(screen.getByText("Reported")).toBeInTheDocument());
    expect(screen.getByText("Reported")).toBeDisabled();
  });
});
