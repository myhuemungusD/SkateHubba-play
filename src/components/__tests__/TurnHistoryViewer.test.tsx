import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TurnHistoryViewer } from "../TurnHistoryViewer";
import type { TurnRecord } from "../../services/games";

vi.mock("../../utils/helpers", () => ({
  isFirebaseStorageUrl: (url: string) => url.startsWith("https://firebasestorage.googleapis.com"),
}));

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
}));

const makeTurn = (n: number, overrides?: Partial<TurnRecord>): TurnRecord => ({
  turnNumber: n,
  trickName: `Kickflip ${n}`,
  setterUid: "u1",
  setterUsername: "alice",
  matcherUid: "u2",
  matcherUsername: "bob",
  setVideoUrl: `https://firebasestorage.googleapis.com/set${n}.webm`,
  matchVideoUrl: `https://firebasestorage.googleapis.com/match${n}.webm`,
  landed: true,
  letterTo: null,
  ...overrides,
});

describe("TurnHistoryViewer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when turns is empty", () => {
    const { container } = render(<TurnHistoryViewer turns={[]} currentUserUid="u1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders collapsed by default with correct count", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1), makeTurn(2)]} currentUserUid="u1" />);
    expect(screen.getByText("Game Clips (2 rounds)")).toBeInTheDocument();
    // Turns should not be visible
    expect(screen.queryByText("Kickflip 1")).not.toBeInTheDocument();
  });

  it("uses singular 'round' for 1 turn", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" />);
    expect(screen.getByText("Game Clips (1 round)")).toBeInTheDocument();
  });

  it("expands on button click to show turns", async () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" />);

    await userEvent.click(screen.getByText("Game Clips (1 round)"));
    expect(screen.getByText("Round 1: Kickflip 1")).toBeInTheDocument();
    expect(screen.getByText("Landed")).toBeInTheDocument();
    expect(screen.getByText(/@alice's trick/)).toBeInTheDocument();
    expect(screen.getByText(/@bob's attempt/)).toBeInTheDocument();
  });

  it("renders expanded by default when defaultExpanded is true", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded />);
    expect(screen.getByText("Round 1: Kickflip 1")).toBeInTheDocument();
  });

  it("shows Missed badge and letter info", () => {
    render(
      <TurnHistoryViewer
        turns={[makeTurn(1, { landed: false, letterTo: "u2" })]}
        currentUserUid="u1"
        defaultExpanded
      />,
    );
    expect(screen.getByText("Missed")).toBeInTheDocument();
    expect(screen.getByText(/@bob gets a letter/)).toBeInTheDocument();
  });

  it("shows (you) when letter is to current user", () => {
    render(
      <TurnHistoryViewer
        turns={[makeTurn(1, { landed: false, letterTo: "u1", matcherUid: "u1", matcherUsername: "me" })]}
        currentUserUid="u1"
        defaultExpanded
      />,
    );
    expect(screen.getByText(/(you)/)).toBeInTheDocument();
  });

  it("collapses on second toggle click", async () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" />);

    const toggle = screen.getByRole("button", { name: /Game Clips/ });
    await userEvent.click(toggle);
    expect(screen.getByText("Round 1: Kickflip 1")).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.queryByText("Round 1: Kickflip 1")).not.toBeInTheDocument();
  });

  it("has aria-expanded attribute on toggle button", async () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" />);

    const toggle = screen.getByRole("button", { name: /Game Clips/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
