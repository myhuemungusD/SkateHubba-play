import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerProfileScreen } from "../PlayerProfileScreen";
import { opponentProfile, buildCompletedGame, buildBaseProps, fetchedState } from "./playerProfile.test-helpers";

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
  analytics: { profileViewed: vi.fn(), profileStatTileTapped: vi.fn() },
}));

vi.mock("../../utils/helpers", () => ({
  isFirebaseStorageUrl: (u: string) => u?.startsWith("https://firebasestorage.googleapis.com"),
  LETTERS: ["S", "K", "A", "T", "E"] as const,
}));

vi.mock("../../services/blocking", () => ({
  blockUser: vi.fn().mockResolvedValue(undefined),
  unblockUser: vi.fn().mockResolvedValue(undefined),
  isUserBlocked: vi.fn().mockResolvedValue(false),
  getBlockedUserIds: vi.fn().mockResolvedValue(new Set()),
}));

const mockUsePlayerProfile = vi.fn();

vi.mock("../../hooks/usePlayerProfile", () => ({
  usePlayerProfile: (...args: unknown[]) => mockUsePlayerProfile(...args),
}));

const baseProps = buildBaseProps();

describe("PlayerProfileScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePlayerProfile.mockReturnValue(fetchedState());
  });

  // ── Own Profile ────────────────────────────────────

  it("renders own profile header", () => {
    render(<PlayerProfileScreen {...baseProps} />);
    expect(document.querySelector('img[src="/logonew.webp"]')).toBeInTheDocument();
    expect(screen.getByText("@viewer")).toBeInTheDocument();
    expect(screen.getByText("regular")).toBeInTheDocument();
  });

  it("shows 0 stats when no games", () => {
    render(<PlayerProfileScreen {...baseProps} />);
    expect(screen.getByText("Lifetime Wins")).toBeInTheDocument();
    expect(screen.getByText("Lifetime Losses")).toBeInTheDocument();
    expect(screen.getByText("Win Rate %")).toBeInTheDocument();
  });

  it("shows empty game history message for own profile", () => {
    render(<PlayerProfileScreen {...baseProps} />);
    expect(screen.getByText("No games played yet")).toBeInTheDocument();
  });

  it("renders completed games with correct stats", () => {
    const games = [
      buildCompletedGame({ id: "g1", winner: "me", p1Letters: 0, p2Letters: 5 }),
      buildCompletedGame({ id: "g2", winner: "u2", p1Letters: 5, p2Letters: 2, status: "complete" }),
    ];
    render(<PlayerProfileScreen {...baseProps} ownGames={games} />);
    expect(screen.getByText("GAME HISTORY")).toBeInTheDocument();
    // Should show opponent record
    expect(screen.getByText("@sk8rboi")).toBeInTheDocument();
  });

  it("calls onBack when Back button is clicked", async () => {
    render(<PlayerProfileScreen {...baseProps} />);
    await userEvent.click(screen.getByLabelText("Back to lobby"));
    expect(baseProps.onBack).toHaveBeenCalled();
  });

  it("expands game card on click", async () => {
    const games = [buildCompletedGame()];
    render(<PlayerProfileScreen {...baseProps} ownGames={games} />);
    await userEvent.click(screen.getByText(/vs @sk8rboi/));
    expect(screen.getByText("View Full Recap")).toBeInTheDocument();
  });

  it("collapses expanded game card on second click", async () => {
    const games = [buildCompletedGame()];
    render(<PlayerProfileScreen {...baseProps} ownGames={games} />);

    await userEvent.click(screen.getByText(/vs @sk8rboi/));
    expect(screen.getByText("View Full Recap")).toBeInTheDocument();

    await userEvent.click(screen.getByText(/vs @sk8rboi/));
    expect(screen.queryByText("View Full Recap")).not.toBeInTheDocument();
  });

  // ── Other Player Profile ───────────────────────────

  it("shows loading state for other player", () => {
    mockUsePlayerProfile.mockReturnValue(fetchedState({ loading: true }));
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    // Loading UX is a content-matching skeleton announced via role="status" +
    // aria-busy so assistive tech picks it up while sighted users see the
    // shimmering placeholders instead of a raw spinner.
    const status = screen.getByRole("status", { name: /loading player profile/i });
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute("aria-busy", "true");
  });

  it("shows error state when profile fails to load", () => {
    mockUsePlayerProfile.mockReturnValue(fetchedState({ error: "Could not load player profile" }));
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.getByText("Could not load player profile")).toBeInTheDocument();
  });

  it("shows Player not found when profile is null", () => {
    mockUsePlayerProfile.mockReturnValue(fetchedState());
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.getByText("Player not found")).toBeInTheDocument();
  });

  it("renders other player's profile with correct header", () => {
    mockUsePlayerProfile.mockReturnValue(fetchedState({ profile: opponentProfile, games: [buildCompletedGame()] }));
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(document.querySelector('img[src="/logonew.webp"]')).toBeInTheDocument();
    expect(screen.getByText("@sk8rboi")).toBeInTheDocument();
  });

  it("shows Challenge button for other players", async () => {
    const onChallenge = vi.fn();
    mockUsePlayerProfile.mockReturnValue(fetchedState({ profile: opponentProfile }));
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} onChallenge={onChallenge} />);
    await userEvent.click(screen.getByText("Challenge @sk8rboi"));
    expect(onChallenge).toHaveBeenCalledWith("u2", "sk8rboi");
  });

  it("shows VS YOU stats when viewing other player with shared games", () => {
    mockUsePlayerProfile.mockReturnValue(fetchedState({ profile: opponentProfile, games: [buildCompletedGame()] }));
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.getByText("VS YOU")).toBeInTheDocument();
    expect(screen.getByText("Your Wins")).toBeInTheDocument();
    expect(screen.getByText("Your Losses")).toBeInTheDocument();
  });

  it("shows empty state message for other player with no shared games", () => {
    mockUsePlayerProfile.mockReturnValue(fetchedState({ profile: opponentProfile }));
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.getByText("No games between you two yet")).toBeInTheDocument();
  });

  it("shows forfeit game card with correct label", async () => {
    const games = [buildCompletedGame({ id: "g1", status: "forfeit", winner: "me" })];
    render(<PlayerProfileScreen {...baseProps} ownGames={games} />);
    expect(screen.getByText("forfeit")).toBeInTheDocument();
  });

  it("shows game with no turns displays forfeit message in expanded view", async () => {
    const games = [buildCompletedGame({ id: "g1", status: "forfeit", winner: "me", turnHistory: [] })];
    render(<PlayerProfileScreen {...baseProps} ownGames={games} />);
    await userEvent.click(screen.getByText(/vs @sk8rboi/));
    expect(screen.getByText("Game ended by forfeit — no clips recorded")).toBeInTheDocument();
  });

  it("calls onOpenGame when View Full Recap is clicked", async () => {
    const games = [buildCompletedGame()];
    const onOpenGame = vi.fn();
    render(<PlayerProfileScreen {...baseProps} ownGames={games} onOpenGame={onOpenGame} />);
    await userEvent.click(screen.getByText(/vs @sk8rboi/));
    await userEvent.click(screen.getByText("View Full Recap"));
    expect(onOpenGame).toHaveBeenCalledWith(games[0]);
  });

  it("shows opponent H2H records with tappable navigation", async () => {
    const onViewPlayer = vi.fn();
    const games = [buildCompletedGame()];
    mockUsePlayerProfile.mockReturnValue(fetchedState({ profile: opponentProfile, games }));
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} onViewPlayer={onViewPlayer} />);
    // The H2H list should show the viewer (me) as an opponent
    expect(screen.getByText("HEAD TO HEAD")).toBeInTheDocument();
  });

  // ── Block / Unblock flow ────────────────────────────

  it("opens block confirmation and cancels it", async () => {
    mockUsePlayerProfile.mockReturnValue(fetchedState({ profile: opponentProfile }));
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} blockedUids={new Set()} />);

    await userEvent.click(screen.getByText("Block this player"));
    expect(screen.getByText(/Block @sk8rboi\?/)).toBeInTheDocument();

    await userEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("Block this player")).toBeInTheDocument();
  });

  it("confirms block and calls blockUser", async () => {
    const { blockUser } = await import("../../services/blocking");
    mockUsePlayerProfile.mockReturnValue(fetchedState({ profile: opponentProfile }));
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} blockedUids={new Set()} />);

    await userEvent.click(screen.getByText("Block this player"));
    await userEvent.click(screen.getByRole("button", { name: "Block" }));

    await waitFor(() => {
      expect(blockUser).toHaveBeenCalledWith("me", "u2");
    });
  });

  it("shows blocked banner and unblocks via Unblock button", async () => {
    const { unblockUser } = await import("../../services/blocking");
    mockUsePlayerProfile.mockReturnValue(fetchedState({ profile: opponentProfile }));
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} blockedUids={new Set(["u2"])} />);

    expect(screen.getByText("You have blocked this user")).toBeInTheDocument();
    // Challenge button should be hidden when blocked
    expect(screen.queryByText("Challenge @sk8rboi")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Unblock"));
    await waitFor(() => {
      expect(unblockUser).toHaveBeenCalledWith("me", "u2");
    });
  });

  // ── H2H tap navigation (line 446) ───────────────────

  it("calls onViewPlayer when tapping a tappable H2H opponent on own profile", async () => {
    const onViewPlayer = vi.fn();
    const games = [buildCompletedGame()];
    render(<PlayerProfileScreen {...baseProps} ownGames={games} onViewPlayer={onViewPlayer} />);
    // The OPPONENTS list renders sk8rboi as a tappable button — find it via
    // the unique "1 game" sibling text and walk up to the enclosing button.
    const h2hRow = screen.getByText("1 game").closest("button");
    expect(h2hRow).not.toBeNull();
    await userEvent.click(h2hRow!);
    expect(onViewPlayer).toHaveBeenCalledWith("u2");
  });

  // ── handleShareGame (lines 593–627) ─────────────────

  describe("Share Game", () => {
    afterEach(() => {
      Object.defineProperty(navigator, "share", { value: undefined, writable: true, configurable: true });
    });

    it("uses navigator.share when available", async () => {
      const shareFn = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "share", { value: shareFn, writable: true, configurable: true });

      const games = [buildCompletedGame()];
      render(<PlayerProfileScreen {...baseProps} ownGames={games} />);
      await userEvent.click(screen.getByText(/vs @sk8rboi/));
      await userEvent.click(screen.getByText("Share Game"));

      await waitFor(() => {
        expect(shareFn).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Kickflip") }));
      });
    });

    it("falls back to clipboard when navigator.share rejects", async () => {
      const shareFn = vi.fn().mockRejectedValue(new Error("cancelled"));
      Object.defineProperty(navigator, "share", { value: shareFn, writable: true, configurable: true });
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      const games = [buildCompletedGame()];
      render(<PlayerProfileScreen {...baseProps} ownGames={games} />);
      await userEvent.click(screen.getByText(/vs @sk8rboi/));
      await userEvent.click(screen.getByText("Share Game"));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(expect.stringContaining("SkateHubba Game Recap"));
      });
      await waitFor(() => expect(screen.getByText("Copied!")).toBeInTheDocument());
    });

    it("falls back to clipboard when navigator.share is undefined", async () => {
      Object.defineProperty(navigator, "share", { value: undefined, writable: true, configurable: true });
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      const games = [
        buildCompletedGame({
          id: "g1",
          status: "forfeit",
          winner: "u2",
          p1Letters: 0,
          p2Letters: 0,
          turnHistory: [
            {
              turnNumber: 1,
              trickName: "Heelflip",
              setterUid: "me",
              setterUsername: "viewer",
              matcherUid: "u2",
              matcherUsername: "sk8rboi",
              setVideoUrl: "",
              matchVideoUrl: "",
              landed: false,
              letterTo: "me",
            },
          ],
        }),
      ];
      render(<PlayerProfileScreen {...baseProps} ownGames={games} />);
      await userEvent.click(screen.getByText(/vs @sk8rboi/));
      await userEvent.click(screen.getByText("Share Game"));

      await waitFor(() => {
        // forfeit branch + missed-trick branch
        expect(writeText).toHaveBeenCalledWith(expect.stringContaining("wins by forfeit"));
      });
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("missed"));
    });
  });
});
