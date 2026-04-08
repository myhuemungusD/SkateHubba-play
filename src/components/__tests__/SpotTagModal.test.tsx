import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../services/spots", () => ({
  getAllSpots: vi.fn(),
  createSpot: vi.fn(),
  tagGameWithSpot: vi.fn(),
}));

import { getAllSpots, tagGameWithSpot } from "../../services/spots";

const mockGetAllSpots = getAllSpots as ReturnType<typeof vi.fn>;
const mockTagGameWithSpot = tagGameWithSpot as ReturnType<typeof vi.fn>;

const profile = { uid: "u1", username: "sk8r", stance: "regular", emailVerified: true, createdAt: null };

beforeEach(() => vi.clearAllMocks());

describe("SpotTagModal", () => {
  it("renders and shows existing spots", async () => {
    mockGetAllSpots.mockResolvedValue([
      {
        id: "s1",
        name: "Hollywood High 16",
        latitude: 34.1,
        longitude: -118.3,
        createdByUid: "u2",
        createdByUsername: "rival",
        createdAt: null,
        gameCount: 5,
      },
    ]);

    const { SpotTagModal } = await import("../SpotTagModal");

    render(<SpotTagModal gameId="g1" profile={profile} onClose={vi.fn()} onTagged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Hollywood High 16")).toBeInTheDocument();
    });

    expect(screen.getByText("Tag This Spot")).toBeInTheDocument();
    expect(screen.getByText("5 games")).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", async () => {
    mockGetAllSpots.mockResolvedValue([]);
    const onClose = vi.fn();

    const { SpotTagModal } = await import("../SpotTagModal");

    render(<SpotTagModal gameId="g1" profile={profile} onClose={onClose} onTagged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Close")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("tags a game when a spot is selected", async () => {
    mockGetAllSpots.mockResolvedValue([
      {
        id: "s1",
        name: "Hollywood High",
        latitude: 34.1,
        longitude: -118.3,
        createdByUid: "u2",
        createdByUsername: "rival",
        createdAt: null,
        gameCount: 3,
      },
    ]);
    mockTagGameWithSpot.mockResolvedValue(undefined);
    const onTagged = vi.fn();

    const { SpotTagModal } = await import("../SpotTagModal");

    render(<SpotTagModal gameId="g1" profile={profile} onClose={vi.fn()} onTagged={onTagged} />);

    await waitFor(() => {
      expect(screen.getByText("Hollywood High")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Hollywood High"));

    await waitFor(() => {
      expect(mockTagGameWithSpot).toHaveBeenCalledWith("g1", "s1", "u1");
      expect(onTagged).toHaveBeenCalledWith("Hollywood High");
    });
  });

  it("shows create new spot form", async () => {
    mockGetAllSpots.mockResolvedValue([]);

    const { SpotTagModal } = await import("../SpotTagModal");

    render(<SpotTagModal gameId="g1" profile={profile} onClose={vi.fn()} onTagged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("+ Create New Spot")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("+ Create New Spot"));

    expect(screen.getByText("Create & Tag")).toBeInTheDocument();
  });

  it("filters spots by search", async () => {
    mockGetAllSpots.mockResolvedValue([
      {
        id: "s1",
        name: "Hollywood High",
        latitude: 34.1,
        longitude: -118.3,
        createdByUid: "u2",
        createdByUsername: "rival",
        createdAt: null,
        gameCount: 3,
      },
      {
        id: "s2",
        name: "Staples Center",
        latitude: 34.0,
        longitude: -118.2,
        createdByUid: "u2",
        createdByUsername: "rival",
        createdAt: null,
        gameCount: 1,
      },
    ]);

    const { SpotTagModal } = await import("../SpotTagModal");

    render(<SpotTagModal gameId="g1" profile={profile} onClose={vi.fn()} onTagged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Hollywood High")).toBeInTheDocument();
      expect(screen.getByText("Staples Center")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByPlaceholderText("Search by name..."), "Holly");

    expect(screen.getByText("Hollywood High")).toBeInTheDocument();
    expect(screen.queryByText("Staples Center")).not.toBeInTheDocument();
  });
});
