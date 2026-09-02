import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Timestamp } from "firebase/firestore";
import { Lobby } from "../Lobby";
import { NotificationProvider } from "../../context/NotificationContext";
import type { ComponentProps, ReactNode } from "react";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";

function Wrapper({ children }: { children: ReactNode }) {
  return <NotificationProvider uid="u1">{children}</NotificationProvider>;
}

const renderWithProviders = (ui: ReactNode, options?: Omit<RenderOptions, "wrapper">) =>
  render(ui, { wrapper: Wrapper, ...options });

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("../../services/auth", () => ({
  resendVerification: vi.fn(),
}));

type LobbyProps = ComponentProps<typeof Lobby>;

const profile: UserProfile = { uid: "u1", username: "sk8r", stance: "regular", createdAt: null };
const judgeProfile: UserProfile = { uid: "j1", username: "ref", stance: "regular", createdAt: null };

const future = (ms: number) => Timestamp.fromMillis(Date.now() + ms);
const past = (ms: number) => Timestamp.fromMillis(Date.now() - ms);

function makeGame(overrides: Partial<GameDoc> = {}): GameDoc {
  return {
    id: "game1",
    player1Uid: "u1",
    player2Uid: "u2",
    player1Username: "sk8r",
    player2Username: "rival",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: "u1",
    phase: "setting",
    currentSetter: "u1",
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: future(86_400_000),
    turnNumber: 1,
    winner: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

const defaultProps: LobbyProps = {
  profile,
  games: [],
  onChallenge: vi.fn(),
  onOpenGame: vi.fn(),
  onSignOut: vi.fn(),
  onViewRecord: vi.fn(),
  user: { emailVerified: true },
};

function renderLobby(overrides: Partial<LobbyProps> = {}) {
  return renderWithProviders(<Lobby {...defaultProps} {...overrides} />);
}

/** THEIR TURN is collapsed by default; its cards only exist once expanded. */
async function renderExpanded(overrides: Partial<LobbyProps> = {}) {
  const result = renderLobby(overrides);
  await userEvent.click(screen.getByRole("button", { name: /waiting on them/ }));
  return result;
}

const yourTurnSection = () => screen.queryByRole("region", { name: "YOUR TURN" });
const theirTurnToggle = () => screen.queryByRole("button", { name: /waiting on them/ });
const cardByOpponent = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Lobby", () => {
  // The redesign dropped the "Your Games" section header; the screen name lives
  // on as an sr-only h1 so the primary signed-in destination still has one
  // (and only one) level-1 heading for the document outline.
  it("exposes exactly one level-1 heading naming the screen", () => {
    renderLobby({ games: [makeGame()] });

    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Your games");
  });

  it("helper functions compute correct values", async () => {
    const game = makeGame({ currentTurn: "u2", p1Letters: 1, p2Letters: 3 });
    await renderExpanded({ games: [game] });

    // opponent name is rival
    expect(cardByOpponent(/vs @rival/i)).toBeInTheDocument();
    // not my turn → phase-specific waiting text
    expect(screen.getByText("They're setting a trick")).toBeInTheDocument();
  });

  it("helper functions work for player2 perspective", () => {
    const game = makeGame({
      player1Uid: "other",
      player2Uid: "u1",
      player1Username: "someone",
      player2Username: "sk8r",
      currentTurn: "u1",
      p1Letters: 2,
      p2Letters: 4,
    });
    renderLobby({ games: [game] });

    // opponent should be player1's username since profile is player2
    expect(cardByOpponent(/vs @someone/i)).toBeInTheDocument();
    // my turn → phase-specific turn text
    expect(screen.getByText("Your turn to set")).toBeInTheDocument();
  });

  // ── Turn routing ──

  it("puts games awaiting the viewer in YOUR TURN and leaves the rest out", () => {
    const mine = makeGame({ id: "mine", currentTurn: "u1", player2Username: "rival" });
    const theirs = makeGame({ id: "theirs", currentTurn: "u2", player2Username: "other" });
    renderLobby({ games: [mine, theirs] });

    const region = yourTurnSection();
    expect(region).toBeInTheDocument();
    expect(within(region!).getByRole("button", { name: /vs @rival/i })).toBeInTheDocument();
    expect(within(region!).queryByRole("button", { name: /vs @other/i })).not.toBeInTheDocument();
    expect(theirTurnToggle()).toHaveTextContent("1 waiting on them");
  });

  it("sorts YOUR TURN by soonest deadline, deadline-less games last", () => {
    const games = [
      makeGame({ id: "none", player2Username: "nodeadline", turnDeadline: undefined as unknown as Timestamp }),
      makeGame({ id: "later", player2Username: "later", turnDeadline: future(10_000_000) }),
      makeGame({ id: "soon", player2Username: "soon", turnDeadline: future(60_000) }),
    ];
    renderLobby({ games });

    const order = within(yourTurnSection()!)
      .getAllByRole("button")
      .map((el) => el.textContent ?? "");
    expect(order).toHaveLength(3);
    expect(order[0]).toContain("@soon");
    expect(order[1]).toContain("@later");
    expect(order[2]).toContain("@nodeadline");
  });

  // Each guard in isActionableTurn gets its own case: these decide whether a
  // game shows up as a task or as passive context, and a wrong answer either
  // nags the viewer about a game they cannot move on or hides a real turn.
  const routingCases: Array<{ name: string; viewer: UserProfile; game: Partial<GameDoc>; actionable: boolean }> = [
    {
      name: "an expired turn deadline keeps the viewer's own turn out of YOUR TURN",
      viewer: profile,
      game: { currentTurn: "u1", turnDeadline: past(1000) },
      actionable: false,
    },
    {
      name: "disputable freezes the player out of YOUR TURN",
      viewer: profile,
      game: { phase: "disputable", currentTurn: "u1", judgeId: "j1", judgeUsername: "ref" },
      actionable: false,
    },
    {
      name: "disputable puts the referee in YOUR TURN",
      viewer: judgeProfile,
      game: { phase: "disputable", currentTurn: "j1", judgeId: "j1", judgeUsername: "ref" },
      actionable: true,
    },
    {
      name: "setReview freezes the player out of YOUR TURN",
      viewer: profile,
      game: { phase: "setReview", currentTurn: "u1", judgeId: "j1", judgeUsername: "ref" },
      actionable: false,
    },
    {
      name: "setReview puts the referee in YOUR TURN",
      viewer: judgeProfile,
      game: { phase: "setReview", currentTurn: "j1", judgeId: "j1", judgeUsername: "ref" },
      actionable: true,
    },
    {
      name: "communityReview freezes the player out of YOUR TURN",
      viewer: profile,
      game: { phase: "communityReview", currentTurn: "u1" },
      actionable: false,
    },
    {
      name: "communityReview freezes the referee too",
      viewer: judgeProfile,
      game: { phase: "communityReview", currentTurn: "j1", judgeId: "j1", judgeUsername: "ref" },
      actionable: false,
    },
    {
      name: "pendingReview puts the current setter in YOUR TURN",
      viewer: profile,
      game: { phase: "pendingReview", currentSetter: "u1", currentTurn: "u2" },
      actionable: true,
    },
    {
      name: "pendingReview leaves the non-setter out of YOUR TURN",
      viewer: profile,
      game: { phase: "pendingReview", currentSetter: "u2", currentTurn: "u1" },
      actionable: false,
    },
  ];

  it.each(routingCases)("$name", ({ viewer, game, actionable }) => {
    renderLobby({ profile: viewer, games: [makeGame(game)] });

    expect(!!yourTurnSection()).toBe(actionable);
    expect(theirTurnToggle()).toBe(actionable ? null : screen.getByRole("button", { name: "1 waiting on them" }));
  });

  // The routing cases above pin WHERE an expired game lands; these pin what the
  // card says once it gets there. The two used to contradict each other: the
  // disclosure read "1 waiting on them" over a card reading "Your turn to set".
  it("labels an expired turn the viewer let lapse without claiming it's their turn", async () => {
    await renderExpanded({ games: [makeGame({ currentTurn: "u1", turnDeadline: past(1000) })] });

    expect(screen.getByText("Your time ran out — resolving")).toBeInTheDocument();
    expect(screen.queryByText("Your turn to set")).not.toBeInTheDocument();
  });

  it("labels an expired turn on the opponent's side as theirs, not as a live turn", async () => {
    await renderExpanded({
      games: [
        makeGame({ currentTurn: "u2", phase: "matching", currentTrickName: "kickflip", turnDeadline: past(1000) }),
      ],
    });

    expect(screen.getByText("Their time ran out — resolving")).toBeInTheDocument();
    expect(screen.queryByText("Matching: kickflip")).not.toBeInTheDocument();
  });

  // ── THEIR TURN section ──

  it("collapses THEIR TURN by default and reports the waiting count", () => {
    const games = [
      makeGame({ id: "a", currentTurn: "u2" }),
      makeGame({ id: "b", currentTurn: "u2", player2Username: "other" }),
    ];
    renderLobby({ games });

    const toggle = theirTurnToggle()!;
    expect(toggle).toHaveTextContent("2 waiting on them");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /vs @rival/i })).not.toBeInTheDocument();
  });

  it("renders THEIR TURN cards once expanded", async () => {
    await renderExpanded({ games: [makeGame({ currentTurn: "u2" })] });

    expect(theirTurnToggle()).toHaveAttribute("aria-expanded", "true");
    expect(cardByOpponent(/vs @rival/i)).toBeInTheDocument();
  });

  // The urgent treatment is forced per-section, so a stale currentTurn pointing
  // at the viewer on an expired game must not light the card up as a task.
  it("never applies the urgent treatment to THEIR TURN cards", async () => {
    await renderExpanded({ games: [makeGame({ currentTurn: "u1", turnDeadline: past(1000) })] });

    expect(cardByOpponent(/vs @rival/i)).toBeInTheDocument();
    expect(screen.queryByText("PLAY")).not.toBeInTheDocument();
  });

  it("applies the urgent treatment to YOUR TURN cards", () => {
    renderLobby({ games: [makeGame()] });

    expect(screen.getByText("PLAY")).toBeInTheDocument();
  });

  // ── Completed summary ──

  it("summarises completed games as total and W–L", () => {
    const games = [
      makeGame({ id: "w", status: "complete", winner: "u1" }),
      makeGame({ id: "l", status: "complete", winner: "u2" }),
      makeGame({ id: "f", status: "forfeit", winner: "u2" }),
    ];
    renderLobby({ games });

    expect(screen.getByRole("button", { name: "3 finished · 1–2" })).toBeInTheDocument();
  });

  it("counts judge-only completed games toward the total but not W–L", () => {
    const games = [
      makeGame({ id: "judged", status: "complete", winner: "u1", judgeId: "j1", judgeUsername: "ref" }),
      makeGame({ id: "played", status: "complete", winner: "j1", player1Uid: "j1", player2Uid: "u2" }),
    ];
    renderLobby({ profile: judgeProfile, games });

    expect(screen.getByRole("button", { name: "2 finished · 1–0" })).toBeInTheDocument();
  });

  it("hides the completed summary when nothing is finished", () => {
    renderLobby({ games: [makeGame()] });

    expect(screen.queryByRole("button", { name: /finished/ })).not.toBeInTheDocument();
  });

  it("completed summary line fires onViewRecord", async () => {
    const onViewRecord = vi.fn();
    renderLobby({ games: [makeGame({ status: "complete", winner: "u1" })], onViewRecord });

    await userEvent.click(screen.getByRole("button", { name: /finished/ }));

    expect(onViewRecord).toHaveBeenCalledTimes(1);
  });

  // ── Empty state & verification notice ──

  it("shows the empty state only when the viewer has no games at all", () => {
    renderLobby({ games: [] });
    expect(screen.getByText("Ready to S.K.A.T.E.?")).toBeInTheDocument();
  });

  it("hides the empty state when any game exists", () => {
    renderLobby({ games: [makeGame({ status: "complete", winner: "u2" })] });
    expect(screen.queryByText("Ready to S.K.A.T.E.?")).not.toBeInTheDocument();
  });

  it("empty state Challenge CTA fires onChallenge when email is verified", async () => {
    const onChallenge = vi.fn();
    renderLobby({ onChallenge });

    await userEvent.click(screen.getByRole("button", { name: /Challenge your first opponent/i }));

    expect(onChallenge).toHaveBeenCalledTimes(1);
  });

  it("shows the unverified-email notice when the account is not verified", () => {
    renderLobby({ user: { emailVerified: false } });

    expect(screen.getByText("Verify your email to start challenging.")).toBeInTheDocument();
  });

  it("hides the unverified-email notice for a verified account", () => {
    renderLobby({ user: { emailVerified: true } });

    expect(screen.queryByText("Verify your email to start challenging.")).not.toBeInTheDocument();
  });

  // ── Card interaction contract ──

  // Regression: game cards must not nest an interactive element inside another.
  // The Profile sub-button used to live inside the card <button>, which is
  // invalid HTML (no interactive descendants of <button>) and relied on
  // stopPropagation to keep the card's onClick from firing on Profile clicks.
  it("active game card does not nest a button inside another button", () => {
    const { container } = renderLobby({ games: [makeGame()], onViewPlayer: vi.fn() });
    expect(container.querySelectorAll("button button").length).toBe(0);
  });

  it("active game card keyboard Enter opens game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame();
    renderLobby({ games: [game], onOpenGame });

    cardByOpponent(/vs @rival/i).focus();
    await userEvent.keyboard("{Enter}");

    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("active game card keyboard Space opens game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame();
    renderLobby({ games: [game], onOpenGame });

    cardByOpponent(/vs @rival/i).focus();
    await userEvent.keyboard(" ");

    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("active game card click opens game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame();
    renderLobby({ games: [game], onOpenGame });

    await userEvent.click(cardByOpponent(/vs @rival/i));

    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("non-matching key on a game card does not open the game", async () => {
    const onOpenGame = vi.fn();
    renderLobby({ games: [makeGame()], onOpenGame });

    cardByOpponent(/vs @rival/i).focus();
    await userEvent.keyboard("a");

    expect(onOpenGame).not.toHaveBeenCalled();
  });

  // A held key (auto-repeat) should not re-fire navigation — matches native
  // <button> semantics and avoids stuttered double-navigation on the card.
  it("active game card ignores repeated keydown from a held key", () => {
    const onOpenGame = vi.fn();
    renderLobby({ games: [makeGame()], onOpenGame });

    const card = cardByOpponent(/vs @rival/i);
    // Simulate auto-repeat (e.repeat === true on held key)
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, repeat: true }));
    card.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, repeat: true }));

    expect(onOpenGame).not.toHaveBeenCalled();
  });

  // Native-button keyboard parity: Enter activates on keydown (immediate),
  // Space arms on keydown and only activates on keyup — letting the user
  // move focus off the card to cancel before releasing.
  it("active game card fires Enter on keydown (native <button> parity)", () => {
    const onOpenGame = vi.fn();
    renderLobby({ games: [makeGame()], onOpenGame });

    cardByOpponent(/vs @rival/i).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onOpenGame).toHaveBeenCalledTimes(1);
  });

  it("active game card fires Space on keyup, not on keydown alone", () => {
    const onOpenGame = vi.fn();
    renderLobby({ games: [makeGame()], onOpenGame });

    const card = cardByOpponent(/vs @rival/i);
    card.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(onOpenGame).not.toHaveBeenCalled();

    card.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    expect(onOpenGame).toHaveBeenCalledTimes(1);
  });

  it("active game card cancels a primed Space when focus leaves before keyup", () => {
    const onOpenGame = vi.fn();
    renderLobby({ games: [makeGame()], onOpenGame });

    const card = cardByOpponent(/vs @rival/i);
    card.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    // User tabs away or otherwise blurs the card — native buttons abort here.
    // React delegates onBlur via the bubbling `focusout` event at the root.
    card.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    card.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));

    expect(onOpenGame).not.toHaveBeenCalled();
  });

  it("Profile button on a game card opens the profile without opening the game", async () => {
    const onOpenGame = vi.fn();
    const onViewPlayer = vi.fn();
    renderLobby({ games: [makeGame()], onOpenGame, onViewPlayer });

    await userEvent.click(screen.getByRole("button", { name: /View @rival's profile/i }));

    expect(onViewPlayer).toHaveBeenCalledWith("u2");
    expect(onOpenGame).not.toHaveBeenCalled();
  });

  // ── Header & pagination ──

  it("Sign Out button fires onSignOut", async () => {
    const onSignOut = vi.fn();
    renderLobby({ onSignOut });

    await userEvent.click(screen.getByRole("button", { name: "Sign Out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("View my record header button fires onViewRecord", async () => {
    const onViewRecord = vi.fn();
    renderLobby({ onViewRecord });

    // Accessible name comes from the `title` tooltip on the avatar/username button
    await userEvent.click(screen.getByTitle("View my record"));

    expect(onViewRecord).toHaveBeenCalledTimes(1);
  });

  it("Load More button fires onLoadMore", async () => {
    const onLoadMore = vi.fn();
    renderLobby({ games: [makeGame()], hasMoreGames: true, onLoadMore });

    await userEvent.click(screen.getByRole("button", { name: "Load More Games" }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("Load More button is disabled while gamesLoading", () => {
    renderLobby({ games: [makeGame()], hasMoreGames: true, gamesLoading: true });

    expect(screen.getByRole("button", { name: "Loading..." })).toBeDisabled();
  });

  // ── Judge/referee game card tests ──

  describe("judge-aware game cards", () => {
    const judgeProps: Partial<LobbyProps> = { profile: judgeProfile };

    function makeJudgeGame(overrides: Partial<GameDoc> = {}): GameDoc {
      return makeGame({
        judgeId: "j1",
        judgeUsername: "ref",
        judgeStatus: "accepted",
        ...overrides,
      });
    }

    it("shows REF label and both player names for judge viewer on active game", async () => {
      await renderExpanded({ ...judgeProps, games: [makeJudgeGame()] });

      expect(screen.getByText(/REF/)).toBeInTheDocument();
      expect(screen.getByText(/@sk8r vs @rival/)).toBeInTheDocument();
    });

    it("shows RULE badge instead of PLAY when it is the judge's turn", () => {
      renderLobby({ ...judgeProps, games: [makeJudgeGame({ currentTurn: "j1", phase: "disputable" })] });

      expect(screen.getByText("RULE")).toBeInTheDocument();
      expect(screen.queryByText("PLAY")).not.toBeInTheDocument();
    });

    it("shows 'Rule: landed or missed?' for judge during disputable phase", () => {
      renderLobby({ ...judgeProps, games: [makeJudgeGame({ currentTurn: "j1", phase: "disputable" })] });

      expect(screen.getByText("Rule: landed or missed?")).toBeInTheDocument();
    });

    it("shows 'Rule: clean or sketchy?' for judge during setReview phase", () => {
      renderLobby({ ...judgeProps, games: [makeJudgeGame({ currentTurn: "j1", phase: "setReview" })] });

      expect(screen.getByText("Rule: clean or sketchy?")).toBeInTheDocument();
    });

    it("shows 'Setting a trick' for judge during setting phase", async () => {
      await renderExpanded({ ...judgeProps, games: [makeJudgeGame({ currentTurn: "u1", phase: "setting" })] });

      expect(screen.getByText("Setting a trick")).toBeInTheDocument();
    });

    it("shows both players' letter scores (not You/Them) for judge viewer", async () => {
      await renderExpanded({ ...judgeProps, games: [makeJudgeGame({ p1Letters: 2, p2Letters: 3 })] });

      expect(screen.getByText("@sk8r")).toBeInTheDocument();
      expect(screen.getByText("@rival")).toBeInTheDocument();
      expect(screen.queryByText("You")).not.toBeInTheDocument();
      expect(screen.queryByText("Them")).not.toBeInTheDocument();
    });

    it("shows referee reviewing label for players during disputable phase", async () => {
      await renderExpanded({ games: [makeJudgeGame({ currentTurn: "j1", phase: "disputable" })] });

      expect(screen.getByText("Referee @ref reviewing")).toBeInTheDocument();
    });

    it("hides Profile button on active judge game card (judge is not a player)", async () => {
      await renderExpanded({ ...judgeProps, games: [makeJudgeGame()], onViewPlayer: vi.fn() });

      expect(screen.queryByRole("button", { name: /View.*profile/i })).not.toBeInTheDocument();
    });
  });
});
