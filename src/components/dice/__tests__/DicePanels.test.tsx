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

  it("names each hand by who threw it, newest first, and expands past four", async () => {
    const hand = (by: string, label: string, o: Partial<DiceRoundView> = {}) =>
      round({ winner: o.points === 0 ? null : by, label, hands: { [by]: { dice: [1, 5], label } }, ...o });
    const rounds = [
      hand("u1", "Banked 1050", { points: 1050 }),
      hand("u2", "Farkle · lost 200", { points: 0 }),
      hand("u1", "Seven out", { round: 2, points: 0 }),
      hand("u2", "Made the 6", { round: 2, points: 2 }),
      hand("u3", "Natural 7", { round: 3, points: 1 }),
      round({ round: 3, winner: null, points: 0, hands: {} }),
    ];
    render(<RoundLog rounds={rounds} uid="u1" names={{ u1: "kit", u2: "fox" }} unit="Hand" />);
    expect(screen.getByText("Hands · 6")).toBeInTheDocument();
    const rows = () => screen.getAllByTestId("dice-round-row").map((row) => row.textContent);
    expect(rows()).toEqual([
      "No scoreHand 30",
      "@themHand 3+1@them:Natural 7",
      "@foxHand 2+2@fox:Made the 6",
      "YouHand 20You:Seven out",
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Show all 6" }));
    expect(rows().slice(4)).toEqual(["@foxHand 10@fox:Farkle, lost 200", "YouHand 1+1,050You:Banked 1,050"]);
    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(rows()).toHaveLength(4);
  });

  it("titles C-Lo rounds with both hands and the winner", () => {
    render(
      <RoundLog
        rounds={[
          round(),
          round({ round: 2, winner: "u2", points: 1 }),
          round({ round: 3, winner: null, points: 0, label: "Tie" }),
          round({ round: 4, winner: null, points: 0, label: "Void" }),
        ]}
        uid="u1"
        names={{ u2: "fox" }}
        unit="Round"
      />,
    );
    expect(screen.getByText("Rounds · 4")).toBeInTheDocument();
    const rows = screen.getAllByTestId("dice-round-row").map((row) => row.textContent);
    expect(rows).toEqual([
      "No winnerRound 40YouTrips 3s@foxPoint 5",
      "Tie, replayedRound 30YouTrips 3s@foxPoint 5",
      "@fox took itRound 2+1YouTrips 3s@foxPoint 5",
      "You took itRound 1+2YouTrips 3s@foxPoint 5",
    ]);
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
