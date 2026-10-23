import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LetterScoreboard } from "../LetterScoreboard";
import type { GameDoc } from "../../../../services/games";
import type { UserProfile } from "../../../../services/users";

const game = {
  player1Uid: "p1",
  player2Uid: "p2",
  player1Username: "alpha",
  player2Username: "bravo",
  p1Letters: 1,
  p2Letters: 2,
  phase: "setting",
  currentSetter: "p1",
  currentTurn: "p1",
} as unknown as GameDoc;
const profile = { uid: "p1", username: "alpha" } as UserProfile;

const base = {
  game,
  profile,
  myLetters: 1,
  theirLetters: 2,
  opponentName: "bravo",
  opponentIsPro: false,
};

function activeOf(testId: string) {
  return screen.getByTestId(testId).getAttribute("data-active");
}

describe("LetterScoreboard", () => {
  it("lights my card with YOUR MOVE when I act", () => {
    render(<LetterScoreboard {...base} viewerIsJudge={false} acting="me" />);
    expect(activeOf("letter-display-alpha")).toBe("true");
    expect(activeOf("letter-display-bravo")).toBe("false");
    expect(screen.getByText("YOUR MOVE")).toBeInTheDocument();
  });

  it("lights the opponent's card with THEIR MOVE when they act", () => {
    render(<LetterScoreboard {...base} viewerIsJudge={false} acting="them" />);
    expect(activeOf("letter-display-bravo")).toBe("true");
    expect(screen.getByText("THEIR MOVE")).toBeInTheDocument();
  });

  it("lights neither card while the call is with a referee", () => {
    render(<LetterScoreboard {...base} viewerIsJudge={false} acting={null} />);
    expect(activeOf("letter-display-alpha")).toBe("false");
    expect(activeOf("letter-display-bravo")).toBe("false");
  });

  it.each([
    ["setting", { currentSetter: "p2", currentTurn: "p1" }, "@bravo"],
    ["matching", { currentSetter: "p2", currentTurn: "p1" }, "@alpha"],
  ])("shows the judge who is on the clock while %s", (phase, extra, lit) => {
    render(<LetterScoreboard {...base} game={{ ...game, phase, ...extra } as GameDoc} viewerIsJudge acting={null} />);
    expect(activeOf(`letter-display-${lit}`)).toBe("true");
    expect(screen.getByText("ON THE CLOCK")).toBeInTheDocument();
  });

  it("lights no judge card outside setting and matching", () => {
    render(
      <LetterScoreboard {...base} game={{ ...game, phase: "disputable" } as GameDoc} viewerIsJudge acting={null} />,
    );
    expect(screen.queryByText("ON THE CLOCK")).not.toBeInTheDocument();
  });
});
