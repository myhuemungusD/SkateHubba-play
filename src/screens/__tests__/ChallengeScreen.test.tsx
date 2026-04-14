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
      expect(onSend).toHaveBeenCalledWith("u2", "rival", {
        spotId: VALID_SPOT_ID,
        judgeUid: null,
        judgeUsername: null,
      });
    });
  });

  it("forwards null spotId when no ?spot= URL param is present", async () => {
    mockGetUidByUsername.mockResolvedValueOnce("u2");
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ChallengeScreen {...defaultProps} onSend={onSend} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("u2", "rival", {
        spotId: null,
        judgeUid: null,
        judgeUsername: null,
      });
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
      expect(onSend).toHaveBeenCalledWith("u2", "rival", {
        spotId: null,
        judgeUid: null,
        judgeUsername: null,
      });
    });
    // No chip should render for garbled input, and neither analytics nor
    // the fetch helper should ever see the garbled value.
    expect(screen.queryByTestId("challenge-spot-chip")).not.toBeInTheDocument();
    expect(mockChallengeFromSpot).not.toHaveBeenCalled();
    expect(mockFetchSpotName).not.toHaveBeenCalled();
  });

  it("does not render the chip until the spot name fetch resolves (no flash)", async () => {
    // Hold the fetch promise open so we can observe the "loading" state.
    let resolveFetch: (name: string | null) => void = () => {};
    mockFetchSpotName.mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderWithRouter(<ChallengeScreen {...defaultProps} />, {
      initialEntries: [`/challenge?spot=${VALID_SPOT_ID}`],
    });

    // While the fetch is pending, the chip must NOT be in the DOM — the
    // tri-state render is what prevents the "Challenging at a saved spot"
    // fallback from flashing before the real name arrives.
    expect(screen.queryByTestId("challenge-spot-chip")).not.toBeInTheDocument();

    // Resolve the fetch; chip should now appear with the fetched name.
    resolveFetch("Hollenbeck Hubba");
    await waitFor(() => {
      expect(screen.getByTestId("challenge-spot-chip")).toHaveTextContent("Challenging at Hollenbeck Hubba");
    });
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

  it("forwards judge username to onSend when a valid judge is added", async () => {
    // Resolve opponent first, then judge.
    mockGetUidByUsername.mockResolvedValueOnce("u2").mockResolvedValueOnce("u3");
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ChallengeScreen {...defaultProps} onSend={onSend} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    // Open the judge picker, then type a judge username.
    await userEvent.click(screen.getByTestId("add-judge-toggle"));
    const allHandleInputs = screen.getAllByPlaceholderText("their_handle");
    await userEvent.type(allHandleInputs[allHandleInputs.length - 1], "judge");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("u2", "rival", {
        spotId: null,
        judgeUid: "u3",
        judgeUsername: "judge",
      });
    });
  });

  it("issues opponent + judge UID lookups in parallel (no extra latency on game start)", async () => {
    // Both lookups must be in flight before either resolves — locks in the
    // Promise.all parallelization so a future refactor can't quietly
    // re-serialize the judge lookup and double the start-game round-trip.
    let resolveOpp: (v: string) => void = () => {};
    let resolveJudge: (v: string) => void = () => {};
    const oppPromise = new Promise<string>((r) => {
      resolveOpp = r;
    });
    const judgePromise = new Promise<string>((r) => {
      resolveJudge = r;
    });
    mockGetUidByUsername.mockReturnValueOnce(oppPromise).mockReturnValueOnce(judgePromise);

    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ChallengeScreen {...defaultProps} onSend={onSend} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByTestId("add-judge-toggle"));
    const inputs = screen.getAllByPlaceholderText("their_handle");
    await userEvent.type(inputs[inputs.length - 1], "judge");
    await userEvent.click(screen.getByText(/Send Challenge/));

    // Both calls fire before either resolves — the assertion that proves
    // parallelism. With the previous serial flow, the judge call would not
    // have been issued until after the opponent promise resolved.
    await waitFor(() => {
      expect(mockGetUidByUsername).toHaveBeenCalledTimes(2);
    });
    expect(mockGetUidByUsername).toHaveBeenNthCalledWith(1, "rival");
    expect(mockGetUidByUsername).toHaveBeenNthCalledWith(2, "judge");

    // Resolve in reverse order so the judge promise settling first cannot
    // race ahead of opponent error-handling — we still gate on opponent uid.
    resolveJudge("u3");
    resolveOpp("u2");

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("u2", "rival", {
        spotId: null,
        judgeUid: "u3",
        judgeUsername: "judge",
      });
    });
  });

  it("surfaces a specific opponent-lookup error when the directory call rejects", async () => {
    // Network/permissions failure on the opponent lookup — judge field empty
    // so only the opponent promise is in flight. Should surface the rejection
    // message instead of the generic "Could not start game" fallback, and
    // must not call onSend.
    mockGetUidByUsername.mockRejectedValueOnce(new Error("Network unreachable"));
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ChallengeScreen {...defaultProps} onSend={onSend} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText("Network unreachable")).toBeInTheDocument();
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("falls back to a friendly opponent-lookup error when the rejection has no message", async () => {
    mockGetUidByUsername.mockRejectedValueOnce("opaque-non-error");
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ChallengeScreen {...defaultProps} onSend={onSend} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText("Couldn't reach the player directory. Try again.")).toBeInTheDocument();
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("surfaces a judge-specific error and lets the user retry without losing opponent state", async () => {
    // Opponent resolves cleanly, judge lookup network-fails. The error must
    // name the judge field specifically so the user knows they can either
    // retry or remove the judge — the start flow must never be silently
    // blocked by an optional field.
    mockGetUidByUsername.mockResolvedValueOnce("u2").mockRejectedValueOnce(new Error("timeout"));
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ChallengeScreen {...defaultProps} onSend={onSend} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByTestId("add-judge-toggle"));
    const inputs = screen.getAllByPlaceholderText("their_handle");
    await userEvent.type(inputs[inputs.length - 1], "judge");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(
        screen.getByText("Couldn't look up judge @judge. Try again or remove the judge to start now."),
      ).toBeInTheDocument();
    });
    // Opponent lookup result wasn't wasted — onSend must NOT have been called
    // (we don't silently drop the judge), but the opponent input is preserved
    // so the user can retry without re-typing. Both opponent and judge fields
    // are still rendered (judge picker stays open after the error).
    expect(onSend).not.toHaveBeenCalled();
    const allInputs = screen.getAllByPlaceholderText("their_handle") as HTMLInputElement[];
    expect(allInputs[0].value).toBe("rival");
    expect(allInputs[allInputs.length - 1].value).toBe("judge");
  });

  it("opponent error wins when both lookups reject", async () => {
    // Both rejections — opponent error takes priority because it's the
    // required field. Avoids confusing the user with two simultaneous
    // banners and keeps the feedback aligned with what they need to fix
    // first.
    mockGetUidByUsername.mockRejectedValueOnce(new Error("opp-down")).mockRejectedValueOnce(new Error("judge-down"));
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ChallengeScreen {...defaultProps} onSend={onSend} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByTestId("add-judge-toggle"));
    const inputs = screen.getAllByPlaceholderText("their_handle");
    await userEvent.type(inputs[inputs.length - 1], "judge");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText("opp-down")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Couldn't look up judge/)).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("marks the form aria-busy while a submit is in flight", async () => {
    mockGetUidByUsername.mockImplementation(() => new Promise(() => {})); // hang
    renderWithRouter(<ChallengeScreen {...defaultProps} />);

    const input = screen.getByPlaceholderText("their_handle");
    const form = input.closest("form")!;
    expect(form).not.toHaveAttribute("aria-busy", "true");

    await userEvent.type(input, "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(form).toHaveAttribute("aria-busy", "true");
    });
  });

  it("rejects a judge that matches the opponent", async () => {
    mockGetUidByUsername.mockResolvedValueOnce("u2").mockResolvedValueOnce("u2");
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ChallengeScreen {...defaultProps} onSend={onSend} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByTestId("add-judge-toggle"));
    const allHandleInputs = screen.getAllByPlaceholderText("their_handle");
    await userEvent.type(allHandleInputs[allHandleInputs.length - 1], "rivalsame");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText(/Judge must be a third player/)).toBeInTheDocument();
    });
    expect(onSend).not.toHaveBeenCalled();
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
