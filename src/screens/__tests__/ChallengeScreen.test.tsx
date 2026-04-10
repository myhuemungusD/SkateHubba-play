import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { ChallengeScreen } from "../ChallengeScreen";

/** Render helper — ChallengeScreen uses useSearchParams() which requires a Router ancestor. */
function renderWithRouter(ui: ReactElement, { initialEntries = ["/challenge"] }: { initialEntries?: string[] } = {}) {
  return render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>);
}

const mockGetUidByUsername = vi.fn();
const mockChallengeFromSpot = vi.fn();
const mockFetchSpotName = vi.fn();

vi.mock("../../services/users", () => ({
  getUidByUsername: (...args: unknown[]) => mockGetUidByUsername(...args),
  getLeaderboard: () => Promise.resolve([]),
}));

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
  analytics: {
    challengeFromSpot: (...args: unknown[]) => mockChallengeFromSpot(...args),
  },
}));

vi.mock("../../services/spots", () => ({
  fetchSpotName: (...args: unknown[]) => mockFetchSpotName(...args),
}));

vi.mock("../../services/blocking", () => ({
  getBlockedUserIds: vi.fn().mockResolvedValue(new Set()),
}));

const profile = { uid: "u1", username: "sk8r", stance: "regular", emailVerified: true, createdAt: null };

beforeEach(() => vi.clearAllMocks());

describe("ChallengeScreen", () => {
  const defaultProps = {
    profile,
    onSend: vi.fn(),
    onBack: vi.fn(),
  };

  it("rejects short username on submit", async () => {
    renderWithRouter(<ChallengeScreen {...defaultProps} />);

    const input = screen.getByPlaceholderText("their_handle");
    await userEvent.type(input, "ab");

    // Submit via form
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(screen.getByText("Enter a valid username")).toBeInTheDocument();
  });

  it("rejects self-challenge", async () => {
    renderWithRouter(<ChallengeScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "sk8r");
    await userEvent.click(screen.getByText(/Send Challenge/));

    expect(screen.getByText("You can't challenge yourself")).toBeInTheDocument();
  });

  it("shows error when opponent not found", async () => {
    mockGetUidByUsername.mockResolvedValueOnce(null);
    renderWithRouter(<ChallengeScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "ghost");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText(/@ghost doesn't exist yet/)).toBeInTheDocument();
    });
  });

  it("shows error when onSend fails with Error", async () => {
    mockGetUidByUsername.mockResolvedValueOnce("u2");
    defaultProps.onSend.mockRejectedValueOnce(new Error("Create failed"));
    renderWithRouter(<ChallengeScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText("Create failed")).toBeInTheDocument();
    });
  });

  it("shows fallback error when onSend fails with non-Error", async () => {
    mockGetUidByUsername.mockResolvedValueOnce("u2");
    defaultProps.onSend.mockRejectedValueOnce("string error");
    renderWithRouter(<ChallengeScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText("Could not start game")).toBeInTheDocument();
    });
  });

  it("input is locked during loading", async () => {
    mockGetUidByUsername.mockImplementation(() => new Promise(() => {}));
    renderWithRouter(<ChallengeScreen {...defaultProps} />);

    const input = screen.getByPlaceholderText("their_handle") as HTMLInputElement;
    await userEvent.type(input, "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText("Finding...")).toBeInTheDocument();
    });

    // Fire onChange while loading — the `if (!loading)` guard prevents state update
    const valueBefore = input.value;
    fireEvent.change(input, { target: { value: "rival_extra" } });
    // Controlled input value unchanged since setOpponent was not called
    expect(input.value).toBe(valueBefore);
  });

  it("error banner can be dismissed", async () => {
    renderWithRouter(<ChallengeScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "sk8r");
    await userEvent.click(screen.getByText(/Send Challenge/));

    expect(screen.getByText("You can't challenge yourself")).toBeInTheDocument();

    await userEvent.click(screen.getByText("×"));
    expect(screen.queryByText("You can't challenge yourself")).not.toBeInTheDocument();
  });

  it("onBack navigates back", async () => {
    const onBack = vi.fn();
    renderWithRouter(<ChallengeScreen {...defaultProps} onBack={onBack} />);

    await userEvent.click(screen.getByText("← Back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("strips special characters from username input", async () => {
    renderWithRouter(<ChallengeScreen {...defaultProps} />);

    const input = screen.getByPlaceholderText("their_handle") as HTMLInputElement;
    await userEvent.type(input, "test@#$user");

    // Only alphanumeric and underscore
    expect(input.value).toBe("testuser");
  });

  const VALID_SPOT_ID = "11111111-2222-3333-4444-555555555555";

  it("forwards ?spot= URL param to onSend as spotId", async () => {
    mockGetUidByUsername.mockResolvedValueOnce("u2");
    mockFetchSpotName.mockResolvedValueOnce(null);
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ChallengeScreen {...defaultProps} onSend={onSend} />, {
      initialEntries: [`/challenge?spot=${VALID_SPOT_ID}`],
    });

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("u2", "rival", VALID_SPOT_ID);
    });
  });

  it("forwards null spotId when no ?spot= URL param is present", async () => {
    mockGetUidByUsername.mockResolvedValueOnce("u2");
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ChallengeScreen {...defaultProps} onSend={onSend} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("u2", "rival", null);
    });
  });

  it("drops a garbled ?spot= value so onSend receives null", async () => {
    mockGetUidByUsername.mockResolvedValueOnce("u2");
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ChallengeScreen {...defaultProps} onSend={onSend} />, {
      initialEntries: ["/challenge?spot=%27%20OR%201%3D1"],
    });

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("u2", "rival", null);
    });
    // No chip should render for garbled input
    expect(screen.queryByTestId("challenge-spot-chip")).not.toBeInTheDocument();
  });

  it("fires the challengeFromSpot analytics event on mount when spotId is valid", async () => {
    mockFetchSpotName.mockResolvedValueOnce(null);
    renderWithRouter(<ChallengeScreen {...defaultProps} />, {
      initialEntries: [`/challenge?spot=${VALID_SPOT_ID}`],
    });

    await waitFor(() => {
      expect(mockChallengeFromSpot).toHaveBeenCalledWith(VALID_SPOT_ID);
    });
  });

  it("does not fire analytics when there is no spotId", () => {
    renderWithRouter(<ChallengeScreen {...defaultProps} />);
    expect(mockChallengeFromSpot).not.toHaveBeenCalled();
  });

  it("renders the spot context chip with the fetched name", async () => {
    mockFetchSpotName.mockResolvedValueOnce("Hollenbeck Hubba");
    renderWithRouter(<ChallengeScreen {...defaultProps} />, {
      initialEntries: [`/challenge?spot=${VALID_SPOT_ID}`],
    });

    await waitFor(() => {
      expect(screen.getByTestId("challenge-spot-chip")).toHaveTextContent("Challenging at Hollenbeck Hubba");
    });
  });

  it("falls back to a generic label when the spot name fetch fails", async () => {
    mockFetchSpotName.mockResolvedValueOnce(null);
    renderWithRouter(<ChallengeScreen {...defaultProps} />, {
      initialEntries: [`/challenge?spot=${VALID_SPOT_ID}`],
    });

    await waitFor(() => {
      expect(screen.getByTestId("challenge-spot-chip")).toHaveTextContent("Challenging at a saved spot");
    });
  });
});
