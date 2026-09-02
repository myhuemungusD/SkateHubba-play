import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { activeGame, createMockHelpers } from "./smoke-helpers";

/* ── Hoisted mocks ──────────────────────────── */
// The aggregate factory lives in ./harness/mockServices. Dynamic-importing it
// inside vi.hoisted() keeps the ref objects available before vi.mock() factory
// callbacks run.
const { auth, authSvc, users, games, storage, fcm, firebase, analytics, blocking, onboarding, sentry } =
  await vi.hoisted(async () => (await import("./harness/mockServices")).createAllSmokeMocks());

vi.mock("../hooks/useAuth", () => auth.module);
vi.mock("../services/auth", () => authSvc.module);
vi.mock("../services/users", () => users.module);
vi.mock("../services/games", () => games.module);
vi.mock("../services/storage", () => storage.module);
vi.mock("../services/fcm", () => fcm.module);
vi.mock("../firebase", () => firebase.module);
vi.mock("../services/analytics", () => analytics.module);
vi.mock("@sentry/react", () => sentry.module);
vi.mock("../services/blocking", () => blocking.module);
vi.mock("../services/onboarding", () => onboarding.module);

beforeEach(() => vi.clearAllMocks());

const { withGameSub, renderLobby } = createMockHelpers({
  mockUseAuth: auth.refs.useAuth,
  mockSubscribeToMyGames: games.refs.subscribeToMyGames,
  mockSubscribeToGame: games.refs.subscribeToGame,
});

describe("Smoke: Lobby", () => {
  it("shows lobby with active games", async () => {
    const game = activeGame();
    await renderLobby([game]);

    expect(await screen.findByText(/@sk8r/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "YOUR TURN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /vs @rival/i })).toBeInTheDocument();
    expect(screen.getByText("Your turn to set")).toBeInTheDocument();
  });

  it("shows empty state when no games exist", async () => {
    await renderLobby([]);
    // Empty-state anchor copy — sits alongside a "Challenge your first opponent"
    // CTA when the viewer has verified their email (see Lobby.tsx empty block).
    expect(await screen.findByText(/Ready to S\.K\.A\.T\.E\.\?/i)).toBeInTheDocument();
  });

  it("displays correct letter counts in lobby", async () => {
    const game = activeGame({ p1Letters: 2, p2Letters: 3 });
    await renderLobby([game]);

    // The lobby should show the game card
    expect(await screen.findByRole("button", { name: /vs @rival/i })).toBeInTheDocument();
  });

  it("pins the active game above the finished-game roll-up", async () => {
    // The lobby used to stack an ACTIVE section over a COMPLETED one. Finished
    // games now collapse to a single "N finished · W–L" line, so the pinning
    // this case exists for is: an actionable game is a card at the top, a
    // finished game is never a card, and the roll-up sits below the stack.
    const active1 = activeGame({ id: "g1", turnNumber: 3 });
    const completed = activeGame({
      id: "g2",
      status: "complete",
      winner: "u1",
      p2Letters: 5,
      player2Username: "loser",
    });
    await renderLobby([active1, completed]);

    const turnStack = await screen.findByRole("region", { name: "YOUR TURN" });
    expect(within(turnStack).getByRole("button", { name: /vs @rival/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /vs @loser/i })).not.toBeInTheDocument();

    const summary = screen.getByRole("button", { name: /1 finished · 1–0/ });
    expect(turnStack.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lobby shows 'Waiting on opponent' for non-turn games", async () => {
    const game = activeGame({ currentTurn: "u2" });
    await renderLobby([game]);

    // Games the viewer can't move on are context, not a task: they collapse
    // behind a count and only render their card once expanded.
    const disclosure = await screen.findByRole("button", { name: "1 waiting on them" });
    expect(screen.queryByText("They're setting a trick")).not.toBeInTheDocument();

    await userEvent.click(disclosure);

    expect(await screen.findByText("They're setting a trick")).toBeInTheDocument();
  });

  it("lobby shows PLAY badge when it's your turn", async () => {
    const game = activeGame({ currentTurn: "u1" });
    await renderLobby([game]);

    expect(await screen.findByText("PLAY")).toBeInTheDocument();
  });

  it("counts a forfeit win in the finished roll-up", async () => {
    // A forfeit is a finished game, not an active one: it must leave the turn
    // stack and land on the win side of the summary. (The per-game "forfeit"
    // label moved with the history to the profile screen — see
    // PlayerProfileScreen.test.tsx "shows forfeit game card with correct label".)
    const game = activeGame({
      status: "forfeit",
      winner: "u1",
      p1Letters: 1,
      p2Letters: 2,
    });
    await renderLobby([game]);

    expect(await screen.findByRole("button", { name: /1 finished · 1–0/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "YOUR TURN" })).not.toBeInTheDocument();
  });

  it("opens game via keyboard Enter on active game card", async () => {
    const game = activeGame({
      phase: "matching",
      currentTurn: "u1",
      currentSetter: "u2",
      currentTrickName: "Kickflip",
    });
    await renderLobby([game]);
    withGameSub(game);

    const gameCard = await screen.findByRole("button", { name: /vs @rival/i });
    gameCard.focus();
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByText(/Match.*Kickflip/)).toBeInTheDocument();
    });
  });

  it("finished-game roll-up opens the viewer's record", async () => {
    // Completed games are no longer cards on the lobby; the roll-up line is
    // the route from home to the finished-game history, which now lives on
    // the viewer's own profile screen.
    const game = activeGame({ status: "complete", winner: "u1", p1Letters: 0, p2Letters: 5 });
    await renderLobby([game]);
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /1 finished · 1–0/ }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Me" })).toHaveAttribute("aria-current", "page");
    });
  });

  it("challenge CTA is withheld when email is not verified", async () => {
    await renderLobby([]); // uses unverified user

    // The empty state swaps its CTA for the reason it can't be used, and the
    // lobby repeats the gate above the stack. Either way an unverified viewer
    // is never handed a control that would bounce off the /challenge guard.
    expect(await screen.findByText("Verify your email to start a game")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Challenge your first opponent/ })).not.toBeInTheDocument();
    expect(screen.getByText("Verify your email to start challenging.")).toBeInTheDocument();
  });

  it("opens active game via keyboard Space", async () => {
    const game = activeGame({
      phase: "matching",
      currentTurn: "u1",
      currentSetter: "u2",
      currentTrickName: "Kickflip",
    });
    await renderLobby([game]);
    withGameSub(game);

    const gameCard = await screen.findByRole("button", { name: /vs @rival/i });
    gameCard.focus();
    await userEvent.keyboard(" ");

    await waitFor(() => {
      expect(screen.getByText(/Match.*Kickflip/)).toBeInTheDocument();
    });
  });

  it("lobby game card ignores non-Enter/Space keys", async () => {
    const game = activeGame();
    await renderLobby([game]);

    const gameCard = await screen.findByRole("button", { name: /vs @rival/i });
    gameCard.focus();
    await userEvent.keyboard("a");

    // Still on lobby
    expect(screen.getByRole("heading", { name: "YOUR TURN" })).toBeInTheDocument();
  });
});
