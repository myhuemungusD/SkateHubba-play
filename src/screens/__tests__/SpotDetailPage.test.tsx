import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router";
import type { Spot, SpotComment } from "../../types/spot";

const mockGetSpot = vi.fn();
const mockGetSpotComments = vi.fn();
const mockAddSpotComment = vi.fn();
const mockUseAuthContext = vi.fn();
const mockSetScreen = vi.fn();
const mockNavigateToChallengeWithSpot = vi.fn();

vi.mock("../../services/spots", () => ({
  getSpot: (...args: unknown[]) => mockGetSpot(...args),
  getSpotComments: (...args: unknown[]) => mockGetSpotComments(...args),
  addSpotComment: (...args: unknown[]) => mockAddSpotComment(...args),
}));

vi.mock("../../context/AuthContext", () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

vi.mock("../../context/NavigationContext", () => ({
  useNavigationContext: () => ({
    setScreen: mockSetScreen,
    navigateToChallengeWithSpot: mockNavigateToChallengeWithSpot,
  }),
}));

const chatFlag = vi.hoisted(() => ({ on: false }));
vi.mock("../../lib/featureFlags", async (orig) => ({
  ...(await orig<typeof import("../../lib/featureFlags")>()),
  isSpotChatsEnabled: () => chatFlag.on,
}));
vi.mock("../../components/SpotChat/SpotChat", () => ({
  SpotChat: ({ onError }: { onError: (m: string) => void }) => (
    <button onClick={() => onError("chat broke")}>mock chat</button>
  ),
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
        <Route path="/map" element={<p>map page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  chatFlag.on = false;
  mockUseAuthContext.mockReturnValue({ user: { uid: "viewer-uid" } });
  mockGetSpot.mockResolvedValue(FIXTURE_SPOT);
  mockGetSpotComments.mockResolvedValue([]);
});

/** Test-only control that navigates the router to another spot in place. */
function GoToSpot({ id }: { id: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(`/spots/${id}`)}>go to other spot</button>;
}

describe("SpotDetailPage", () => {
  it("re-enters the loading state and fetches the new spot when the route id changes", async () => {
    const OTHER_ID = "99999999-8888-7777-6666-555555555555";
    render(
      <MemoryRouter initialEntries={[`/spots/${FIXTURE_SPOT.id}`]}>
        <GoToSpot id={OTHER_ID} />
        <Routes>
          <Route path="/spots/:id" element={<SpotDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Test Hubba" })).toBeInTheDocument();
    });

    let resolveOther: (spot: Spot) => void = () => {};
    mockGetSpot.mockReturnValueOnce(
      new Promise<Spot>((resolve) => {
        resolveOther = resolve;
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "go to other spot" }));

    expect(mockGetSpot).toHaveBeenLastCalledWith(OTHER_ID);
    expect(screen.queryByRole("heading", { name: "Test Hubba" })).not.toBeInTheDocument();

    resolveOther({ ...FIXTURE_SPOT, id: OTHER_ID, name: "Other Rail" });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Other Rail" })).toBeInTheDocument();
    });
  });

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

  it("'Challenge to S.K.A.T.E. here' routes through NavigationContext with the spot id", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Challenge to S\.K\.A\.T\.E\. here/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /Challenge to S\.K\.A\.T\.E\. here/i }));
    expect(mockNavigateToChallengeWithSpot).toHaveBeenCalledWith(FIXTURE_SPOT.id);
  });

  it("'Back to map' lands on the map when the spot was opened cold (deep link)", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Back to map")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByLabelText("Back to map"));
    expect(screen.getByText("map page")).toBeInTheDocument();
  });

  it("'Back to Map' error fallback button routes through setScreen('map')", async () => {
    mockGetSpot.mockResolvedValueOnce(null);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Back to Map/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /Back to Map/i }));
    expect(mockSetScreen).toHaveBeenCalledWith("map");
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

  it("shows the spot chat only when the flag is on and surfaces its errors", async () => {
    chatFlag.on = true;
    renderPage();
    await userEvent.click(await screen.findByText("mock chat"));
    expect(await screen.findByText("chat broke")).toBeInTheDocument();
  });

  it("hides the spot chat while the flag is off", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Test Hubba" });
    expect(screen.queryByText("mock chat")).toBeNull();
  });
});
