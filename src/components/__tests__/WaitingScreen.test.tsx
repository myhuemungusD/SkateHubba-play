import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaitingScreen } from "../WaitingScreen";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";

vi.mock("../../utils/helpers", () => ({
  isFirebaseStorageUrl: (url: string) => url?.startsWith("https://firebasestorage.googleapis.com"),
  LETTERS: ["S", "K", "A", "T", "E"],
}));

const mockSendNudge = vi.fn();
const mockCanNudge = vi.fn();

vi.mock("../../services/nudge", () => ({
  sendNudge: (...args: unknown[]) => mockSendNudge(...args),
  canNudge: (...args: unknown[]) => mockCanNudge(...args),
}));

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
}));

const profile: UserProfile = {
  uid: "u1",
  username: "alice",
  stance: "regular",
  createdAt: null,
  emailVerified: true,
};

const makeGame = (overrides?: Partial<GameDoc>): GameDoc => ({
  id: "g1",
  player1Uid: "u1",
  player2Uid: "u2",
  player1Username: "alice",
  player2Username: "bob",
  p1Letters: 1,
  p2Letters: 2,
  status: "active",
  currentTurn: "u2",
  phase: "matching",
  currentSetter: "u1",
  currentTrickName: "Kickflip",
  currentTrickVideoUrl: "https://firebasestorage.googleapis.com/trick.webm",
  matchVideoUrl: null,
  turnDeadline: { toMillis: () => Date.now() + 86400000 } as GameDoc["turnDeadline"],
  turnNumber: 1,
  winner: null,
  createdAt: null,
  updatedAt: null,
  ...overrides,
});

describe("WaitingScreen", () => {
  const onBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCanNudge.mockReturnValue(true);
    mockSendNudge.mockResolvedValue(undefined);
  });

  it("renders opponent name and waiting message", () => {
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    expect(screen.getByText("Waiting on @bob")).toBeInTheDocument();
    expect(screen.getByText("They're attempting to match your trick.")).toBeInTheDocument();
  });

  it("shows setting phase message when phase is setting", () => {
    render(<WaitingScreen game={makeGame({ phase: "setting" })} profile={profile} onBack={onBack} />);
    expect(screen.getByText("They're setting a trick for you to match.")).toBeInTheDocument();
  });

  it("shows trick video in matching phase", () => {
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    expect(screen.getByText("Your Trick: Kickflip")).toBeInTheDocument();
    expect(screen.getByLabelText("Video of Kickflip you set")).toBeInTheDocument();
  });

  it("shows 'No video recorded' when no trick video URL", () => {
    render(<WaitingScreen game={makeGame({ currentTrickVideoUrl: null })} profile={profile} onBack={onBack} />);
    expect(screen.getByText("No video recorded")).toBeInTheDocument();
  });

  it("calls onBack when back button is clicked", async () => {
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    await userEvent.click(screen.getByText("← Back to Games"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("sends nudge on button click", async () => {
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    await userEvent.click(screen.getByText("Nudge"));

    await waitFor(() => {
      expect(screen.getByText("Nudge Sent")).toBeInTheDocument();
    });
    expect(mockSendNudge).toHaveBeenCalledWith({
      gameId: "g1",
      senderUid: "u1",
      senderUsername: "alice",
      recipientUid: "u2",
    });
  });

  it("shows error when nudge fails", async () => {
    mockSendNudge.mockRejectedValue(new Error("Rate limited"));

    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    await userEvent.click(screen.getByText("Nudge"));

    await waitFor(() => {
      expect(screen.getByText("Rate limited")).toBeInTheDocument();
    });
  });

  it("disables nudge when cooldown is active", () => {
    mockCanNudge.mockReturnValue(false);
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    expect(screen.getByText("Nudge Sent")).toBeDisabled();
  });

  it("renders letter displays for both players", () => {
    render(<WaitingScreen game={makeGame()} profile={profile} onBack={onBack} />);
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("@bob")).toBeInTheDocument();
  });
});
