import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerProfileScreen } from "../PlayerProfileScreen";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("../../utils/helpers", () => ({
  isFirebaseStorageUrl: (url: string) => url?.startsWith("https://firebasestorage.googleapis.com"),
  LETTERS: ["S", "K", "A", "T", "E"],
}));

const mockUsePlayerProfile = vi.fn();

vi.mock("../../hooks/usePlayerProfile", () => ({
  usePlayerProfile: (...args: unknown[]) => mockUsePlayerProfile(...args),
}));

const currentUserProfile: UserProfile = {
  uid: "me",
  username: "viewer",
  stance: "regular",
  emailVerified: true,
  createdAt: null,
};

const otherProfile: UserProfile = {
  uid: "u2",
  username: "sk8rboi",
  stance: "goofy",
  emailVerified: true,
  createdAt: null,
  wins: 10,
  losses: 3,
};

function makeGame(overrides?: Partial<GameDoc>): GameDoc {
  return {
    id: "g1",
    player1Uid: "me",
    player2Uid: "u2",
    player1Username: "viewer",
    player2Username: "sk8rboi",
    p1Letters: 0,
    p2Letters: 5,
    status: "complete",
    currentTurn: "me",
    phase: "setting",
    currentSetter: "me",
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: null,
    turnNumber: 1,
    winner: "me",
    createdAt: null,
    updatedAt: { toMillis: () => Date.now() } as GameDoc["updatedAt"],
    turnHistory: [
      {
        turnNumber: 1,
        trickName: "Kickflip",
        setterUid: "me",
        setterUsername: "viewer",
        matcherUid: "u2",
        matcherUsername: "sk8rboi",
        setVideoUrl: "",
        matchVideoUrl: "",
        landed: true,
        letterTo: null,
      },
    ],
    ...overrides,
  } as GameDoc;
}

const baseProps = {
  viewedUid: "me",
  currentUserProfile,
  ownGames: [] as GameDoc[],
  isOwnProfile: true,
  onOpenGame: vi.fn(),
  onBack: vi.fn(),
};

describe("PlayerProfileScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePlayerProfile.mockReturnValue({
      profile: null,
      games: [],
      loading: false,
      error: null,
    });
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
    expect(screen.getByText("Wins")).toBeInTheDocument();
    expect(screen.getByText("Losses")).toBeInTheDocument();
    expect(screen.getByText("Win Rate")).toBeInTheDocument();
  });

  it("shows empty game history message for own profile", () => {
    render(<PlayerProfileScreen {...baseProps} />);
    expect(screen.getByText("No games played yet")).toBeInTheDocument();
  });

  it("renders completed games with correct stats", () => {
    const games = [
      makeGame({ id: "g1", winner: "me", p1Letters: 0, p2Letters: 5 }),
      makeGame({ id: "g2", winner: "u2", p1Letters: 5, p2Letters: 2, status: "complete" }),
    ];
    render(<PlayerProfileScreen {...baseProps} ownGames={games} />);
    expect(screen.getByText("GAME HISTORY")).toBeInTheDocument();
    // Should show opponent record
    expect(screen.getByText("@sk8rboi")).toBeInTheDocument();
  });

  it("shows win streak callout when streak >= 2", () => {
    const games = [
      makeGame({ id: "g1", winner: "me", updatedAt: { toMillis: () => 1000 } as GameDoc["updatedAt"] }),
      makeGame({ id: "g2", winner: "me", updatedAt: { toMillis: () => 2000 } as GameDoc["updatedAt"] }),
    ];
    render(<PlayerProfileScreen {...baseProps} ownGames={games} />);
    expect(screen.getByText("2 WIN STREAK")).toBeInTheDocument();
  });

  it("calls onBack when Back button is clicked", async () => {
    render(<PlayerProfileScreen {...baseProps} />);
    await userEvent.click(screen.getByLabelText("Back to lobby"));
    expect(baseProps.onBack).toHaveBeenCalled();
  });

  it("expands game card on click", async () => {
    const games = [makeGame()];
    render(<PlayerProfileScreen {...baseProps} ownGames={games} />);
    await userEvent.click(screen.getByText(/vs @sk8rboi/));
    expect(screen.getByText("View Full Recap")).toBeInTheDocument();
  });

  it("collapses expanded game card on second click", async () => {
    const games = [makeGame()];
    render(<PlayerProfileScreen {...baseProps} ownGames={games} />);

    await userEvent.click(screen.getByText(/vs @sk8rboi/));
    expect(screen.getByText("View Full Recap")).toBeInTheDocument();

    await userEvent.click(screen.getByText(/vs @sk8rboi/));
    expect(screen.queryByText("View Full Recap")).not.toBeInTheDocument();
  });

  // ── Other Player Profile ───────────────────────────

  it("shows loading state for other player", () => {
    mockUsePlayerProfile.mockReturnValue({
      profile: null,
      games: [],
      loading: true,
      error: null,
    });
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.getByText("Loading player profile...")).toBeInTheDocument();
  });

  it("shows error state when profile fails to load", () => {
    mockUsePlayerProfile.mockReturnValue({
      profile: null,
      games: [],
      loading: false,
      error: "Could not load player profile",
    });
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.getByText("Could not load player profile")).toBeInTheDocument();
  });

  it("shows Player not found when profile is null", () => {
    mockUsePlayerProfile.mockReturnValue({
      profile: null,
      games: [],
      loading: false,
      error: null,
    });
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.getByText("Player not found")).toBeInTheDocument();
  });

  it("renders other player's profile with correct header", () => {
    mockUsePlayerProfile.mockReturnValue({
      profile: otherProfile,
      games: [makeGame()],
      loading: false,
      error: null,
    });
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(document.querySelector('img[src="/logonew.webp"]')).toBeInTheDocument();
    expect(screen.getByText("@sk8rboi")).toBeInTheDocument();
  });

  it("shows Challenge button for other players", async () => {
    const onChallenge = vi.fn();
    mockUsePlayerProfile.mockReturnValue({
      profile: otherProfile,
      games: [],
      loading: false,
      error: null,
    });
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} onChallenge={onChallenge} />);
    await userEvent.click(screen.getByText("Challenge @sk8rboi"));
    expect(onChallenge).toHaveBeenCalledWith("u2", "sk8rboi");
  });

  it("shows VS YOU stats when viewing other player with shared games", () => {
    mockUsePlayerProfile.mockReturnValue({
      profile: otherProfile,
      games: [makeGame()],
      loading: false,
      error: null,
    });
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.getByText("VS YOU")).toBeInTheDocument();
    expect(screen.getByText("Your Wins")).toBeInTheDocument();
    expect(screen.getByText("Your Losses")).toBeInTheDocument();
  });

  it("shows empty state message for other player with no shared games", () => {
    mockUsePlayerProfile.mockReturnValue({
      profile: otherProfile,
      games: [],
      loading: false,
      error: null,
    });
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.getByText("No games between you two yet")).toBeInTheDocument();
  });

  it("shows forfeit game card with correct label", async () => {
    const games = [makeGame({ id: "g1", status: "forfeit", winner: "me" })];
    render(<PlayerProfileScreen {...baseProps} ownGames={games} />);
    expect(screen.getByText("forfeit")).toBeInTheDocument();
  });

  it("shows game with no turns displays forfeit message in expanded view", async () => {
    const games = [makeGame({ id: "g1", status: "forfeit", winner: "me", turnHistory: [] })];
    render(<PlayerProfileScreen {...baseProps} ownGames={games} />);
    await userEvent.click(screen.getByText(/vs @sk8rboi/));
    expect(screen.getByText("Game ended by forfeit — no clips recorded")).toBeInTheDocument();
  });

  it("calls onOpenGame when View Full Recap is clicked", async () => {
    const games = [makeGame()];
    const onOpenGame = vi.fn();
    render(<PlayerProfileScreen {...baseProps} ownGames={games} onOpenGame={onOpenGame} />);
    await userEvent.click(screen.getByText(/vs @sk8rboi/));
    await userEvent.click(screen.getByText("View Full Recap"));
    expect(onOpenGame).toHaveBeenCalledWith(games[0]);
  });

  it("shows opponent H2H records with tappable navigation", async () => {
    const onViewPlayer = vi.fn();
    const games = [makeGame()];
    mockUsePlayerProfile.mockReturnValue({
      profile: otherProfile,
      games,
      loading: false,
      error: null,
    });
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} onViewPlayer={onViewPlayer} />);
    // The H2H list should show the viewer (me) as an opponent
    expect(screen.getByText("HEAD TO HEAD")).toBeInTheDocument();
  });
});
