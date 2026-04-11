import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Spot, SpotComment } from "../../types/spot";

const mockGetSpot = vi.fn();
const mockGetSpotComments = vi.fn();
const mockAddSpotComment = vi.fn();
const mockUseAuthContext = vi.fn();

vi.mock("../../services/spots", () => ({
  getSpot: (...args: unknown[]) => mockGetSpot(...args),
  getSpotComments: (...args: unknown[]) => mockGetSpotComments(...args),
  addSpotComment: (...args: unknown[]) => mockAddSpotComment(...args),
}));

vi.mock("../../context/AuthContext", () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

import { SpotDetailPage } from "../SpotDetailPage";

const FIXTURE_SPOT: Spot = {
  id: "11111111-2222-3333-4444-555555555555",
  createdBy: "creator",
  name: "Test Hubba",
  description: "smooth ledge",
  latitude: 34.0522,
  longitude: -118.2437,
  gnarRating: 3,
  bustRisk: 2,
  obstacles: ["ledge"],
  photoUrls: [],
  isVerified: false,
  isActive: true,
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-10T00:00:00.000Z",
};

const FIXTURE_COMMENT: SpotComment = {
  id: "c1",
  spotId: FIXTURE_SPOT.id,
  userId: "commenter-uid",
  content: "good spot",
  createdAt: "2026-04-10T00:00:00.000Z",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/spots/${FIXTURE_SPOT.id}`]}>
      <Routes>
        <Route path="/spots/:id" element={<SpotDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuthContext.mockReturnValue({ user: { uid: "viewer-uid" } });
  mockGetSpot.mockResolvedValue(FIXTURE_SPOT);
  mockGetSpotComments.mockResolvedValue([]);
});

describe("SpotDetailPage", () => {
  it("loads the spot via getSpot and renders its name + description", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Test Hubba" })).toBeInTheDocument();
    });
    expect(screen.getByText("smooth ledge")).toBeInTheDocument();
    expect(mockGetSpot).toHaveBeenCalledWith(FIXTURE_SPOT.id);
  });

  it("shows 'Spot not found' when getSpot resolves null", async () => {
    mockGetSpot.mockResolvedValueOnce(null);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Spot not found/i)).toBeInTheDocument();
    });
  });

  it("shows the error message when the load throws", async () => {
    mockGetSpot.mockRejectedValueOnce(new Error("permission-denied"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("permission-denied")).toBeInTheDocument();
    });
  });

  it("renders the existing comments", async () => {
    mockGetSpotComments.mockResolvedValueOnce([FIXTURE_COMMENT]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("good spot")).toBeInTheDocument();
    });
  });

  it("submits a new comment via addSpotComment and prepends it to the list", async () => {
    mockAddSpotComment.mockResolvedValueOnce({
      id: "c2",
      spotId: FIXTURE_SPOT.id,
      userId: "viewer-uid",
      content: "rad",
      createdAt: "2026-04-10T01:00:00.000Z",
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Add a comment/)).toBeInTheDocument();
    });
    await userEvent.type(screen.getByPlaceholderText(/Add a comment/), "rad");
    await userEvent.click(screen.getByLabelText("Send comment"));
    await waitFor(() => {
      expect(mockAddSpotComment).toHaveBeenCalledWith(FIXTURE_SPOT.id, "rad", "viewer-uid");
      expect(screen.getByText("rad")).toBeInTheDocument();
    });
  });

  it("blocks comment submit when the user is signed out", async () => {
    mockUseAuthContext.mockReturnValue({ user: null });
    renderPage();
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Add a comment/)).toBeInTheDocument();
    });
    await userEvent.type(screen.getByPlaceholderText(/Add a comment/), "rad");
    await userEvent.click(screen.getByLabelText("Send comment"));
    await waitFor(() => {
      expect(screen.getByText(/signed in/i)).toBeInTheDocument();
    });
    expect(mockAddSpotComment).not.toHaveBeenCalled();
  });
});
