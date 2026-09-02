import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { activeGame, createMockHelpers, openGameFromLobby } from "./smoke-helpers";
import type { GameDoc } from "../services/games";

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

/** Options createGame receives from a rematch (no challenge-screen extras). */
const rematchCreateOptions = {
  challengerIsVerifiedPro: undefined,
  opponentIsVerifiedPro: undefined,
  spotId: null,
  judgeUid: null,
  judgeUsername: null,
  trickCategory: null,
  customRules: null,
};

const { withGameSub, renderLobby, renderVerifiedLobby } = createMockHelpers({
  mockUseAuth: auth.refs.useAuth,
  mockSubscribeToMyGames: games.refs.subscribeToMyGames,
  mockSubscribeToGame: games.refs.subscribeToGame,
});

/**
 * Wire `subscribeToGame` to push `initial` synchronously and capture the
 * callback so the test can drive a follow-up update via `pushUpdate(g)`.
 * Used by the realtime-transition tests below.
 */
function captureGameSub(initial: GameDoc): { pushUpdate: (g: GameDoc) => void } {
  let cb: (g: GameDoc) => void = () => {};
  games.refs.subscribeToGame.mockImplementation((_id: string, fn: (g: GameDoc) => void) => {
    cb = fn;
    fn(initial);
    return vi.fn();
  });
  return { pushUpdate: (g: GameDoc) => cb(g) };
}

/**
 * Open a game from the lobby and land on the game-over screen.
 *
 * The lobby only lists active games now — a finished one collapses into the
 * "N finished · W–L" roll-up — so the way a player actually meets game over is
 * from inside the game: they open it and the live subscription delivers the
 * completed doc (their own final move, or the opponent's, or the forfeit
 * sweep). `lobbyGame` is what the lobby card is built from; `completed` is
 * what the game subscription pushes.
 */
async function openGameThenComplete(completed: GameDoc, lobbyGame: GameDoc = activeGame()): Promise<void> {
  const { pushUpdate } = captureGameSub(lobbyGame);
  await openGameFromLobby();
  await act(async () => {
    pushUpdate(completed);
  });
}

describe("Smoke: Game Over", () => {
  it("shows game over screen for a completed game (winner)", async () => {
    const game = activeGame({
      status: "complete",
      winner: "u1",
      p1Letters: 2,
      p2Letters: 5,
    });
    await renderVerifiedLobby([activeGame()]);
    await openGameThenComplete(game);

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
    await renderLobby([activeGame()]);
    await openGameThenComplete(game);

    await waitFor(() => {
      expect(screen.getByText("S.K.A.T.E.")).toBeInTheDocument();
      expect(screen.getByText(/@rival outlasted you/)).toBeInTheDocument();
    });
  });

  it("rematch from game over creates a new game", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    await renderVerifiedLobby([activeGame()]);
    games.refs.createGame.mockResolvedValueOnce("game2");
    // Rematch sources the opponent handle from their authoritative profile.
    users.refs.getUserProfile.mockResolvedValueOnce({ uid: "u2", username: "rival" });

    await openGameThenComplete(game);

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });

    // After rematch, subscribeToGame will be called for the new game
    withGameSub(activeGame({ id: "game2", phase: "setting", currentSetter: "u1", currentTurn: "u1" }));

    await userEvent.click(screen.getByText(/Rematch/));

    await waitFor(() => {
      expect(games.refs.createGame).toHaveBeenCalledWith("u1", "sk8r", "u2", "rival", rematchCreateOptions);
    });
  });

  it("back to lobby from game over returns to lobby", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    await renderLobby([activeGame()]);
    await openGameThenComplete(game);

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Back to Lobby"));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "YOUR TURN" })).toBeInTheDocument();
    });
  });

  it("shows forfeit result on game over screen", async () => {
    const game = activeGame({
      status: "forfeit",
      winner: "u1",
      p1Letters: 1,
      p2Letters: 2,
    });
    await renderLobby([activeGame()]);
    await openGameThenComplete(game);

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
    await renderLobby([activeGame()]);
    await openGameThenComplete(game);

    await waitFor(() => {
      expect(screen.getByText("Forfeit")).toBeInTheDocument();
      expect(screen.getByText("You ran out of time.")).toBeInTheDocument();
    });
  });

  it("transitions to game over when realtime update shows game complete", async () => {
    const game = activeGame({ phase: "setting", currentSetter: "u1", currentTurn: "u1" });
    await renderLobby([game]);

    // First subscription returns active game, then sends a completed update
    const { pushUpdate } = captureGameSub(game);

    await openGameFromLobby();

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
      pushUpdate(completedGame);
    });

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });
  });

  it("game over rematch button shows Starting... while loading", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    // Make createGame hang to show loading state
    games.refs.createGame.mockImplementation(() => new Promise(() => {}));
    users.refs.getUserProfile.mockResolvedValueOnce({ uid: "u2", username: "rival" });
    await renderVerifiedLobby([activeGame()]);

    await openGameThenComplete(game);

    await waitFor(() => expect(screen.getByText("You Win")).toBeInTheDocument());

    await userEvent.click(screen.getByText(/Rematch/));

    await waitFor(() => {
      expect(screen.getByText("Starting...")).toBeInTheDocument();
    });
  });

  it("game over shows disabled rematch button when email not verified", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    await renderLobby([activeGame()]); // renderLobby uses unverified user
    await openGameThenComplete(game);

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
      expect(screen.getByText("Verify email to rematch")).toBeInTheDocument();
    });
  });

  it("game over rematch completes full flow", async () => {
    const game = activeGame({ status: "complete", winner: "u1", p2Letters: 5 });
    const newGame = activeGame({ id: "game2" });
    games.refs.createGame.mockResolvedValueOnce("game2");
    users.refs.getUserProfile.mockResolvedValueOnce({ uid: "u2", username: "rival" });
    await renderVerifiedLobby([activeGame()]);

    await openGameThenComplete(game);
    await waitFor(() => expect(screen.getByText("You Win")).toBeInTheDocument());

    withGameSub(newGame);
    await userEvent.click(screen.getByText(/Rematch/));

    await waitFor(() => {
      expect(games.refs.createGame).toHaveBeenCalledWith("u1", "sk8r", "u2", "rival", rematchCreateOptions);
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
    // Opponent (u1's rival) is player1 here; sourced from their authoritative profile.
    users.refs.getUserProfile.mockResolvedValueOnce({ uid: "u2", username: "rival" });
    // The viewer is player2 in this game; the lobby card is built from the
    // same seating so the rematch has to flip the perspective either way.
    const mirroredActive = activeGame({
      player1Uid: "u2",
      player2Uid: "u1",
      player1Username: "rival",
      player2Username: "sk8r",
      currentTurn: "u1",
    });
    await renderVerifiedLobby([mirroredActive]);

    await openGameThenComplete(game, mirroredActive);
    await waitFor(() => expect(screen.getByText(/Rematch/)).toBeInTheDocument());

    await userEvent.click(screen.getByText(/Rematch/));
    await waitFor(() => {
      // Should call createGame with the opponent's uid and username
      expect(games.refs.createGame).toHaveBeenCalledWith("u1", "sk8r", "u2", "rival", rematchCreateOptions);
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

    const { pushUpdate } = captureGameSub(game);

    await openGameFromLobby();

    await waitFor(() => expect(screen.getByText(/Match.*Pop Shove/)).toBeInTheDocument());

    const forfeitGame = activeGame({ status: "forfeit", winner: "u1" });
    act(() => {
      pushUpdate(forfeitGame);
    });

    await waitFor(() => {
      expect(screen.getByText("You Win")).toBeInTheDocument();
    });
  });
});
