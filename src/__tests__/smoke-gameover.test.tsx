import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { activeGame, createMockHelpers } from "./smoke-helpers";
import type { GameDoc } from "../services/games";

/* ── Hoisted mocks ──────────────────────────── */
// Harness factories are loaded via dynamic import inside vi.hoisted so the
// ref objects exist before vi.mock() factories run.
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

const { withGameSub, renderLobby, renderVerifiedLobby } = createMockHelpers({
  mockUseAuth: auth.refs.useAuth,
  mockSubscribeToMyGames: games.refs.subscribeToMyGames,
  mockSubscribeToGame: games.refs.subscribeToGame,
});

describe("Smoke: Game Over", () => {
  it("shows game over screen for a completed game (winner)", async () => {
    const game = activeGame({
      status: "complete",
      winner: "u1",
      p1Letters: 2,
      p2Letters: 5,
    });
    await renderVerifiedLobby([game]);
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
      expect(screen.getByText(/Rematch/)).toBeInTheDocument();
      expect(screen.getByText("Back to Lobby")).toBeInTheDocument();
    });
  });

  it("shows game over screen for a completed game (loser)", async () => {
    const game = activeGame({
      status: "complete",
      winner: "u2",
      p1Letters: 5,
      p2Letters: 1,
    });
    await renderLobby([game]);
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByText("S.K.A.T.E.")).toBeInTheDocument();
      expect(screen.getByText(/@rival outlasted you/)).toBeInTheDocument();
    });
  });

  it("rematch from game over creates a new game", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    await renderVerifiedLobby([game]);
    withGameSub(game);
    games.refs.createGame.mockResolvedValueOnce("game2");

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });

    // After rematch, subscribeToGame will be called for the new game
    withGameSub(activeGame({ id: "game2", phase: "setting", currentSetter: "u1", currentTurn: "u1" }));

    await userEvent.click(screen.getByText(/Rematch/));

    await waitFor(() => {
      expect(games.refs.createGame).toHaveBeenCalledWith("u1", "sk8r", "u2", "rival", {
        challengerIsVerifiedPro: undefined,
        opponentIsVerifiedPro: undefined,
        spotId: null,
        judgeUid: null,
        judgeUsername: null,
      });
    });
  });

  it("back to lobby from game over returns to lobby", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    await renderLobby([game]);
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Back to Lobby"));

    await waitFor(() => {
      expect(screen.getByText("Your Games")).toBeInTheDocument();
    });
  });

  it("shows forfeit result on game over screen", async () => {
    const game = activeGame({
      status: "forfeit",
      winner: "u1",
      p1Letters: 1,
      p2Letters: 2,
    });
    await renderLobby([game]);
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
      expect(screen.getByText(/@rival ran out of time/)).toBeInTheDocument();
    });
  });

  it("shows forfeit loss on game over screen", async () => {
    const game = activeGame({
      status: "forfeit",
      winner: "u2",
      p1Letters: 1,
      p2Letters: 2,
    });
    await renderLobby([game]);
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByText("Forfeit")).toBeInTheDocument();
      expect(screen.getByText("You ran out of time.")).toBeInTheDocument();
    });
  });

  it("transitions to game over when realtime update shows game complete", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    await renderLobby([game]);

    // First subscription returns active game, then sends a completed update
    let gameUpdateCb: (g: ReturnType<typeof activeGame>) => void;
    games.refs.subscribeToGame.mockImplementation((_id: string, cb: (g: ReturnType<typeof activeGame>) => void) => {
      gameUpdateCb = cb;
      cb(game); // initial active state
      return vi.fn();
    });

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Name your trick")).toBeInTheDocument();
    });

    // Simulate realtime update: game completed
    const completedGame = activeGame({
      status: "complete",
      winner: "u1",
      p1Letters: 2,
      p2Letters: 5,
    });
    act(() => {
      gameUpdateCb!(completedGame);
    });

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });
  });

  it("game over rematch button shows Starting... while loading", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    // Make createGame hang to show loading state
    games.refs.createGame.mockImplementation(() => new Promise(() => {}));
    await renderVerifiedLobby([game]);
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => expect(screen.getByText("You Win")).toBeInTheDocument());

    await userEvent.click(screen.getByText(/Rematch/));

    await waitFor(() => {
      expect(screen.getByText("Starting...")).toBeInTheDocument();
    });
  });

  it("game over shows disabled rematch button when email not verified", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    await renderLobby([game]); // renderLobby uses unverified user
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
      expect(screen.getByText("Verify email to rematch")).toBeInTheDocument();
    });
  });

  it("game over rematch completes full flow", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    const newGame = activeGame({ id: "game2" });
    games.refs.createGame.mockResolvedValueOnce("game2");
    await renderVerifiedLobby([game]);
    withGameSub(game);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));
    await waitFor(() => expect(screen.getByText("You Win")).toBeInTheDocument());

    withGameSub(newGame);
    await userEvent.click(screen.getByText(/Rematch/));

    await waitFor(() => {
      expect(games.refs.createGame).toHaveBeenCalledWith("u1", "sk8r", "u2", "rival", {
        challengerIsVerifiedPro: undefined,
        opponentIsVerifiedPro: undefined,
        spotId: null,
        judgeUid: null,
        judgeUsername: null,
      });
    });
  });

  it("rematch computes opponent from player2 perspective", async () => {
    const game = activeGame({
      status: "complete",
      winner: "u2",
      player1Uid: "u2",
      player2Uid: "u1",
      player1Username: "rival",
      player2Username: "sk8r",
    });
    games.refs.createGame.mockResolvedValueOnce("rematch1");
    games.refs.subscribeToGame.mockImplementation((_id: string, cb: (g: GameDoc | null) => void) => {
      cb(game);
      return vi.fn();
    });
    await renderVerifiedLobby([game]);

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));
    await waitFor(() => expect(screen.getByText(/Rematch/)).toBeInTheDocument());

    await userEvent.click(screen.getByText(/Rematch/));
    await waitFor(() => {
      // Should call createGame with the opponent's uid and username
      expect(games.refs.createGame).toHaveBeenCalledWith("u1", "sk8r", "u2", "rival", {
        challengerIsVerifiedPro: undefined,
        opponentIsVerifiedPro: undefined,
        spotId: null,
        judgeUid: null,
        judgeUsername: null,
      });
    });
  });

  it("game transitions to gameover on forfeit real-time update", async () => {
    const game = activeGame({
      phase: "matching",
      currentTurn: "u1",
      currentSetter: "u2",
      currentTrickName: "Pop Shove",
    });
    await renderLobby([game]);

    let gameUpdateCb: (g: ReturnType<typeof activeGame>) => void;
    games.refs.subscribeToGame.mockImplementation((_id: string, cb: (g: ReturnType<typeof activeGame>) => void) => {
      gameUpdateCb = cb;
      cb(game);
      return vi.fn();
    });

    await userEvent.click(await screen.findByRole("button", { name: /vs @rival/i }));

    await waitFor(() => expect(screen.getByText(/Match.*Pop Shove/)).toBeInTheDocument());

    const forfeitGame = activeGame({ status: "forfeit", winner: "u1" });
    act(() => {
      gameUpdateCb!(forfeitGame);
    });

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });
  });
});
