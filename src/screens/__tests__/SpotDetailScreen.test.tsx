import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../../services/spots", () => ({
  getSpotById: vi.fn(),
  fetchSpotGames: vi.fn(),
}));

import { getSpotById, fetchSpotGames } from "../../services/spots";

const mockGetSpotById = getSpotById as ReturnType<typeof vi.fn>;
const mockFetchSpotGames = fetchSpotGames as ReturnType<typeof vi.fn>;

const profile = { uid: "u1", username: "sk8r", stance: "regular", emailVerified: true, createdAt: null };

beforeEach(() => vi.clearAllMocks());

describe("SpotDetailScreen", () => {
  it("renders spot details after loading", async () => {
    mockGetSpotById.mockResolvedValue({
      id: "spot1",
      name: "Hollywood High 16",
      latitude: 34.1,
      longitude: -118.3,
      createdByUid: "u1",
      createdByUsername: "sk8r",
      createdAt: null,
      gameCount: 5,
    });
    mockFetchSpotGames.mockResolvedValue([]);

    const { SpotDetailScreen } = await import("../SpotDetailScreen");

    render(<SpotDetailScreen spotId="spot1" profile={profile} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByText("Hollywood High 16")).toHaveLength(2); // header + card
    });

    expect(screen.getByText("5 games played here")).toBeInTheDocument();
    expect(screen.getByText("No games tagged here yet")).toBeInTheDocument();
  });

  it("shows error when spot not found", async () => {
    mockGetSpotById.mockResolvedValue(null);
    mockFetchSpotGames.mockResolvedValue([]);

    const { SpotDetailScreen } = await import("../SpotDetailScreen");

    render(<SpotDetailScreen spotId="missing" profile={profile} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Spot Not Found")).toBeInTheDocument();
    });
  });

  it("renders games list when games exist at spot", async () => {
    mockGetSpotById.mockResolvedValue({
      id: "spot1",
      name: "Hollywood",
      latitude: 34.1,
      longitude: -118.3,
      createdByUid: "u2",
      createdByUsername: "rival",
      createdAt: null,
      gameCount: 1,
    });
    mockFetchSpotGames.mockResolvedValue([
      {
        id: "g1",
        player1Uid: "u1",
        player2Uid: "u2",
        player1Username: "sk8r",
        player2Username: "rival",
        status: "complete",
        winner: "u1",
      },
    ]);

    const { SpotDetailScreen } = await import("../SpotDetailScreen");

    render(<SpotDetailScreen spotId="spot1" profile={profile} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("You won")).toBeInTheDocument();
    });
  });
});
