import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Timestamp } from "firebase/firestore";
import { Lobby } from "../Lobby";
import { NotificationProvider } from "../../context/NotificationContext";
import type { ReactNode } from "react";

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

vi.mock("../../services/users", () => ({
  getPlayerDirectory: vi.fn(),
}));
vi.mock("../../services/blocking", () => ({
  getBlockedUserIds: vi.fn().mockResolvedValue(new Set()),
  // useBlockedUsers (used transitively by the embedded ClipsFeed) calls
  // subscribeToBlockedUsers; return a no-op unsubscribe so the hook is happy.
  subscribeToBlockedUsers: vi.fn(() => () => {}),
}));
// ClipsFeed (embedded in Lobby) calls fetchRandomLandedClips +
// fetchClipUpvoteState + upvoteClip. The feed has its own test file — here
// we just keep it from hitting Firebase. (fetchClipsFeed is kept on the
// service for upcoming vote-ranking work but nothing in this harness calls
// it, so it's intentionally omitted from the mock.)
vi.mock("../../services/clips", () => ({
  fetchRandomLandedClips: vi.fn().mockResolvedValue([]),
  fetchClipUpvoteState: vi.fn().mockResolvedValue(new Map()),
  upvoteClip: vi.fn().mockResolvedValue(0),
  AlreadyUpvotedError: class extends Error {},
}));

import { getPlayerDirectory } from "../../services/users";

const mockGetPlayerDirectory = getPlayerDirectory as ReturnType<typeof vi.fn>;

const profile = { uid: "u1", username: "sk8r", stance: "regular", emailVerified: true, createdAt: null };

function makeGame(overrides: Record<string, unknown> = {}) {
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
    turnDeadline: { toMillis: () => Date.now() + 86400000 },
    turnNumber: 1,
    winner: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  } as any;
}

const defaultProps = {
  profile,
  games: [] as any[],
  onChallenge: vi.fn(),
  onChallengeUser: vi.fn(),
  onOpenGame: vi.fn(),
  onSignOut: vi.fn(),
  onDeleteAccount: vi.fn(),
  onViewRecord: vi.fn(),
  user: { emailVerified: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPlayerDirectory.mockResolvedValue([]);
});

describe("Lobby", () => {
  it("helper functions compute correct values", () => {
    const game = makeGame({ player1Uid: "u1", player2Uid: "u2", currentTurn: "u2", p1Letters: 1, p2Letters: 3 });
    renderWithProviders(<Lobby {...defaultProps} games={[game]} />);

    // opponent name is rival
    expect(screen.getByRole("button", { name: /vs @rival/i })).toBeInTheDocument();
    // not my turn → phase-specific waiting text
    expect(screen.getByText("They're setting a trick")).toBeInTheDocument();
  });

  it("shows completed game with You won/lost labels", () => {
    const won = makeGame({ status: "complete", winner: "u1" });
    const lost = makeGame({ id: "g2", status: "complete", winner: "u2", player2Username: "winner" });
    renderWithProviders(<Lobby {...defaultProps} games={[won, lost]} />);

    expect(screen.getByText("You won")).toBeInTheDocument();
    expect(screen.getByText("You lost")).toBeInTheDocument();
  });

  it("shows forfeit label on forfeit game", () => {
    const game = makeGame({ status: "forfeit", winner: "u1" });
    renderWithProviders(<Lobby {...defaultProps} games={[game]} />);

    expect(screen.getByText(/forfeit/)).toBeInTheDocument();
  });

  it("delete modal overlay click closes modal", async () => {
    renderWithProviders(<Lobby {...defaultProps} />);

    await userEvent.click(screen.getByText("Delete Account"));
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();

    // Click the overlay
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Delete Account?")).not.toBeInTheDocument();
    });
  });

  it("delete modal Escape key closes modal", async () => {
    renderWithProviders(<Lobby {...defaultProps} />);

    await userEvent.click(screen.getByText("Delete Account"));
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Delete Account?")).not.toBeInTheDocument();
    });
  });

  it("delete modal does not close during deleting", async () => {
    defaultProps.onDeleteAccount.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<Lobby {...defaultProps} />);

    await userEvent.click(screen.getByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Deleting...")).toBeInTheDocument();
    });

    // Try clicking overlay — should NOT close
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(screen.getByText("Delete Account?")).toBeInTheDocument();

    // Try Escape — should NOT close
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(screen.getByText("Delete Account?")).toBeInTheDocument();
  });

  it("active game card keyboard Enter opens game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame();
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    const card = screen.getByRole("button", { name: /vs @rival/i });
    card.focus();
    await userEvent.keyboard("{Enter}");

    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("active game card keyboard Space opens game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame();
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    const card = screen.getByRole("button", { name: /vs @rival/i });
    card.focus();
    await userEvent.keyboard(" ");

    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("completed game card keyboard Enter opens game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame({ status: "complete", winner: "u1" });
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    const card = screen.getByRole("button", { name: /vs @rival/i });
    card.focus();
    await userEvent.keyboard("{Enter}");

    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("completed game card keyboard Space opens game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame({ status: "complete", winner: "u1" });
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    const card = screen.getByRole("button", { name: /vs @rival/i });
    card.focus();
    await userEvent.keyboard(" ");

    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("delete error shows in modal and can be dismissed", async () => {
    defaultProps.onDeleteAccount.mockRejectedValueOnce(new Error("Delete failed"));
    renderWithProviders(<Lobby {...defaultProps} />);

    await userEvent.click(screen.getByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Delete failed")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("×"));
    expect(screen.queryByText("Delete failed")).not.toBeInTheDocument();
  });

  it("delete non-Error shows fallback message", async () => {
    defaultProps.onDeleteAccount.mockRejectedValueOnce("string error");
    renderWithProviders(<Lobby {...defaultProps} />);

    await userEvent.click(screen.getByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Deletion failed — try again")).toBeInTheDocument();
    });
  });

  it("hides Download My Data button when handler is not provided", () => {
    renderWithProviders(<Lobby {...defaultProps} />);
    expect(screen.queryByRole("button", { name: /download a copy of my data/i })).not.toBeInTheDocument();
  });

  it("invokes onDownloadData when the button is clicked", async () => {
    const onDownloadData = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<Lobby {...defaultProps} onDownloadData={onDownloadData} />);

    await userEvent.click(screen.getByRole("button", { name: /download a copy of my data/i }));

    await waitFor(() => {
      expect(onDownloadData).toHaveBeenCalledTimes(1);
    });
  });

  it("surfaces download error message", async () => {
    const onDownloadData = vi.fn().mockRejectedValueOnce(new Error("network down"));
    renderWithProviders(<Lobby {...defaultProps} onDownloadData={onDownloadData} />);

    await userEvent.click(screen.getByRole("button", { name: /download a copy of my data/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("network down");
    });
  });

  it("falls back to generic message when download error is not an Error", async () => {
    const onDownloadData = vi.fn().mockRejectedValueOnce("boom");
    renderWithProviders(<Lobby {...defaultProps} onDownloadData={onDownloadData} />);

    await userEvent.click(screen.getByRole("button", { name: /download a copy of my data/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Export failed — try again");
    });
  });

  it("ignores re-clicks while an export is in flight", async () => {
    let resolver: (() => void) | undefined;
    const onDownloadData = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolver = resolve;
        }),
    );
    renderWithProviders(<Lobby {...defaultProps} onDownloadData={onDownloadData} />);

    const btn = screen.getByRole("button", { name: /download a copy of my data/i });
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    // Second click is ignored because the button is disabled while loading.
    await userEvent.click(btn);

    resolver?.();
    await waitFor(() => expect(btn).not.toBeDisabled());

    expect(onDownloadData).toHaveBeenCalledTimes(1);
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
    renderWithProviders(<Lobby {...defaultProps} games={[game]} />);

    // opponent should be player1's username since profile is player2
    expect(screen.getByRole("button", { name: /vs @someone/i })).toBeInTheDocument();
    // my turn → phase-specific turn text
    expect(screen.getByText("Your turn to set")).toBeInTheDocument();
  });

  it("non-matching key on done game card does not open game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame({ status: "complete", winner: "u1" });
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    const card = screen.getByRole("button", { name: /vs @rival/i });
    card.focus();
    await userEvent.keyboard("a");

    expect(onOpenGame).not.toHaveBeenCalled();
  });

  it("inner modal click stops propagation", async () => {
    renderWithProviders(<Lobby {...defaultProps} />);

    await userEvent.click(screen.getByText("Delete Account"));
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();

    // Click inside the modal content (inner div) — should NOT close
    await userEvent.click(screen.getByText("Delete Account?"));

    expect(screen.getByText("Delete Account?")).toBeInTheDocument();
  });

  it("renders player directory with usernames", async () => {
    const fakePlayers = [
      {
        uid: "u2",
        username: "kickflip_king",
        stance: "Regular",
        createdAt: Timestamp.fromMillis(Date.now() - 3600000 * 2),
        emailVerified: true,
      },
      {
        uid: "u3",
        username: "heelflip_hero",
        stance: "Goofy",
        createdAt: Timestamp.fromMillis(Date.now() - 86400000 * 3),
        emailVerified: true,
      },
      {
        uid: "u4",
        username: "treflip_pro",
        stance: "Regular",
        createdAt: Timestamp.fromMillis(Date.now() - 86400000 * 10),
        emailVerified: true,
      },
    ];
    mockGetPlayerDirectory.mockResolvedValue([
      { uid: "u1", username: "sk8r", stance: "regular", createdAt: null, emailVerified: true },
      ...fakePlayers,
    ]);

    renderWithProviders(<Lobby {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("@kickflip_king")).toBeInTheDocument();
      expect(screen.getByText("@heelflip_hero")).toBeInTheDocument();
      expect(screen.getByText("@treflip_pro")).toBeInTheDocument();
    });
  });

  it("filters out current user from player directory", async () => {
    mockGetPlayerDirectory.mockResolvedValue([
      { uid: "u1", username: "sk8r", stance: "regular", createdAt: null, emailVerified: true },
      { uid: "u2", username: "other_skater", stance: "Goofy", createdAt: null, emailVerified: true },
    ]);

    renderWithProviders(<Lobby {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("@other_skater")).toBeInTheDocument();
    });

    // Current user should not appear in the player directory
    // The header shows @sk8r, but there should be no player card for sk8r
    const playerCards = screen.getAllByText("@sk8r");
    // Only the header avatar shows @sk8r, not a player card
    expect(playerCards).toHaveLength(1);
  });

  it("clicking a player name navigates to their profile", async () => {
    const onViewPlayer = vi.fn();
    mockGetPlayerDirectory.mockResolvedValue([
      { uid: "u2", username: "kickflip_king", stance: "Regular", createdAt: null, emailVerified: true },
    ]);

    renderWithProviders(<Lobby {...defaultProps} onViewPlayer={onViewPlayer} />);

    await waitFor(() => {
      expect(screen.getByText("@kickflip_king")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("@kickflip_king"));

    expect(onViewPlayer).toHaveBeenCalledWith("u2");
  });

  it("clicking challenge button triggers onChallengeUser with their username", async () => {
    const onChallengeUser = vi.fn();
    mockGetPlayerDirectory.mockResolvedValue([
      { uid: "u2", username: "kickflip_king", stance: "Regular", createdAt: null, emailVerified: true },
    ]);

    renderWithProviders(<Lobby {...defaultProps} onChallengeUser={onChallengeUser} />);

    await waitFor(() => {
      expect(screen.getByText("@kickflip_king")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Challenge @kickflip_king" }));

    expect(onChallengeUser).toHaveBeenCalledWith("kickflip_king");
  });

  it("shows loading state while fetching players", async () => {
    let resolve!: (v: unknown[]) => void;
    mockGetPlayerDirectory.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );

    renderWithProviders(<Lobby {...defaultProps} />);

    // Loading state is a content-shaped skeleton announced via
    // role="status" + aria-busy so assistive tech picks up the wait
    // while sighted users see the placeholder rows.
    const status = screen.getByRole("status", { name: /loading skaters/i });
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      resolve([]);
    });

    await waitFor(() => {
      expect(screen.queryByRole("status", { name: /loading skaters/i })).not.toBeInTheDocument();
    });
  });

  it("hides SKATERS section when no other users exist", async () => {
    mockGetPlayerDirectory.mockResolvedValue([
      { uid: "u1", username: "sk8r", stance: "regular", createdAt: null, emailVerified: true },
    ]);

    renderWithProviders(<Lobby {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByRole("status", { name: /loading skaters/i })).not.toBeInTheDocument();
    });

    expect(screen.queryByText("SKATERS")).not.toBeInTheDocument();
  });

  it("disables player challenge buttons when email not verified", async () => {
    mockGetPlayerDirectory.mockResolvedValue([
      { uid: "u2", username: "kickflip_king", stance: "Regular", createdAt: null, emailVerified: true },
    ]);

    renderWithProviders(<Lobby {...defaultProps} user={{ emailVerified: false }} />);

    await waitFor(() => {
      expect(screen.getByText("@kickflip_king")).toBeInTheDocument();
    });

    const challengeBtn = screen.getByRole("button", { name: "Challenge @kickflip_king" });
    expect(challengeBtn).toBeDisabled();
  });

  it("displays relative join dates correctly", async () => {
    const now = Date.now();
    mockGetPlayerDirectory.mockResolvedValue([
      {
        uid: "u2",
        username: "just_now",
        stance: "Regular",
        createdAt: Timestamp.fromMillis(now - 1000 * 60 * 30),
        emailVerified: true,
      },
      {
        uid: "u3",
        username: "hours_ago",
        stance: "Goofy",
        createdAt: Timestamp.fromMillis(now - 1000 * 60 * 60 * 5),
        emailVerified: true,
      },
      {
        uid: "u4",
        username: "days_ago",
        stance: "Regular",
        createdAt: Timestamp.fromMillis(now - 1000 * 60 * 60 * 24 * 3),
        emailVerified: true,
      },
    ]);

    renderWithProviders(<Lobby {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Just joined/)).toBeInTheDocument();
      expect(screen.getByText(/Joined 5h ago/)).toBeInTheDocument();
      expect(screen.getByText(/Joined 3d ago/)).toBeInTheDocument();
    });
  });

  it("handles future timestamps gracefully", async () => {
    mockGetPlayerDirectory.mockResolvedValue([
      {
        uid: "u2",
        username: "time_traveler",
        stance: "Regular",
        createdAt: Timestamp.fromMillis(Date.now() + 60000),
        emailVerified: true,
      },
    ]);

    renderWithProviders(<Lobby {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Just joined/)).toBeInTheDocument();
    });
  });

  it("handles getPlayerDirectory fetch failure gracefully", async () => {
    mockGetPlayerDirectory.mockRejectedValue(new Error("Network error"));

    renderWithProviders(<Lobby {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByRole("status", { name: /loading skaters/i })).not.toBeInTheDocument();
    });

    // No SKATERS section, no crash
    expect(screen.queryByText("SKATERS")).not.toBeInTheDocument();
  });

  it("shows player count badge with correct number", async () => {
    mockGetPlayerDirectory.mockResolvedValue([
      { uid: "u2", username: "player_one", stance: "Regular", createdAt: null, emailVerified: true },
      { uid: "u3", username: "player_two", stance: "Goofy", createdAt: null, emailVerified: true },
    ]);

    renderWithProviders(<Lobby {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("SKATERS")).toBeInTheDocument();
    });

    // Badge should show "2" (both players, current user filtered out)
    const badge = screen.getByText("SKATERS").parentElement!.querySelector(".tabular-nums")!;
    expect(badge.textContent).toBe("2");
  });

  it("header counter excludes games whose turn deadline has passed", () => {
    const liveGame = makeGame({ id: "live", turnDeadline: { toMillis: () => Date.now() + 3600_000 } });
    const expired = makeGame({ id: "exp", turnDeadline: { toMillis: () => Date.now() - 1000 } });
    renderWithProviders(<Lobby {...defaultProps} games={[liveGame, expired]} />);

    // Only the live game counts — header should say "1 active", not "2 active"
    expect(screen.getByText("1 active")).toBeInTheDocument();
  });

  it("header counter shows 'No active games' when every active game is expired", () => {
    const expired1 = makeGame({ id: "e1", turnDeadline: { toMillis: () => Date.now() - 1000 } });
    const expired2 = makeGame({
      id: "e2",
      turnDeadline: { toMillis: () => Date.now() - 5000 },
      currentTurn: "u2",
    });
    const completed = makeGame({ id: "c1", status: "complete", winner: "u1" });
    renderWithProviders(<Lobby {...defaultProps} games={[expired1, expired2, completed]} />);

    expect(screen.getByText(/No active games/)).toBeInTheDocument();
    expect(screen.getByText(/1 completed/)).toBeInTheDocument();
  });

  it("ACTIVE section badge reflects only live games", () => {
    const live = makeGame({ id: "live", turnDeadline: { toMillis: () => Date.now() + 3600_000 } });
    const expired = makeGame({ id: "exp", turnDeadline: { toMillis: () => Date.now() - 1000 } });
    renderWithProviders(<Lobby {...defaultProps} games={[live, expired]} />);

    const badge = screen.getByText("ACTIVE").parentElement!.querySelector(".tabular-nums")!;
    expect(badge.textContent).toBe("1");
  });

  // Regression: game cards must not nest an interactive element inside another.
  // The Profile sub-button used to live inside the card <button>, which is
  // invalid HTML (no interactive descendants of <button>) and relied on
  // stopPropagation to keep the card's onClick from firing on Profile clicks.
  it("active game card does not nest a button inside another button", () => {
    const game = makeGame();
    const { container } = renderWithProviders(<Lobby {...defaultProps} games={[game]} />);
    expect(container.querySelectorAll("button button").length).toBe(0);
  });

  it("completed game card does not nest a button inside another button", () => {
    const game = makeGame({ status: "complete", winner: "u1" });
    const { container } = renderWithProviders(<Lobby {...defaultProps} games={[game]} />);
    expect(container.querySelectorAll("button button").length).toBe(0);
  });

  // A held key (auto-repeat) should not re-fire navigation — matches native
  // <button> semantics and avoids stuttered double-navigation on the card.
  it("active game card ignores repeated keydown from a held key", () => {
    const onOpenGame = vi.fn();
    const game = makeGame();
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    const card = screen.getByRole("button", { name: /vs @rival/i });
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
    const game = makeGame();
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    const card = screen.getByRole("button", { name: /vs @rival/i });
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onOpenGame).toHaveBeenCalledTimes(1);
  });

  it("active game card fires Space on keyup, not on keydown alone", () => {
    const onOpenGame = vi.fn();
    const game = makeGame();
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    const card = screen.getByRole("button", { name: /vs @rival/i });
    card.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(onOpenGame).not.toHaveBeenCalled();

    card.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    expect(onOpenGame).toHaveBeenCalledTimes(1);
  });

  it("active game card cancels a primed Space when focus leaves before keyup", () => {
    const onOpenGame = vi.fn();
    const game = makeGame();
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    const card = screen.getByRole("button", { name: /vs @rival/i });
    card.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    // User tabs away or otherwise blurs the card — native buttons abort here.
    // React delegates onBlur via the bubbling `focusout` event at the root.
    card.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    card.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));

    expect(onOpenGame).not.toHaveBeenCalled();
  });

  it("Profile button on active game card opens profile without opening game", async () => {
    const onOpenGame = vi.fn();
    const onViewPlayer = vi.fn();
    const game = makeGame();
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} onViewPlayer={onViewPlayer} />);

    await userEvent.click(screen.getByRole("button", { name: /View @rival's profile/i }));

    expect(onViewPlayer).toHaveBeenCalledWith("u2");
    expect(onOpenGame).not.toHaveBeenCalled();
  });

  it("Profile button on completed game card opens profile without opening game", async () => {
    const onOpenGame = vi.fn();
    const onViewPlayer = vi.fn();
    const game = makeGame({ status: "complete", winner: "u1" });
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} onViewPlayer={onViewPlayer} />);

    await userEvent.click(screen.getByRole("button", { name: /View @rival's profile/i }));

    expect(onViewPlayer).toHaveBeenCalledWith("u2");
    expect(onOpenGame).not.toHaveBeenCalled();
  });

  it("active game card click opens game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame();
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    await userEvent.click(screen.getByRole("button", { name: /vs @rival/i }));

    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("completed game card click opens game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame({ status: "complete", winner: "u1" });
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    await userEvent.click(screen.getByRole("button", { name: /vs @rival/i }));

    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("primary Challenge Someone CTA fires onChallenge when email verified", async () => {
    const onChallenge = vi.fn();
    renderWithProviders(<Lobby {...defaultProps} onChallenge={onChallenge} />);

    await userEvent.click(screen.getByRole("button", { name: /Challenge Someone/i }));

    expect(onChallenge).toHaveBeenCalledTimes(1);
  });

  it("primary Challenge Someone CTA is disabled when email not verified", () => {
    renderWithProviders(<Lobby {...defaultProps} user={{ emailVerified: false }} />);

    expect(screen.getByRole("button", { name: /Challenge Someone/i })).toBeDisabled();
    expect(screen.getByText("Verify your email to start challenging")).toBeInTheDocument();
  });

  it("@mikewhite fallback link fires onChallengeUser", async () => {
    const onChallengeUser = vi.fn();
    renderWithProviders(<Lobby {...defaultProps} onChallengeUser={onChallengeUser} />);

    await userEvent.click(screen.getByRole("button", { name: /Challenge @mikewhite/i }));

    expect(onChallengeUser).toHaveBeenCalledWith("mikewhite");
  });

  it("@mikewhite fallback link is hidden when email not verified", () => {
    renderWithProviders(<Lobby {...defaultProps} user={{ emailVerified: false }} />);
    expect(screen.queryByRole("button", { name: /Challenge @mikewhite/i })).not.toBeInTheDocument();
  });

  it("Sign Out button fires onSignOut", async () => {
    const onSignOut = vi.fn();
    renderWithProviders(<Lobby {...defaultProps} onSignOut={onSignOut} />);

    await userEvent.click(screen.getByRole("button", { name: "Sign Out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("View my record header button fires onViewRecord", async () => {
    const onViewRecord = vi.fn();
    renderWithProviders(<Lobby {...defaultProps} onViewRecord={onViewRecord} />);

    // Accessible name comes from the `title` tooltip on the avatar/username button
    const btn = screen.getByTitle("View my record");
    await userEvent.click(btn);

    expect(onViewRecord).toHaveBeenCalledTimes(1);
  });

  it("Load More button fires onLoadMore", async () => {
    const onLoadMore = vi.fn();
    const game = makeGame();
    renderWithProviders(<Lobby {...defaultProps} games={[game]} hasMoreGames={true} onLoadMore={onLoadMore} />);

    await userEvent.click(screen.getByRole("button", { name: "Load More Games" }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("Load More button is disabled while gamesLoading", () => {
    const game = makeGame();
    renderWithProviders(<Lobby {...defaultProps} games={[game]} hasMoreGames={true} gamesLoading={true} />);
    expect(screen.getByRole("button", { name: "Loading..." })).toBeDisabled();
  });

  it("Delete Account trigger button has type='button'", () => {
    renderWithProviders(<Lobby {...defaultProps} />);
    const btn = screen.getByRole("button", { name: "Delete Account" });
    expect(btn).toHaveAttribute("type", "button");
  });

  // ── Judge/referee game card tests ──

  describe("judge-aware game cards", () => {
    const judgeProfile = { uid: "j1", username: "ref", stance: "regular", emailVerified: true, createdAt: null };
    const judgeProps = { ...defaultProps, profile: judgeProfile };

    function makeJudgeGame(overrides: Record<string, unknown> = {}) {
      return makeGame({
        player1Uid: "u1",
        player2Uid: "u2",
        player1Username: "sk8r",
        player2Username: "rival",
        judgeId: "j1",
        judgeUsername: "ref",
        judgeStatus: "accepted",
        ...overrides,
      });
    }

    it("shows REF label and both player names for judge viewer on active game", () => {
      const game = makeJudgeGame();
      renderWithProviders(<Lobby {...judgeProps} games={[game]} />);

      expect(screen.getByText(/REF/)).toBeInTheDocument();
      expect(screen.getByText(/@sk8r vs @rival/)).toBeInTheDocument();
    });

    it("shows RULE badge instead of PLAY when it is the judge's turn", () => {
      const game = makeJudgeGame({ currentTurn: "j1", phase: "disputable" });
      renderWithProviders(<Lobby {...judgeProps} games={[game]} />);

      expect(screen.getByText("RULE")).toBeInTheDocument();
      expect(screen.queryByText("PLAY")).not.toBeInTheDocument();
    });

    it("shows 'Rule: landed or missed?' for judge during disputable phase", () => {
      const game = makeJudgeGame({ currentTurn: "j1", phase: "disputable" });
      renderWithProviders(<Lobby {...judgeProps} games={[game]} />);

      expect(screen.getByText("Rule: landed or missed?")).toBeInTheDocument();
    });

    it("shows 'Rule: clean or sketchy?' for judge during setReview phase", () => {
      const game = makeJudgeGame({ currentTurn: "j1", phase: "setReview" });
      renderWithProviders(<Lobby {...judgeProps} games={[game]} />);

      expect(screen.getByText("Rule: clean or sketchy?")).toBeInTheDocument();
    });

    it("shows 'Setting a trick' for judge during setting phase", () => {
      const game = makeJudgeGame({ currentTurn: "u1", phase: "setting" });
      renderWithProviders(<Lobby {...judgeProps} games={[game]} />);

      expect(screen.getByText("Setting a trick")).toBeInTheDocument();
    });

    it("shows both players' letter scores (not You/Them) for judge viewer", () => {
      const game = makeJudgeGame({ p1Letters: 2, p2Letters: 3 });
      renderWithProviders(<Lobby {...judgeProps} games={[game]} />);

      expect(screen.getByText("@sk8r")).toBeInTheDocument();
      expect(screen.getByText("@rival")).toBeInTheDocument();
      expect(screen.queryByText("You")).not.toBeInTheDocument();
      expect(screen.queryByText("Them")).not.toBeInTheDocument();
    });

    it("shows '@winner won' for judge viewer on completed game", () => {
      const game = makeJudgeGame({ status: "complete", winner: "u1" });
      renderWithProviders(<Lobby {...judgeProps} games={[game]} />);

      expect(screen.getByText(/@sk8r won/)).toBeInTheDocument();
    });

    it("shows referee reviewing label for players during disputable phase", () => {
      const game = makeJudgeGame({ currentTurn: "j1", phase: "disputable" });
      renderWithProviders(<Lobby {...defaultProps} games={[game]} />);

      expect(screen.getByText("Referee @ref reviewing")).toBeInTheDocument();
    });

    it("hides Profile button on active judge game card (judge is not a player)", () => {
      const game = makeJudgeGame();
      renderWithProviders(<Lobby {...judgeProps} games={[game]} onViewPlayer={vi.fn()} />);

      expect(screen.queryByRole("button", { name: /View.*profile/i })).not.toBeInTheDocument();
    });
  });
});
