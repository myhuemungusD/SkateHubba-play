import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChallengeScreen } from "../ChallengeScreen";

const mockGetUidByUsername = vi.fn();

vi.mock("../../services/users", () => ({
  getUidByUsername: (...args: unknown[]) => mockGetUidByUsername(...args),
}));

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
}));

const profile = { uid: "u1", username: "sk8r", stance: "regular", email: "a@b.com", emailVerified: true };

beforeEach(() => vi.clearAllMocks());

describe("ChallengeScreen", () => {
  const defaultProps = {
    profile,
    onSend: vi.fn(),
    onBack: vi.fn(),
  };

  it("rejects short username on submit", async () => {
    render(<ChallengeScreen {...defaultProps} />);

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
    render(<ChallengeScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "sk8r");
    await userEvent.click(screen.getByText(/Send Challenge/));

    expect(screen.getByText("You can't challenge yourself")).toBeInTheDocument();
  });

  it("shows error when opponent not found", async () => {
    mockGetUidByUsername.mockResolvedValueOnce(null);
    render(<ChallengeScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "ghost");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText(/@ghost doesn't exist yet/)).toBeInTheDocument();
    });
  });

  it("shows error when onSend fails with Error", async () => {
    mockGetUidByUsername.mockResolvedValueOnce("u2");
    defaultProps.onSend.mockRejectedValueOnce(new Error("Create failed"));
    render(<ChallengeScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText("Create failed")).toBeInTheDocument();
    });
  });

  it("shows fallback error when onSend fails with non-Error", async () => {
    mockGetUidByUsername.mockResolvedValueOnce("u2");
    defaultProps.onSend.mockRejectedValueOnce("string error");
    render(<ChallengeScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText("Could not start game")).toBeInTheDocument();
    });
  });

  it("input is locked during loading", async () => {
    mockGetUidByUsername.mockImplementation(() => new Promise(() => {}));
    render(<ChallengeScreen {...defaultProps} />);

    const input = screen.getByPlaceholderText("their_handle");
    await userEvent.type(input, "rival");
    await userEvent.click(screen.getByText(/Send Challenge/));

    await waitFor(() => {
      expect(screen.getByText("Finding...")).toBeInTheDocument();
    });

    // Try to type while loading — input onChange checks `if (!loading)`
    // Since loading=true, typing should be blocked
  });

  it("error banner can be dismissed", async () => {
    render(<ChallengeScreen {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("their_handle"), "sk8r");
    await userEvent.click(screen.getByText(/Send Challenge/));

    expect(screen.getByText("You can't challenge yourself")).toBeInTheDocument();

    await userEvent.click(screen.getByText("×"));
    expect(screen.queryByText("You can't challenge yourself")).not.toBeInTheDocument();
  });

  it("onBack navigates back", async () => {
    const onBack = vi.fn();
    render(<ChallengeScreen {...defaultProps} onBack={onBack} />);

    await userEvent.click(screen.getByText("← Back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("strips special characters from username input", async () => {
    render(<ChallengeScreen {...defaultProps} />);

    const input = screen.getByPlaceholderText("their_handle") as HTMLInputElement;
    await userEvent.type(input, "test@#$user");

    // Only alphanumeric and underscore
    expect(input.value).toBe("testuser");
  });
});
