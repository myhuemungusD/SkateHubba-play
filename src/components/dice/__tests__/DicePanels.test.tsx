import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmSheet } from "../ConfirmSheet";
import { MatchResult } from "../MatchResult";
import { MatchRow } from "../MatchRow";
import { RoundLog } from "../RoundLog";
import { Scoreboard, type ScoreSide } from "../Scoreboard";
import type { DiceRoundView } from "../../../services/dice";

const side = (o: Partial<ScoreSide> = {}): ScoreSide => ({
  uid: "u1",
  name: "kit",
  isYou: true,
  score: 2,
  toMove: true,
  hand: null,
  note: null,
  ...o,
});

describe("Scoreboard", () => {
  it("shows both skaters, the mover, hands, notes and progress", () => {
    render(
      <Scoreboard
        you={side({ hand: { dice: [3, 3, 3], label: "Trips 3s" } })}
        them={side({ uid: "u2", name: "fox", isYou: false, toMove: false, score: 7, note: "Shooting for 6" })}
        target={5}
      />,
    );
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("@fox")).toBeInTheDocument();
    expect(screen.getByText("To roll")).toBeInTheDocument();
    expect(screen.getByText("Set: Trips 3s")).toBeInTheDocument();
    expect(screen.getByText("Shooting for 6")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "@fox's progress to 5" })).toHaveAttribute("aria-valuenow", "5");
    expect(screen.getByRole("progressbar", { name: "Your progress to 5" })).toHaveAttribute("aria-valuenow", "2");
  });

  it("handles an empty name and a zero target", () => {
    render(<Scoreboard you={side({ name: "" })} them={side({ uid: "u2", isYou: false, name: "" })} target={0} />);
    expect(screen.getAllByText("?")).toHaveLength(2);
  });
});

const round = (o: Partial<DiceRoundView> = {}): DiceRoundView => ({
  round: 1,
  winner: "u1",
  points: 2,
  label: "Trips 3s",
  hands: { u1: { dice: [3, 3, 3], label: "Trips 3s" }, u2: { dice: [2, 2, 5], label: "Point 5" } },
  at: 1,
  ...o,
});

describe("RoundLog", () => {
  it("renders nothing before the first round", () => {
    const { container } = render(<RoundLog rounds={[]} uid="u1" names={{}} unit="Round" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists rounds newest first and expands past four", async () => {
    const rounds = [
      round(),
      round({ round: 2, winner: "u2", points: 1 }),
      round({ round: 3, winner: null, points: 0, label: "Tie" }),
      round({ round: 4, winner: null, points: 0, label: "Seven out" }),
      round({ round: 5, winner: "u3" }),
    ];
    render(<RoundLog rounds={rounds} uid="u1" names={{ u1: "kit", u2: "fox" }} unit="Hand" />);
    expect(screen.getByText("Hands · 5")).toBeInTheDocument();
    expect(screen.getByText("Tie, replayed")).toBeInTheDocument();
    expect(screen.getByText("No score · Seven out")).toBeInTheDocument();
    expect(screen.getByText("@them · Trips 3s")).toBeInTheDocument();
    expect(screen.queryByText("You · Trips 3s")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show all 5" }));
    expect(screen.getByText("You · Trips 3s")).toBeInTheDocument();
    expect(screen.getByText("@fox · Trips 3s")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.queryByText("You · Trips 3s")).not.toBeInTheDocument();
  });

  it("titles C-Lo rounds", () => {
    render(
      <RoundLog rounds={[round({ hands: { u9: { dice: [1], label: "x" } } })]} uid="u1" names={{}} unit="Round" />,
    );
    expect(screen.getByText("Rounds · 1")).toBeInTheDocument();
  });
});

describe("MatchResult", () => {
  it("shows a win with score and Rep", () => {
    render(
      <MatchResult
        title="You won"
        reason="You reached the target first."
        score="5 – 3"
        won
        repDelta={16}
        repAfter={1016}
      />,
    );
    expect(screen.getByRole("heading", { name: "You won" })).toBeInTheDocument();
    expect(screen.getByText("5 – 3")).toBeInTheDocument();
    expect(screen.getByText("Rep").nextSibling).toHaveTextContent("+161,016");
  });

  it("shows a loss, and a no-contest with no numbers", () => {
    const { rerender } = render(
      <MatchResult title="You lost" reason="r" score="3 – 5" won={false} repDelta={-16} repAfter={null} />,
    );
    expect(screen.getByText("Rep").nextSibling).toHaveTextContent("−16");
    rerender(
      <MatchResult title="Challenge declined" reason="r" score={null} won={false} repDelta={null} repAfter={null} />,
    );
    expect(screen.queryByText("Final")).not.toBeInTheDocument();
    rerender(<MatchResult title="x" reason="r" score={null} won={false} repDelta={4} repAfter={null} />);
    expect(screen.getByText("Rep")).toBeInTheDocument();
  });
});

describe("MatchRow", () => {
  it.each(["act", "wait", "won", "lost", "void"] as const)("opens a %s row", async (tone) => {
    const onOpen = vi.fn();
    render(
      <MatchRow
        name={tone === "void" ? "" : "fox"}
        meta="C-Lo · Race to 5"
        score={tone === "void" ? null : "1 – 0"}
        status="s"
        tone={tone}
        onOpen={onOpen}
      />,
    );
    await userEvent.click(screen.getByTestId("dice-match-row"));
    expect(onOpen).toHaveBeenCalled();
  });
});

describe("ConfirmSheet", () => {
  it("confirms, cancels, and closes on the backdrop", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmSheet title="Forfeit?" body="b" confirmLabel="Forfeit" onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Forfeit" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    await userEvent.click(screen.getByRole("alertdialog"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
