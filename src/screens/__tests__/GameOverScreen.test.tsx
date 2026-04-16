import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameOverScreen } from "../GameOverScreen";

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("../../utils/helpers", () => ({
  isFirebaseStorageUrl: (url: string) => url?.startsWith("https://firebasestorage.googleapis.com"),
  LETTERS: ["S", "K", "A", "T", "E"],
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

  it("shares game recap via clipboard when navigator.share is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const origShare = navigator.share;
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true, writable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });

    const turnHistory = [
      {
        turnNumber: 1,
        trickName: "Kickflip",
        setterUid: "u1",
        setterUsername: "sk8r",
        matcherUid: "u2",
        matcherUsername: "rival",
        setVideoUrl: "",
        matchVideoUrl: "",
        landed: true,
        letterTo: null,
      },
    ];

    render(<GameOverScreen game={makeGame({ turnHistory })} profile={profile} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Share Game Recap"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    expect(screen.getByText("Copied!")).toBeInTheDocument();

    Object.defineProperty(navigator, "share", { value: origShare, configurable: true, writable: true });
  });

  it("renders turn history and game replay when turns exist", () => {
    const turnHistory = [
      {
        turnNumber: 1,
        trickName: "Heelflip",
        setterUid: "u1",
        setterUsername: "sk8r",
        matcherUid: "u2",
        matcherUsername: "rival",
        setVideoUrl: "",
        matchVideoUrl: "",
        landed: false,
        letterTo: "u2",
      },
    ];
    render(<GameOverScreen game={makeGame({ turnHistory })} profile={profile} onBack={vi.fn()} />);
    expect(screen.getByText("Game Clips (1 round)")).toBeInTheDocument();
    expect(screen.getByText("Share Game Recap")).toBeInTheDocument();
  });

  it("shows report opponent button and opens modal", async () => {
    render(<GameOverScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);
    expect(screen.getByText("Report opponent")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Report opponent"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders view player button when onViewPlayer is provided", async () => {
    const onViewPlayer = vi.fn();
    render(<GameOverScreen game={makeGame()} profile={profile} onBack={vi.fn()} onViewPlayer={onViewPlayer} />);
    await userEvent.click(screen.getByRole("button", { name: /View.*rival.*Record/ }));
    expect(onViewPlayer).toHaveBeenCalledWith("u2");
  });

  it("shows invite button", () => {
    render(<GameOverScreen game={makeGame()} profile={profile} onRematch={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText(/Invite/)).toBeInTheDocument();
  });

  // ── Referee badge tests ──

  it("shows REFEREED badge when judge was accepted", () => {
    render(
      <GameOverScreen
        game={makeGame({ judgeId: "u3", judgeUsername: "ref", judgeStatus: "accepted" })}
        profile={profile}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText("REFEREED")).toBeInTheDocument();
    expect(screen.getByText("by @ref")).toBeInTheDocument();
  });

  it("hides REFEREED badge when no judge was nominated", () => {
    render(<GameOverScreen game={makeGame()} profile={profile} onBack={vi.fn()} />);
    expect(screen.queryByText("REFEREED")).not.toBeInTheDocument();
  });

  it("hides REFEREED badge when judge was pending", () => {
    render(
      <GameOverScreen
        game={makeGame({ judgeId: "u3", judgeUsername: "ref", judgeStatus: "pending" })}
        profile={profile}
        onBack={vi.fn()}
      />,
    );
    expect(screen.queryByText("REFEREED")).not.toBeInTheDocument();
  });

  it("hides REFEREED badge when judge declined", () => {
    render(
      <GameOverScreen
        game={makeGame({ judgeId: "u3", judgeUsername: "ref", judgeStatus: "declined" })}
        profile={profile}
        onBack={vi.fn()}
      />,
    );
    expect(screen.queryByText("REFEREED")).not.toBeInTheDocument();
  });
});
