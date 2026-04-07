import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Leaderboard } from "../Leaderboard";

const mockGetLeaderboard = vi.fn();

vi.mock("../../services/users", () => ({
  getLeaderboard: (...args: unknown[]) => mockGetLeaderboard(...args),
}));
vi.mock("../../services/blocking", () => ({
  getBlockedUserIds: vi.fn().mockResolvedValue(new Set()),
}));

const players = [
  { uid: "u1", username: "alice", stance: "regular", createdAt: null, emailVerified: true, wins: 10, losses: 2 },
  { uid: "u2", username: "bob", stance: "goofy", createdAt: null, emailVerified: true, wins: 8, losses: 4 },
  { uid: "u3", username: "carol", stance: "regular", createdAt: null, emailVerified: true, wins: 0, losses: 0 },
];

describe("Leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockGetLeaderboard.mockReturnValue(new Promise(() => {}));
    render(<Leaderboard currentUserUid="u1" />);
    expect(screen.getByText("Loading leaderboard...")).toBeInTheDocument();
  });

  it("renders ranked players after loading", async () => {
    mockGetLeaderboard.mockResolvedValue(players);
    render(<Leaderboard currentUserUid="u1" />);

    await waitFor(() => {
      expect(screen.getByText("@alice")).toBeInTheDocument();
    });
    expect(screen.getByText("@bob")).toBeInTheDocument();
    // carol has 0 games, should be filtered out
    expect(screen.queryByText("@carol")).not.toBeInTheDocument();
  });

  it("highlights current user with YOU badge", async () => {
    mockGetLeaderboard.mockResolvedValue(players);
    render(<Leaderboard currentUserUid="u1" />);

    await waitFor(() => {
      expect(screen.getByText("YOU")).toBeInTheDocument();
    });
  });

  it("shows win/loss stats", async () => {
    mockGetLeaderboard.mockResolvedValue(players);
    render(<Leaderboard currentUserUid="u1" />);

    await waitFor(() => {
      expect(screen.getByText("10W")).toBeInTheDocument();
      expect(screen.getByText("2L")).toBeInTheDocument();
      expect(screen.getByText("83%")).toBeInTheDocument();
    });
  });

  it("shows error and retry on failure", async () => {
    mockGetLeaderboard.mockRejectedValue(new Error("network"));
    render(<Leaderboard currentUserUid="u1" />);

    await waitFor(() => {
      expect(screen.getByText("Could not load leaderboard")).toBeInTheDocument();
    });

    // Retry
    mockGetLeaderboard.mockResolvedValue(players);
    await userEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(screen.getByText("@alice")).toBeInTheDocument();
    });
  });

  it("shows empty state when no ranked players", async () => {
    mockGetLeaderboard.mockResolvedValue([
      { uid: "u3", username: "carol", stance: "regular", createdAt: null, emailVerified: true, wins: 0, losses: 0 },
    ]);
    render(<Leaderboard currentUserUid="u3" />);

    await waitFor(() => {
      expect(screen.getByText("No ranked players yet")).toBeInTheDocument();
    });
  });

  it("shows challenge button when onChallengeUser is provided", async () => {
    mockGetLeaderboard.mockResolvedValue(players);
    const onChallenge = vi.fn();
    render(<Leaderboard currentUserUid="u1" onChallengeUser={onChallenge} />);

    await waitFor(() => {
      expect(screen.getByText("@bob")).toBeInTheDocument();
    });

    // Should not show challenge for self
    const challengeButtons = screen.getAllByText(/Challenge/);
    expect(challengeButtons).toHaveLength(1); // only for bob, not for alice (self)

    await userEvent.click(challengeButtons[0]);
    expect(onChallenge).toHaveBeenCalledWith("bob");
  });
});
