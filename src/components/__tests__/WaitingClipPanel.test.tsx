import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WaitingClipPanel } from "../waiting/WaitingClipPanel";
import type { GameDoc, TurnRecord } from "../../services/games";
import type { UserProfile } from "../../services/users";

const STORAGE = "https://firebasestorage.googleapis.com/v0/b/test/o";
const me: UserProfile = { uid: "u-me", username: "me", stance: "regular", createdAt: null };

function game(overrides: Partial<GameDoc>): GameDoc {
  return {
    id: "g-panel",
    player1Uid: "u-me",
    player2Uid: "u-them",
    player1Username: "me",
    player2Username: "them",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: "u-them",
    phase: "setting",
    currentSetter: "u-them",
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: null,
    turnNumber: 3,
    winner: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  } as GameDoc;
}

function turn(n: number, setterUid: string, setVideoUrl: string | null, matchVideoUrl: string | null): TurnRecord {
  const matcherUid = setterUid === "u-me" ? "u-them" : "u-me";
  return {
    turnNumber: n,
    trickName: `Trick ${n}`,
    setterUid,
    setterUsername: setterUid,
    matcherUid,
    matcherUsername: matcherUid,
    setVideoUrl,
    matchVideoUrl,
    landed: false,
    letterTo: null,
  } as TurnRecord;
}

describe("WaitingClipPanel", () => {
  it("falls back to a generic trick name on the disputed attempt when none was named", () => {
    render(
      <WaitingClipPanel
        game={game({ phase: "disputable", matchVideoUrl: `${STORAGE}/attempt.webm` })}
        profile={me}
        opponentName="them"
      />,
    );
    expect(screen.getByText("Your Attempt: Trick")).toBeInTheDocument();
    expect(screen.getByLabelText("Your attempt at trick")).toBeInTheDocument();
    expect(screen.getByText("Share Clip")).toBeInTheDocument();
  });

  it("falls back to a generic trick name on the set clip when none was named", () => {
    render(
      <WaitingClipPanel
        game={game({ phase: "matching", currentTrickVideoUrl: `${STORAGE}/set.webm` })}
        profile={me}
        opponentName="them"
      />,
    );
    expect(screen.getByText("Your Trick: Trick")).toBeInTheDocument();
    expect(screen.getByLabelText("Video of trick you set")).toBeInTheDocument();
  });

  it("shows my latest match attempt, skipping newer turns where I left no clip", () => {
    const turnHistory = [
      turn(1, "u-me", `${STORAGE}/old-set.webm`, null),
      turn(2, "u-them", `${STORAGE}/their-set.webm`, `${STORAGE}/my-attempt.webm`),
      turn(3, "u-them", `${STORAGE}/their-set-2.webm`, null),
    ];
    render(<WaitingClipPanel game={game({ turnHistory })} profile={me} opponentName="them" />);
    expect(screen.getByText("Your attempt at Trick 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Your attempt at Trick 2")).toHaveAttribute(
      "src",
      expect.stringContaining(`${STORAGE}/my-attempt.webm`),
    );
  });

  it("renders nothing when my latest clip is not a Storage URL", () => {
    const turnHistory = [turn(1, "u-me", "https://evil.example.com/set.webm", null)];
    const { container } = render(<WaitingClipPanel game={game({ turnHistory })} profile={me} opponentName="them" />);
    expect(container).toBeEmptyDOMElement();
  });
});
