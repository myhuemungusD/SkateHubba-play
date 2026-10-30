import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GameDoc } from "../../../../services/games";
import { JudgeStatusBadge } from "../JudgeStatusBadge";
import { JudgeInviteCard } from "../JudgeInviteCard";
import { MatcherInstructionBanner } from "../MatcherInstructionBanner";
import { SetterTrickInput } from "../SetterTrickInput";
import { MatcherDecisionPanel } from "../MatcherDecisionPanel";
import { PendingReviewPanel } from "../PendingReviewPanel";
import { DisputeReviewPanel } from "../DisputeReviewPanel";
import { SetTrickReviewPanel } from "../SetTrickReviewPanel";

const STORAGE = "https://firebasestorage.googleapis.com/v0/b/x/o/clip.webm";

function game(overrides: Partial<GameDoc> = {}): GameDoc {
  return {
    status: "active",
    player1Username: "alice",
    player2Username: "bob",
    currentTrickName: null,
    trickCategory: "flip",
    customRules: null,
    ...overrides,
  } as unknown as GameDoc;
}

describe("JudgeStatusBadge", () => {
  it("shows the honor-system badge when the referee declined", () => {
    render(<JudgeStatusBadge game={game({ judgeUsername: "ref", judgeStatus: "declined" })} viewerIsJudge={false} />);
    expect(screen.getByTestId("judge-declined-badge")).toHaveTextContent("NO REFEREEHonor system");
  });

  it("renders nothing for a referee with no recorded status", () => {
    const { container } = render(
      <JudgeStatusBadge game={game({ judgeUsername: "ref", judgeStatus: null })} viewerIsJudge={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("game-rules headline", () => {
  it("is dropped from the referee invite for an anything-goes game", () => {
    render(
      <JudgeInviteCard
        game={game({ trickCategory: "any" })}
        submitting={false}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Game rules:/)).not.toBeInTheDocument();
  });

  it("is shown on the referee invite for a preset category", () => {
    render(<JudgeInviteCard game={game()} submitting={false} onAccept={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByText("Game rules: Flip Tricks")).toBeInTheDocument();
  });

  it("is dropped from the matcher banner for an anything-goes game, and shows for a preset", () => {
    const props = { setterUsername: "alice", setterIsPro: false, currentTrickName: "kickflip", customRules: null };
    const { container, rerender } = render(<MatcherInstructionBanner {...props} trickCategory="any" />);
    expect(container.querySelector("p")).toBeNull();
    rerender(<MatcherInstructionBanner {...props} trickCategory="flip" />);
    expect(screen.getByText("Flip Tricks")).toBeInTheDocument();
  });
});

describe("SetterTrickInput constraint text", () => {
  const base = {
    trickName: "",
    setTrickName: vi.fn(),
    videoRecorded: false,
    showRecorder: false,
    trimmedTrickName: "",
  };

  it('adds "only" to a preset category', () => {
    render(<SetterTrickInput {...base} trickCategory="flip" customRules={null} />);
    expect(screen.getByText("Flip Tricks only")).toBeInTheDocument();
  });

  it("shows custom rules verbatim", () => {
    render(<SetterTrickInput {...base} trickCategory="custom" customRules="No pushing" />);
    expect(screen.getByText("No pushing")).toBeInTheDocument();
    expect(screen.queryByText(/only$/)).not.toBeInTheDocument();
  });

  it("shows no constraint for an anything-goes game", () => {
    render(<SetterTrickInput {...base} trickCategory="any" customRules={null} />);
    expect(screen.queryByText(/only$/)).not.toBeInTheDocument();
    expect(screen.getByText("Name your trick to start recording")).toBeInTheDocument();
  });
});

describe("MatcherDecisionPanel", () => {
  const base = { videoRecorded: true, submitting: false, error: "", uploadProgress: null, matcherLanded: null };

  it("submits a miss", async () => {
    const submit = vi.fn();
    render(<MatcherDecisionPanel {...base} submitMatchWithCall={submit} />);
    await userEvent.click(screen.getByRole("button", { name: /Missed/ }));
    expect(submit).toHaveBeenCalledWith(false);
  });

  it("swaps the buttons for upload progress", () => {
    render(
      <MatcherDecisionPanel
        {...base}
        uploadProgress={{ bytesTransferred: 5, totalBytes: 10, percent: 50 }}
        submitMatchWithCall={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Landed/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Did you land it?")).not.toBeInTheDocument();
  });

  it("retries the last call after an error", async () => {
    const submit = vi.fn();
    render(<MatcherDecisionPanel {...base} error="boom" matcherLanded={true} submitMatchWithCall={submit} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(submit).toHaveBeenCalledWith(true);
  });
});

describe("PendingReviewPanel", () => {
  const base = {
    matcherUsername: "bob",
    canDispute: true,
    deadline: Date.now() + 3_600_000,
    submitting: false,
    lastReviewAction: null,
    error: "",
    onAccept: vi.fn(),
    onDispute: vi.fn(),
  };

  it("falls back to 'trick' and says no video was recorded for a non-storage URL", () => {
    render(<PendingReviewPanel {...base} game={game({ matchVideoUrl: "https://evil.example.com/x.webm" })} />);
    expect(screen.getByText(/says they matched your trick\./)).toBeInTheDocument();
    expect(screen.getByText("No match video was recorded.")).toBeInTheDocument();
  });

  it("names the trick and plays a storage attempt", () => {
    render(<PendingReviewPanel {...base} game={game({ currentTrickName: "heelflip", matchVideoUrl: STORAGE })} />);
    expect(screen.getByText(/says they matched your heelflip\./)).toBeInTheDocument();
    expect(screen.getByLabelText("bob's match attempt video")).toHaveAttribute("src", STORAGE);
  });

  it("retries a failed dispute as a dispute", async () => {
    const onDispute = vi.fn();
    const onAccept = vi.fn();
    render(
      <PendingReviewPanel
        {...base}
        game={game()}
        error="nope"
        lastReviewAction="dispute"
        onAccept={onAccept}
        onDispute={onDispute}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onDispute).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });
});

describe.each([
  [
    "DisputeReviewPanel",
    (g: GameDoc) => (
      <DisputeReviewPanel
        game={g}
        setterUsername="alice"
        matcherUsername="bob"
        disputeSubmitting={false}
        lastDisputeAction={null}
        error=""
        onResolve={vi.fn()}
      />
    ),
  ],
  [
    "SetTrickReviewPanel",
    (g: GameDoc) => (
      <SetTrickReviewPanel
        game={g}
        setterUsername="alice"
        matcherUsername="bob"
        setReviewSubmitting={false}
        lastSetReviewAction={null}
        error=""
        onRule={vi.fn()}
      />
    ),
  ],
])("%s copy", (_name, renderPanel) => {
  it("falls back to 'trick' with no rules line for an unnamed anything-goes set", () => {
    render(renderPanel(game({ trickCategory: "any", currentTrickVideoUrl: STORAGE })));
    expect(screen.getByText(/alice's trick\./)).toBeInTheDocument();
    expect(screen.getByLabelText("alice's trick video")).toBeInTheDocument();
    expect(screen.queryByText(/Game rules:/)).not.toBeInTheDocument();
  });

  it("names the trick and the rules", () => {
    render(renderPanel(game({ currentTrickName: "tre flip", currentTrickVideoUrl: STORAGE })));
    expect(screen.getByLabelText("alice's tre flip video")).toBeInTheDocument();
    expect(screen.getByText("Game rules: Flip Tricks")).toBeInTheDocument();
  });
});
