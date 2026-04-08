import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameReplay } from "../GameReplay";
import type { TurnRecord } from "../../services/games";

vi.mock("../../utils/helpers", () => ({
  isFirebaseStorageUrl: (url: string) => url.startsWith("https://firebasestorage.googleapis.com"),
  parseFirebaseError: (err: unknown) => String(err),
}));

const makeTurn = (n: number, overrides?: Partial<TurnRecord>): TurnRecord => ({
  turnNumber: n,
  trickName: `Trick ${n}`,
  setterUid: "u1",
  setterUsername: "alice",
  matcherUid: "u2",
  matcherUsername: "bob",
  setVideoUrl: `https://firebasestorage.googleapis.com/set${n}.webm`,
  matchVideoUrl: `https://firebasestorage.googleapis.com/match${n}.webm`,
  landed: n % 2 === 0,
  letterTo: n % 2 === 0 ? null : "u2",
  ...overrides,
});

describe("GameReplay", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when turns have no playable clips", () => {
    const turns: TurnRecord[] = [makeTurn(1, { setVideoUrl: null, matchVideoUrl: null })];
    const { container } = render(<GameReplay turns={turns} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders Watch Full Replay button when clips exist", () => {
    render(<GameReplay turns={[makeTurn(1)]} />);
    expect(screen.getByText(/Watch Full Replay/)).toBeInTheDocument();
  });

  it("starts replay on button click", async () => {
    render(<GameReplay turns={[makeTurn(1)]} />);
    await userEvent.click(screen.getByText(/Watch Full Replay/));

    // Should show the clip label
    expect(screen.getByText(/Round 1/)).toBeInTheDocument();
    expect(screen.getByText(/Trick 1/)).toBeInTheDocument();
  });

  it("advances to next clip on video ended", async () => {
    render(<GameReplay turns={[makeTurn(1)]} />);
    await userEvent.click(screen.getByText(/Watch Full Replay/));

    // First clip is set clip - should show setter info
    expect(screen.getByText(/@alice's trick/)).toBeInTheDocument();

    // Simulate video ended
    const video = screen.getByLabelText(/Round 1: @alice sets Trick 1/);
    fireEvent.ended(video);

    // Should now be on match clip
    expect(screen.getByText(/@bob's attempt/)).toBeInTheDocument();
  });

  it("shows Watch Again after all clips finished", async () => {
    render(<GameReplay turns={[makeTurn(1, { matchVideoUrl: null })]} />);
    await userEvent.click(screen.getByText(/Watch Full Replay/));

    const video = screen.getByLabelText(/Round 1: @alice sets Trick 1/);
    fireEvent.ended(video);

    expect(screen.getByText(/Watch Again/)).toBeInTheDocument();
  });

  it("shows outcome badge for match clips", async () => {
    render(<GameReplay turns={[makeTurn(2)]} />); // landed=true for even
    await userEvent.click(screen.getByText(/Watch Full Replay/));

    // Skip to match clip
    const setVideo = screen.getByLabelText(/Round 2: @alice sets Trick 2/);
    fireEvent.ended(setVideo);

    expect(screen.getByText("Landed")).toBeInTheDocument();
  });

  it("renders Close button to stop replay", async () => {
    render(<GameReplay turns={[makeTurn(1)]} />);
    await userEvent.click(screen.getByText(/Watch Full Replay/));

    await userEvent.click(screen.getByText("Close"));
    // Should go back to initial state
    expect(screen.getByText(/Watch Full Replay/)).toBeInTheDocument();
  });

  it("renders progress dots for clips", async () => {
    render(<GameReplay turns={[makeTurn(1)]} />);
    await userEvent.click(screen.getByText(/Watch Full Replay/));

    // 2 clips (set + match) = 2 progress dots
    const container = screen.getByText(/@alice's trick/).closest(".w-full");
    const dots = container!.querySelectorAll(".rounded-full");
    expect(dots.length).toBe(2);
  });
});
