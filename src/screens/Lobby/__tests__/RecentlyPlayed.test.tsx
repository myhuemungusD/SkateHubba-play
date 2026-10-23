import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GameDoc } from "../../../services/games";
import { RecentlyPlayed } from "../components/RecentlyPlayed";
import type { RecentOpponent } from "../recentOpponents";

const opp = (o: Partial<RecentOpponent> = {}): RecentOpponent => ({
  uid: "u2",
  username: "rival",
  isVerifiedPro: false,
  games: 4,
  decided: 4,
  wins: 2,
  lastPlayedMs: 1,
  activeGame: null,
  ...o,
});

describe("RecentlyPlayed", () => {
  it("renders nothing without opponents", () => {
    const { container } = render(<RecentlyPlayed opponents={[]} onOpenGame={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each opponent with a wins / games record and no W/L letters", () => {
    render(
      <RecentlyPlayed
        opponents={[opp(), opp({ uid: "u3", username: "kid", games: 1, decided: 1, wins: 1 })]}
        onOpenGame={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "RECENTLY PLAYED" })).toBeInTheDocument();
    expect(screen.getByTestId("recent-record-u2")).toHaveTextContent("2 / 4");
    expect(screen.getByText("2 wins out of 4 games")).toBeInTheDocument();
    expect(screen.getByTestId("recent-record-u3")).toHaveTextContent("1 / 1");
    expect(screen.getByTestId("recently-played")).not.toHaveTextContent(/\dW|\dL|games played/);
  });

  it("shows no record (never 0 / 0) when no game against them was decided", () => {
    render(<RecentlyPlayed opponents={[opp({ games: 1, decided: 0, wins: 0 })]} onOpenGame={vi.fn()} />);
    expect(screen.queryByTestId("recent-record-u2")).toBeNull();
    expect(screen.getByTestId("recently-played")).not.toHaveTextContent("0 / 0");
    expect(screen.queryByText("In progress")).toBeNull();
    expect(screen.getByRole("button", { name: "@rival. View profile" })).toBeInTheDocument();
  });

  it("says In progress when the only game against them is still going", () => {
    const g = { id: "live" } as GameDoc;
    render(<RecentlyPlayed opponents={[opp({ games: 1, decided: 0, wins: 0, activeGame: g })]} onOpenGame={vi.fn()} />);
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.queryByTestId("recent-record-u2")).toBeNull();
    expect(screen.getByRole("button", { name: "@rival, first game in progress. View profile" })).toBeInTheDocument();
  });

  it("opens the profile from the row", async () => {
    const onViewPlayer = vi.fn();
    render(<RecentlyPlayed opponents={[opp()]} onOpenGame={vi.fn()} onViewPlayer={onViewPlayer} />);
    await userEvent.click(screen.getByRole("button", { name: "@rival, 2 wins out of 4 games. View profile" }));
    expect(onViewPlayer).toHaveBeenCalledWith("u2");
  });

  it("profile tap is harmless without a handler", async () => {
    render(<RecentlyPlayed opponents={[opp()]} onOpenGame={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /View profile/ }));
  });

  it("Rematch starts a new game and shows progress", async () => {
    let done!: () => void;
    const onRematch = vi.fn(() => new Promise<void>((r) => (done = r)));
    render(<RecentlyPlayed opponents={[opp()]} onOpenGame={vi.fn()} onRematch={onRematch} />);
    await userEvent.click(screen.getByRole("button", { name: "Rematch @rival" }));
    expect(onRematch).toHaveBeenCalledWith("u2", "rival");
    expect(screen.getByRole("button", { name: "Rematch @rival" })).toHaveTextContent("Starting…");
    expect(screen.getByRole("button", { name: "Rematch @rival" })).toBeDisabled();
    done();
    expect(await screen.findByText("Rematch")).toBeInTheDocument();
  });

  it("says so when a rematch fails", async () => {
    const onRematch = vi.fn().mockRejectedValue(new Error("nope"));
    render(<RecentlyPlayed opponents={[opp()]} onOpenGame={vi.fn()} onRematch={onRematch} />);
    await userEvent.click(screen.getByRole("button", { name: "Rematch @rival" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't start a rematch with @rival. Try again.");
  });

  it("disables Rematch while the viewer can't challenge", () => {
    render(<RecentlyPlayed opponents={[opp()]} onOpenGame={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Rematch @rival, verify email to rematch" })).toBeDisabled();
  });

  it("offers Open game instead of Rematch when a game is already going", async () => {
    const active = { id: "g1" } as GameDoc;
    const onOpenGame = vi.fn();
    const onRematch = vi.fn();
    render(<RecentlyPlayed opponents={[opp({ activeGame: active })]} onOpenGame={onOpenGame} onRematch={onRematch} />);
    expect(screen.queryByRole("button", { name: /Rematch/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open your game with @rival" }));
    expect(onOpenGame).toHaveBeenCalledWith(active);
    expect(onRematch).not.toHaveBeenCalled();
  });
});
