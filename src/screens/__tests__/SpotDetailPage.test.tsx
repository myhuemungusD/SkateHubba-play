import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
const mockGetBlocked = vi.fn();

vi.mock("../../services/blocking", () => ({
  getBlockedUserIds: (...args: unknown[]) => mockGetBlocked(...args),
}));
vi.mock("../../components/ReportModal", () => ({
  ReportModal: (p: {
    reportedUid: string;
    spotId?: string;
    gameId?: string | null;
    comment?: { id: string; text: string };
    onClose: () => void;
    onSubmitted: () => void;
  }) => (
    <div role="dialog" aria-label="report-modal">
      <p>
        report {p.reportedUid} {p.spotId} {p.comment?.id}:{p.comment?.text} game={String(p.gameId)}
      </p>
      <button onClick={p.onSubmitted}>__submit__</button>
      <button onClick={p.onClose}>__close__</button>
    </div>
  ),
}));

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
const mapFlag = vi.hoisted(() => ({ on: false }));
vi.mock("../../lib/featureFlags", async (orig) => ({
  ...(await orig<typeof import("../../lib/featureFlags")>()),
  isSpotChatsEnabled: () => chatFlag.on,
  isMapCheckinsEnabled: () => mapFlag.on,
}));
vi.mock("../../components/map/CheckInButton", () => ({
  CheckInButton: ({ spot }: { spot: { id: string } }) => <p>check in at {spot.id}</p>,
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
  mockUseAuthContext.mockReturnValue({
    user: { uid: "viewer-uid" },
    activeProfile: { uid: "viewer-uid", username: "viewer" },
  });
  mockGetBlocked.mockResolvedValue(new Set());
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
      expect(mockAddSpotComment).toHaveBeenCalledWith(FIXTURE_SPOT.id, "rad", "viewer-uid", "viewer");
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
    mockUseAuthContext.mockReturnValue({ user: null, activeProfile: null });
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

  it("shows a post failure and keeps the draft", async () => {
    mockAddSpotComment.mockRejectedValueOnce(new Error("Spot not found"));
    renderPage();
    await userEvent.type(await screen.findByPlaceholderText(/Add a comment/), "rad");
    await userEvent.click(screen.getByLabelText("Send comment"));
    expect(await screen.findByText("Spot not found")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Add a comment/)).toHaveValue("rad");
  });

  it("falls back to a generic message when a post fails with a non-Error", async () => {
    mockAddSpotComment.mockRejectedValueOnce("nope");
    renderPage();
    await userEvent.type(await screen.findByPlaceholderText(/Add a comment/), "rad");
    await userEvent.click(screen.getByLabelText("Send comment"));
    expect(await screen.findByText("Failed to post comment")).toBeInTheDocument();
  });

  it("shows authors by handle, never by account id", async () => {
    mockGetSpotComments.mockResolvedValueOnce([
      FIXTURE_COMMENT,
      { ...FIXTURE_COMMENT, id: "c2", username: "kickflip" },
    ]);
    renderPage();
    expect(await screen.findByText("@kickflip")).toBeInTheDocument();
    expect(screen.getByText("skater")).toBeInTheDocument();
    expect(screen.queryByText(/commente/)).toBeNull();
    // The handle opens the author's profile, where Block lives.
    expect(screen.getByRole("link", { name: "@kickflip" })).toHaveAttribute("href", "/player/commenter-uid");
  });

  it("won't post under a profile that belongs to a different account", async () => {
    mockUseAuthContext.mockReturnValue({
      user: { uid: "viewer-uid" },
      activeProfile: { uid: "previous-account", username: "old" },
    });
    mockGetSpotComments.mockResolvedValueOnce([FIXTURE_COMMENT]);
    renderPage();
    await screen.findByText("good spot");
    expect(screen.queryByRole("button", { name: /report comment/i })).toBeNull();
    await userEvent.type(screen.getByPlaceholderText(/Add a comment/), "rad");
    await userEvent.click(screen.getByLabelText("Send comment"));
    expect(await screen.findByText("You must be signed in to comment")).toBeInTheDocument();
    expect(mockAddSpotComment).not.toHaveBeenCalled();
  });

  it("reports someone else's comment against its author, but never your own", async () => {
    mockGetSpotComments.mockResolvedValueOnce([
      { ...FIXTURE_COMMENT, username: "troll" },
      { ...FIXTURE_COMMENT, id: "mine", userId: "viewer-uid", username: "viewer", content: "mine" },
    ]);
    renderPage();
    await screen.findByText("mine");
    expect(screen.getAllByRole("button", { name: /report comment/i })).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Report comment by @troll" }));
    expect(
      await screen.findByText(`report commenter-uid ${FIXTURE_SPOT.id} c1:good spot game=null`),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByText("__submit__"));
    expect(screen.queryByRole("dialog", { name: "report-modal" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Report comment by @troll" }));
    await userEvent.click(await screen.findByText("__close__"));
    expect(screen.queryByRole("dialog", { name: "report-modal" })).toBeNull();
  });

  it("labels the report control for a comment with no stored handle", async () => {
    mockGetSpotComments.mockResolvedValueOnce([FIXTURE_COMMENT]);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Report this comment" }));
    expect(await screen.findByRole("dialog", { name: "report-modal" })).toBeInTheDocument();
  });

  it("offers no report control when signed out", async () => {
    mockUseAuthContext.mockReturnValue({ user: null, activeProfile: null });
    mockGetSpotComments.mockResolvedValueOnce([FIXTURE_COMMENT]);
    renderPage();
    await screen.findByText("good spot");
    expect(screen.queryByRole("button", { name: /report comment/i })).toBeNull();
    expect(mockGetBlocked).not.toHaveBeenCalled();
  });

  it("leaves out comments from players the viewer blocked", async () => {
    mockGetBlocked.mockResolvedValueOnce(new Set(["commenter-uid"]));
    mockGetSpotComments.mockResolvedValueOnce([FIXTURE_COMMENT]);
    renderPage();
    await waitFor(() => expect(mockGetBlocked).toHaveBeenCalledWith("viewer-uid"));
    await waitFor(() => expect(screen.queryByText("good spot")).toBeNull());
    expect(screen.getByText(/No comments yet/)).toBeInTheDocument();
  });

  it("ignores a blocked list that lands after the page unmounts", async () => {
    let resolve: (v: Set<string>) => void = () => {};
    mockGetBlocked.mockReturnValueOnce(new Promise<Set<string>>((r) => (resolve = r)));
    const { unmount } = renderPage();
    await waitFor(() => expect(mockGetBlocked).toHaveBeenCalled());
    unmount();
    resolve(new Set(["x"]));
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

describe("SpotDetailPage check-in", () => {
  afterEach(() => {
    mapFlag.on = false;
  });
  it("offers Check in on the spot page when map check-ins are on", async () => {
    mapFlag.on = true;
    renderPage();
    expect(await screen.findByText(`check in at ${FIXTURE_SPOT.id}`)).toBeInTheDocument();
  });
  it("hides Check in while the flag is off", async () => {
    renderPage();
    await screen.findByText("Test Hubba");
    expect(screen.queryByText(/check in at/)).toBeNull();
  });
});
