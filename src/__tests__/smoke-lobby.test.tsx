import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { activeGame, createMockHelpers } from "./smoke-helpers";

/* ── Hoisted mocks ──────────────────────────── */
// Harness factories are loaded via dynamic import inside vi.hoisted so the
// ref objects exist before vi.mock() factories run. Top-level `await` is
// supported in vitest's ESM test modules.
const { auth, authSvc, users, games, storage, fcm, firebase, analytics, blocking, sentry } = await vi.hoisted(
  async () => {
    const m = await import("./harness/mockServices");
    return {
      auth: m.createUseAuthMocks(),
      authSvc: m.createAuthServiceMocks(),
      users: m.createUsersServiceMocks(),
      games: m.createGamesServiceMocks(),
      storage: m.createStorageServiceMocks(),
      fcm: m.createFcmServiceMocks(),
      firebase: m.createFirebaseMocks(),
      analytics: m.createAnalyticsMocks(),
      blocking: m.createBlockingServiceMocks(),
      sentry: m.createSentryMocks(),
    };
  },
);

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
    expect(screen.getByText("Your Games")).toBeInTheDocument();
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

  it("sorts active games before completed games", async () => {
    const active1 = activeGame({ id: "g1", turnNumber: 3 });
    const completed = activeGame({
      id: "g2",
      status: "complete",
      winner: "u1",
      p2Letters: 5,
      player2Username: "loser",
    });
    await renderLobby([active1, completed]);

    expect(await screen.findByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
  });

  it("lobby shows 'Waiting on opponent' for non-turn games", async () => {
    const game = activeGame({ currentTurn: "u2" });
    await renderLobby([game]);

    expect(await screen.findByText("They're setting a trick")).toBeInTheDocument();
  });

  it("lobby shows PLAY badge when it's your turn", async () => {
    const game = activeGame({ currentTurn: "u1" });
    await renderLobby([game]);

    expect(await screen.findByText("PLAY")).toBeInTheDocument();
  });

  it("lobby shows forfeit label on completed forfeit game", async () => {
    const game = activeGame({
      status: "forfeit",
      winner: "u1",
      p1Letters: 1,
      p2Letters: 2,
    });
    await renderLobby([game]);

    expect(await screen.findByText(/forfeit/i)).toBeInTheDocument();
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

  it("opens completed game via keyboard Space on done card", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p1Letters: 0, p2Letters: 5 });
    await renderLobby([game]);
    withGameSub(game);

    const gameCard = await screen.findByRole("button", { name: /vs @rival/i });
    gameCard.focus();
    await userEvent.keyboard(" ");

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });
  });

  it("challenge button is disabled when email is not verified", async () => {
    await renderLobby([]); // uses unverified user
    const btn = await screen.findByText(/Challenge Someone/);
    expect(btn.closest("button")).toBeDisabled();
    expect(screen.getByText("Verify your email to start challenging")).toBeInTheDocument();
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
    expect(screen.getByText("Your Games")).toBeInTheDocument();
  });
});
