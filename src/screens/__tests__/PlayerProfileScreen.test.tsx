import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerProfileScreen } from "../PlayerProfileScreen";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";

const mockProfileViewed = vi.fn();
const mockProfileStatTileTapped = vi.fn();
vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
  analytics: {
    profileViewed: (...args: unknown[]) => mockProfileViewed(...args),
    profileStatTileTapped: (...args: unknown[]) => mockProfileStatTileTapped(...args),
    profileStreakBadgeDisplayed: vi.fn(),
  },
}));

vi.mock("../../utils/helpers", () => ({
  isFirebaseStorageUrl: (url: string) => url?.startsWith("https://firebasestorage.googleapis.com"),
  LETTERS: ["S", "K", "A", "T", "E"],
}));

vi.mock("../../services/blocking", () => ({
  blockUser: vi.fn().mockResolvedValue(undefined),
  unblockUser: vi.fn().mockResolvedValue(undefined),
  isUserBlocked: vi.fn().mockResolvedValue(false),
  getBlockedUserIds: vi.fn().mockResolvedValue(new Set()),
}));

// PR-A2: usePlayerProfileController calls backfillStatsIfNeeded on
// own-profile mount. Stub it out so the screen test doesn't hit the
// Firestore-imports-from-`../../services/users` code path; coverage
// for the function itself lives in users.test.ts.
vi.mock("../../services/users", async () => {
  const actual = await vi.importActual<typeof import("../../services/users")>("../../services/users");
  return {
    ...actual,
    backfillStatsIfNeeded: vi.fn().mockResolvedValue({ backfilled: false, partial: false }),
  };
});

// Force reduced-motion in screen tests so count-up animations resolve to
// the final value immediately and assertions can read them.
vi.mock("../../hooks/useReducedMotion", () => ({
  useReducedMotion: () => true,
}));

const mockUsePlayerProfile = vi.fn();

vi.mock("../../hooks/usePlayerProfile", () => ({
  usePlayerProfile: (...args: unknown[]) => mockUsePlayerProfile(...args),
}));

const currentUserProfile: UserProfile = {
  uid: "me",
  username: "viewer",
  stance: "regular",
  createdAt: null,
  gamesWon: 5,
  gamesLost: 2,
  gamesForfeited: 0,
  currentWinStreak: 0,
  longestWinStreak: 3,
  tricksLanded: 12,
  cleanJudgments: 4,
  level: 1,
};

const otherProfile: UserProfile = {
  uid: "u2",
  username: "sk8rboi",
  stance: "goofy",
  createdAt: null,
  gamesWon: 10,
  gamesLost: 3,
  gamesForfeited: 1,
  currentWinStreak: 2,
  longestWinStreak: 6,
  tricksLanded: 47,
  cleanJudgments: 8,
  level: 1,
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

/** Stub the `usePlayerProfile` hook for an opponent-profile test. Centralised
 *  so the duplication gate doesn't flag the repeated mockReturnValue blocks. */
function mockOpponentProfile(games: GameDoc[] = []) {
  mockUsePlayerProfile.mockReturnValue({
    profile: otherProfile,
    games,
    loading: false,
    error: null,
  });
}

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

  it("renders the new brag-row stats with seeded counter values", () => {
    render(<PlayerProfileScreen {...baseProps} />);
    // Counter values come straight off the profile (PR-C deletes client
    // derivation). Reduced-motion is mocked so values render final-state.
    expect(screen.getByLabelText("Lifetime wins: 5")).toBeInTheDocument();
    expect(screen.getByLabelText("Best win streak: 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Total games: 7")).toBeInTheDocument();
    expect(screen.getByLabelText("Tricks landed: 12")).toBeInTheDocument();
    expect(screen.getByLabelText("Clean judgments: 4")).toBeInTheDocument();
  });

  it("shows empty game history message for own profile", () => {
    render(<PlayerProfileScreen {...baseProps} />);
    expect(screen.getByText("No games played yet")).toBeInTheDocument();
  });

  it("renders completed games", () => {
    const games = [
      makeGame({ id: "g1", winner: "me", p1Letters: 0, p2Letters: 5 }),
      makeGame({ id: "g2", winner: "u2", p1Letters: 5, p2Letters: 2, status: "complete" }),
    ];
    render(<PlayerProfileScreen {...baseProps} ownGames={games} />);
    expect(screen.getByText("GAME HISTORY")).toBeInTheDocument();
    expect(screen.getByText("@sk8rboi")).toBeInTheDocument();
  });

  it("StreakBadge appears at the locked threshold of 3", () => {
    const profile = { ...currentUserProfile, currentWinStreak: 3 };
    render(<PlayerProfileScreen {...baseProps} currentUserProfile={profile} />);
    expect(screen.getByTestId("streak-badge")).toBeInTheDocument();
    expect(screen.getByText("3-GAME STREAK")).toBeInTheDocument();
  });

  it("StreakBadge hides below threshold 3", () => {
    const profile = { ...currentUserProfile, currentWinStreak: 2 };
    render(<PlayerProfileScreen {...baseProps} currentUserProfile={profile} />);
    expect(screen.queryByTestId("streak-badge")).not.toBeInTheDocument();
  });

  it("AchievementsRibbon placeholder renders 12 locked tiles", () => {
    render(<PlayerProfileScreen {...baseProps} />);
    expect(screen.getByTestId("achievements-ribbon")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Locked achievement")).toHaveLength(12);
  });

  it("AddedSpotsPlaceholder renders only on own profile", () => {
    render(<PlayerProfileScreen {...baseProps} />);
    expect(screen.getByTestId("added-spots-placeholder")).toBeInTheDocument();
  });

  it("Share-my-profile button only renders on own profile", () => {
    render(<PlayerProfileScreen {...baseProps} />);
    expect(screen.getByTestId("share-my-profile-button")).toBeInTheDocument();
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
    const status = screen.getByRole("status", { name: /loading player profile/i });
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute("aria-busy", "true");
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
    mockOpponentProfile([makeGame()]);
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(document.querySelector('img[src="/logonew.webp"]')).toBeInTheDocument();
    expect(screen.getByText("@sk8rboi")).toBeInTheDocument();
  });

  it("does NOT show share-my-profile button on opponent profile", () => {
    mockOpponentProfile();
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.queryByTestId("share-my-profile-button")).not.toBeInTheDocument();
  });

  it("does NOT show AddedSpotsPlaceholder on opponent profile", () => {
    mockOpponentProfile();
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.queryByTestId("added-spots-placeholder")).not.toBeInTheDocument();
  });

  it("shows Challenge button for other players", async () => {
    const onChallenge = vi.fn();
    mockOpponentProfile();
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} onChallenge={onChallenge} />);
    await userEvent.click(screen.getByText("Challenge @sk8rboi"));
    expect(onChallenge).toHaveBeenCalledWith("u2", "sk8rboi");
  });

  it("shows VS YOU stats when viewing other player with shared games", () => {
    mockOpponentProfile([makeGame()]);
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.getByText("VS YOU")).toBeInTheDocument();
    expect(screen.getByTestId("vs-you-row")).toBeInTheDocument();
  });

  it("hides the VS-You row when there are no shared games yet", () => {
    mockOpponentProfile();
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.queryByTestId("vs-you-row")).not.toBeInTheDocument();
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
    expect(screen.getByText("HEAD TO HEAD")).toBeInTheDocument();
  });

  // ── Block / Unblock flow ────────────────────────────

  it("opens block confirmation and cancels it", async () => {
    mockOpponentProfile();
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} blockedUids={new Set()} />);

    await userEvent.click(screen.getByText("Block this player"));
    expect(screen.getByText(/Block @sk8rboi\?/)).toBeInTheDocument();

    await userEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("Block this player")).toBeInTheDocument();
  });

  it("confirms block and calls blockUser", async () => {
    const { blockUser } = await import("../../services/blocking");
    mockOpponentProfile();
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} blockedUids={new Set()} />);

    await userEvent.click(screen.getByText("Block this player"));
    await userEvent.click(screen.getByRole("button", { name: "Block" }));

    await waitFor(() => {
      expect(blockUser).toHaveBeenCalledWith("me", "u2");
    });
  });

  it("shows blocked banner and unblocks via Unblock button", async () => {
    const { unblockUser } = await import("../../services/blocking");
    mockOpponentProfile();
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} blockedUids={new Set(["u2"])} />);

    expect(screen.getByText("You have blocked this user")).toBeInTheDocument();
    expect(screen.queryByText("Challenge @sk8rboi")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Unblock"));
    await waitFor(() => {
      expect(unblockUser).toHaveBeenCalledWith("me", "u2");
    });
  });

  it("calls onViewPlayer when tapping a tappable H2H opponent on own profile", async () => {
    const onViewPlayer = vi.fn();
    const games = [makeGame()];
    render(<PlayerProfileScreen {...baseProps} ownGames={games} onViewPlayer={onViewPlayer} />);
    const h2hRow = screen.getByText("1 game").closest("button");
    expect(h2hRow).not.toBeNull();
    await userEvent.click(h2hRow!);
    expect(onViewPlayer).toHaveBeenCalledWith("u2");
  });

  // ── Share-my-profile flow ──────────────────────────

  describe("Share my profile", () => {
    afterEach(() => {
      Object.defineProperty(navigator, "share", { value: undefined, writable: true, configurable: true });
    });

    /** Stubs navigator.share + navigator.clipboard.writeText, renders the
     *  screen, and clicks the share button. Returns the mocks for assertions. */
    async function clickShare(opts: {
      share?: ReturnType<typeof vi.fn>;
      clipboard?: ReturnType<typeof vi.fn>;
    }) {
      if (opts.share) {
        Object.defineProperty(navigator, "share", { value: opts.share, writable: true, configurable: true });
      } else {
        Object.defineProperty(navigator, "share", { value: undefined, writable: true, configurable: true });
      }
      if (opts.clipboard) {
        Object.assign(navigator, { clipboard: { writeText: opts.clipboard } });
      }
      render(<PlayerProfileScreen {...baseProps} />);
      await userEvent.click(screen.getByTestId("share-my-profile-button"));
    }

    it("uses navigator.share when available", async () => {
      const shareFn = vi.fn().mockResolvedValue(undefined);
      await clickShare({ share: shareFn });
      await waitFor(() => {
        expect(shareFn).toHaveBeenCalledWith(
          expect.objectContaining({ url: expect.stringContaining("/profile/me") }),
        );
      });
    });

    it("falls back to clipboard when navigator.share is undefined", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      await clickShare({ clipboard: writeText });
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/profile/me"));
      });
      await waitFor(() => expect(screen.getByText("LINK COPIED")).toBeInTheDocument());
    });

    it("falls back to clipboard when navigator.share rejects (user cancel)", async () => {
      const shareFn = vi.fn().mockRejectedValue(new Error("cancelled"));
      const writeText = vi.fn().mockResolvedValue(undefined);
      await clickShare({ share: shareFn, clipboard: writeText });
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/profile/me"));
      });
    });

    it("silently swallows the error when both share and clipboard fail", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
      await clickShare({ clipboard: writeText });
      await waitFor(() => expect(writeText).toHaveBeenCalled());
      expect(screen.queryByText("LINK COPIED")).not.toBeInTheDocument();
    });
  });

  // ── PR-C profile telemetry (plan §7.2) ─────────────

  describe("profile telemetry", () => {
    it("fires profile_viewed once on own-profile mount with isOwn=true", async () => {
      render(<PlayerProfileScreen {...baseProps} />);
      await waitFor(() => expect(mockProfileViewed).toHaveBeenCalledTimes(1));
      const [viewerUid, profileUid, isOwn, msToFirstPaint] = mockProfileViewed.mock.calls[0];
      expect(viewerUid).toBe("me");
      expect(profileUid).toBe("me");
      expect(isOwn).toBe(true);
      expect(typeof msToFirstPaint).toBe("number");
      expect(msToFirstPaint).toBeGreaterThanOrEqual(0);
    });

    it("fires profile_viewed with isOwn=false on opponent profile", async () => {
      mockOpponentProfile([makeGame()]);
      render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
      await waitFor(() => expect(mockProfileViewed).toHaveBeenCalledTimes(1));
      const [viewerUid, profileUid, isOwn] = mockProfileViewed.mock.calls[0];
      expect(viewerUid).toBe("me");
      expect(profileUid).toBe("u2");
      expect(isOwn).toBe(false);
    });

    it("fires profile_stat_tile_tapped on tile tap with stat name + profileUid", async () => {
      render(<PlayerProfileScreen {...baseProps} />);
      const tile = screen.getByTestId("stat-tile-wins");
      await userEvent.click(tile);
      expect(mockProfileStatTileTapped).toHaveBeenCalledWith("wins", "me");
    });
  });

  // ── Pull-to-refresh ────────────────────────────────

  it("attaches pull-to-refresh handlers on own profile", () => {
    const { container } = render(<PlayerProfileScreen {...baseProps} />);
    // PullToRefreshIndicator only renders when the gesture is active so we
    // can't assert on it at idle. Instead we verify the wiring by checking
    // that the outer scroll container has the bg-profile-glow class — the
    // PTR pointer handlers are attached to that element via spread props
    // (covered functionally in usePullToRefresh.test).
    const root = container.querySelector(".bg-profile-glow");
    expect(root).not.toBeNull();
  });

  // ── Share Game (preserved from pre-PR-C suite) ─────

  describe("Share Game", () => {
    afterEach(() => {
      Object.defineProperty(navigator, "share", { value: undefined, writable: true, configurable: true });
    });

    it("uses navigator.share when available", async () => {
      const shareFn = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "share", { value: shareFn, writable: true, configurable: true });

      const games = [makeGame()];
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

      const games = [makeGame()];
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
        makeGame({
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
        expect(writeText).toHaveBeenCalledWith(expect.stringContaining("wins by forfeit"));
      });
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("missed"));
    });
  });
});
