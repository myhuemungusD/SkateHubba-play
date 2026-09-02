import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerDirectory } from "../PlayerDirectory";
import type { UserProfile } from "../../services/users";

/**
 * Rehomed from the Lobby suite when the roster moved out of the lobby and
 * into the challenge flow. The component is now purely presentational —
 * fetching and viewer/blocked filtering live in usePlayerDirectory (its own
 * suite) and OpponentPicker.test.tsx pins the two together.
 */

function player(overrides: Partial<UserProfile> & Pick<UserProfile, "uid" | "username">): UserProfile {
  return { stance: "Regular", createdAt: null, ...overrides };
}

const base = {
  loading: false,
  canChallenge: true,
  onChallengeUser: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

describe("PlayerDirectory", () => {
  it("renders every player's username", () => {
    const players = [
      player({ uid: "u2", username: "kickflip_king" }),
      player({ uid: "u3", username: "heelflip_hero", stance: "Goofy" }),
      player({ uid: "u4", username: "treflip_pro" }),
    ];
    render(<PlayerDirectory {...base} players={players} />);

    expect(screen.getByText("@kickflip_king")).toBeInTheDocument();
    expect(screen.getByText("@heelflip_hero")).toBeInTheDocument();
    expect(screen.getByText("@treflip_pro")).toBeInTheDocument();
  });

  it("shows the SKATERS count badge with the number of rows", () => {
    const players = [player({ uid: "u2", username: "player_one" }), player({ uid: "u3", username: "player_two" })];
    render(<PlayerDirectory {...base} players={players} />);

    const header = screen.getByText("SKATERS").parentElement!;
    expect(within(header).getByText("2")).toBeInTheDocument();
  });

  it("shows a content-shaped skeleton announced via role=status while loading", () => {
    render(<PlayerDirectory {...base} players={[]} loading />);

    // Assistive tech hears the wait; sighted users see placeholder rows.
    const status = screen.getByRole("status", { name: /loading skaters/i });
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(within(status).getByText("Loading skaters…")).toHaveClass("sr-only");
    expect(within(status).getByText("SKATERS")).toBeInTheDocument();
  });

  it("renders nothing when there are no other skaters", () => {
    const { container } = render(<PlayerDirectory {...base} players={[]} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("SKATERS")).not.toBeInTheDocument();
  });

  it("clicking a player name calls onViewPlayer with their uid", async () => {
    const onViewPlayer = vi.fn();
    render(
      <PlayerDirectory
        {...base}
        players={[player({ uid: "u2", username: "kickflip_king" })]}
        onViewPlayer={onViewPlayer}
      />,
    );

    await userEvent.click(screen.getByText("@kickflip_king"));

    expect(onViewPlayer).toHaveBeenCalledWith("u2");
  });

  it("clicking a player name is a no-op when onViewPlayer is omitted", async () => {
    render(<PlayerDirectory {...base} players={[player({ uid: "u2", username: "kickflip_king" })]} />);

    // Optional-chained callback — must not throw.
    await userEvent.click(screen.getByRole("button", { name: "View @kickflip_king's profile" }));

    expect(screen.getByText("@kickflip_king")).toBeInTheDocument();
  });

  it("clicking Challenge calls onChallengeUser with their username", async () => {
    const onChallengeUser = vi.fn();
    render(
      <PlayerDirectory
        {...base}
        players={[player({ uid: "u2", username: "kickflip_king" })]}
        onChallengeUser={onChallengeUser}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Challenge @kickflip_king" }));

    expect(onChallengeUser).toHaveBeenCalledWith("kickflip_king");
  });

  it("disables every Challenge button when canChallenge is false", async () => {
    const onChallengeUser = vi.fn();
    const players = [
      player({ uid: "u2", username: "kickflip_king" }),
      player({ uid: "u3", username: "heelflip_hero" }),
    ];
    render(<PlayerDirectory {...base} players={players} canChallenge={false} onChallengeUser={onChallengeUser} />);

    const buttons = screen.getAllByRole("button", { name: /^Challenge @/ });
    expect(buttons).toHaveLength(2);
    for (const btn of buttons) expect(btn).toBeDisabled();

    await userEvent.click(buttons[0]);
    expect(onChallengeUser).not.toHaveBeenCalled();
  });

  it("displays games-played counts with correct pluralization", () => {
    const players = [
      player({ uid: "u2", username: "many_games", gamesPlayed: 17 }),
      player({ uid: "u3", username: "one_game", stance: "Goofy", gamesPlayed: 1 }),
      player({ uid: "u4", username: "no_games", gamesPlayed: 0 }),
    ];
    render(<PlayerDirectory {...base} players={players} />);

    expect(screen.getByText(/Regular · 17 games/)).toBeInTheDocument();
    expect(screen.getByText(/Goofy · 1 game$/)).toBeInTheDocument();
    expect(screen.getByText(/Regular · No games yet/)).toBeInTheDocument();
  });

  it("falls back to wins + losses when gamesPlayed is absent", () => {
    const players = [
      player({ uid: "u2", username: "legacy_doc", stance: "Goofy", wins: 3, losses: 2 }),
      player({ uid: "u3", username: "wins_only", wins: 1 }),
      player({ uid: "u4", username: "blank_doc" }),
    ];
    render(<PlayerDirectory {...base} players={players} />);

    expect(screen.getByText(/Goofy · 5 games/)).toBeInTheDocument();
    expect(screen.getByText(/Regular · 1 game$/)).toBeInTheDocument();
    expect(screen.getByText(/Regular · No games yet/)).toBeInTheDocument();
  });

  it("marks verified pros with the pro username treatment", () => {
    render(
      <PlayerDirectory {...base} players={[player({ uid: "u2", username: "pro_skater", isVerifiedPro: true })]} />,
    );

    expect(screen.getByTitle("Verified Pro")).toBeInTheDocument();
  });
});
