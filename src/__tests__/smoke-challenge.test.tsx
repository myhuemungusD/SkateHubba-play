import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { activeGame, createMockHelpers } from "./smoke-helpers";

/* ── Hoisted mocks ──────────────────────────── */
// The aggregate factory lives in ./harness/mockServices. Dynamic-importing it
// inside vi.hoisted() keeps the ref objects available before vi.mock() factory
// callbacks run.
const { auth, authSvc, users, games, storage, fcm, firebase, analytics, blocking, sentry } = await vi.hoisted(
  async () => (await import("./harness/mockServices")).createAllSmokeMocks(),
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

/** Navigate to challenge screen and wait for lazy load to resolve. */
async function goToChallenge() {
  await userEvent.click(await screen.findByText(/Challenge Someone/));
  await screen.findByPlaceholderText("their_handle");
}

describe("Smoke: Challenge", () => {
  it("navigates to challenge screen and sends a challenge", async () => {
    await renderVerifiedLobby([]);
    withGameSub(activeGame());
    users.refs.getUidByUsername.mockResolvedValueOnce("u2");
    games.refs.createGame.mockResolvedValueOnce("game1");

    await goToChallenge();
    expect(await screen.findByText("Challenge")).toBeInTheDocument();
    expect(screen.getByText(/First to S.K.A.T.E. loses/)).toBeInTheDocument();

    const input = screen.getByPlaceholderText("their_handle");
    await userEvent.type(input, "rival");

    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(users.refs.getUidByUsername).toHaveBeenCalledWith("rival");
      expect(games.refs.createGame).toHaveBeenCalledWith("u1", "sk8r", "u2", "rival", {
        challengerIsVerifiedPro: undefined,
        opponentIsVerifiedPro: undefined,
        spotId: null,
        judgeUid: null,
        judgeUsername: null,
      });
    });
  });

  it("challenge screen prevents self-challenge", async () => {
    await renderVerifiedLobby([]);

    await goToChallenge();

    const input = await screen.findByPlaceholderText("their_handle");
    await userEvent.type(input, "sk8r");
    await userEvent.click(screen.getByText(/Send Challenge/));

    expect(screen.getByText("You can't challenge yourself")).toBeInTheDocument();
  });

  it("challenge shows error when opponent not found", async () => {
    users.refs.getUidByUsername.mockResolvedValueOnce(null);
    await renderVerifiedLobby([]);

    await goToChallenge();

    const input = await screen.findByPlaceholderText("their_handle");
    await userEvent.type(input, "ghost");

    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText(/@ghost doesn't exist yet/)).toBeInTheDocument();
    });
  });

  it("challenge disables send button with short username", async () => {
    await renderVerifiedLobby([]);

    await goToChallenge();

    const input = await screen.findByPlaceholderText("their_handle");
    await userEvent.type(input, "ab");

    const sendBtn = screen.getByText(/Send Challenge/);
    expect(sendBtn.closest("button")).toBeDisabled();
  });

  it("unverified user bounced from challenge route to lobby", async () => {
    // renderLobby uses authedUser (emailVerified: false)
    await renderLobby([]);

    // The /challenge route requires emailVerified — unverified users are
    // redirected back to /lobby by the route guard in App.tsx.
    const challengeBtn = await screen.findByText(/Challenge Someone/);
    await userEvent.click(challengeBtn);

    // Should stay on lobby, not reach the challenge screen
    await waitFor(() => {
      expect(screen.getByText("Your Games")).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText("their_handle")).not.toBeInTheDocument();
    expect(games.refs.createGame).not.toHaveBeenCalled();
  });

  it("challenge back button returns to lobby", async () => {
    await renderVerifiedLobby([]);

    await goToChallenge();
    expect(await screen.findByText("Challenge")).toBeInTheDocument();

    await userEvent.click(screen.getByText("← Back"));

    await waitFor(() => {
      expect(screen.getByText("Your Games")).toBeInTheDocument();
    });
  });

  it("challenge screen shows error when createGame fails", async () => {
    users.refs.getUidByUsername.mockResolvedValueOnce("u2");
    games.refs.createGame.mockRejectedValueOnce(new Error("Network error"));
    await renderVerifiedLobby([]);

    await goToChallenge();

    const input = await screen.findByPlaceholderText("their_handle");
    await userEvent.type(input, "rival");
    await userEvent.click(screen.getByRole("button", { name: /send challenge/i }));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("challenge shows validation error for short username on submit", async () => {
    await renderVerifiedLobby([]);
    await goToChallenge();

    const input = await screen.findByPlaceholderText("their_handle");
    await userEvent.type(input, "ab");

    // Submit via form to bypass button disabled state
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await waitFor(() => {
      expect(screen.getByText("Enter a valid username")).toBeInTheDocument();
    });
  });

  it("challenge shows fallback error when onSend throws non-Error", async () => {
    users.refs.getUidByUsername.mockResolvedValueOnce("u2");
    games.refs.createGame.mockRejectedValueOnce("string error");
    await renderVerifiedLobby([]);

    await goToChallenge();
    await userEvent.type(await screen.findByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText("Could not start game")).toBeInTheDocument();
    });
  });

  it("challenge error banner can be dismissed", async () => {
    await renderVerifiedLobby([]);
    await goToChallenge();

    const input = await screen.findByPlaceholderText("their_handle");
    await userEvent.type(input, "sk8r");
    await userEvent.click(screen.getByText(/Send Challenge/));

    expect(screen.getByText("You can't challenge yourself")).toBeInTheDocument();

    await userEvent.click(screen.getByText("×"));
    expect(screen.queryByText("You can't challenge yourself")).not.toBeInTheDocument();
  });

  it("challenge input is locked during loading", async () => {
    users.refs.getUidByUsername.mockImplementation(() => new Promise(() => {})); // hang
    await renderVerifiedLobby([]);

    await goToChallenge();

    const input = await screen.findByPlaceholderText("their_handle");
    await userEvent.type(input, "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    // Loading state — button shows "Finding..."
    await waitFor(() => {
      expect(screen.getByText("Finding...")).toBeInTheDocument();
    });
  });
});
