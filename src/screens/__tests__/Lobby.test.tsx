import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Lobby } from "../Lobby";
import { NotificationProvider } from "../../context/NotificationContext";
import type { ReactNode } from "react";

function Wrapper({ children }: { children: ReactNode }) {
  return <NotificationProvider uid="u1">{children}</NotificationProvider>;
}

const renderWithProviders = (ui: ReactNode, options?: Omit<RenderOptions, "wrapper">) =>
  render(ui, { wrapper: Wrapper, ...options });

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("../../services/auth", () => ({
  resendVerification: vi.fn(),
}));

const profile = { uid: "u1", username: "sk8r", stance: "regular", emailVerified: true, createdAt: null };

function makeGame(overrides: Record<string, unknown> = {}) {
  return {
    id: "game1",
    player1Uid: "u1",
    player2Uid: "u2",
    player1Username: "sk8r",
    player2Username: "rival",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: "u1",
    phase: "setting",
    currentSetter: "u1",
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: { toMillis: () => Date.now() + 86400000 },
    turnNumber: 1,
    winner: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  } as any;
}

const defaultProps = {
  profile,
  games: [] as any[],
  onChallenge: vi.fn(),
  onChallengeUser: vi.fn(),
  onOpenGame: vi.fn(),
  onSignOut: vi.fn(),
  onDeleteAccount: vi.fn(),
  user: { emailVerified: true },
};

beforeEach(() => vi.clearAllMocks());

describe("Lobby", () => {
  it("helper functions compute correct values", () => {
    const game = makeGame({ player1Uid: "u1", player2Uid: "u2", currentTurn: "u2", p1Letters: 1, p2Letters: 3 });
    renderWithProviders(<Lobby {...defaultProps} games={[game]} />);

    // opponent name is rival
    expect(screen.getByText(/vs @rival/)).toBeInTheDocument();
    // not my turn → "Waiting on opponent"
    expect(screen.getByText("Waiting on opponent")).toBeInTheDocument();
  });

  it("shows completed game with You won/lost labels", () => {
    const won = makeGame({ status: "complete", winner: "u1" });
    const lost = makeGame({ id: "g2", status: "complete", winner: "u2", player2Username: "winner" });
    renderWithProviders(<Lobby {...defaultProps} games={[won, lost]} />);

    expect(screen.getByText("You won")).toBeInTheDocument();
    expect(screen.getByText("You lost")).toBeInTheDocument();
  });

  it("shows forfeit label on forfeit game", () => {
    const game = makeGame({ status: "forfeit", winner: "u1" });
    renderWithProviders(<Lobby {...defaultProps} games={[game]} />);

    expect(screen.getByText(/forfeit/)).toBeInTheDocument();
  });

  it("delete modal overlay click closes modal", async () => {
    renderWithProviders(<Lobby {...defaultProps} />);

    await userEvent.click(screen.getByText("Delete Account"));
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();

    // Click the overlay
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Delete Account?")).not.toBeInTheDocument();
    });
  });

  it("delete modal Escape key closes modal", async () => {
    renderWithProviders(<Lobby {...defaultProps} />);

    await userEvent.click(screen.getByText("Delete Account"));
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Delete Account?")).not.toBeInTheDocument();
    });
  });

  it("delete modal does not close during deleting", async () => {
    defaultProps.onDeleteAccount.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<Lobby {...defaultProps} />);

    await userEvent.click(screen.getByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Deleting...")).toBeInTheDocument();
    });

    // Try clicking overlay — should NOT close
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(screen.getByText("Delete Account?")).toBeInTheDocument();

    // Try Escape — should NOT close
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(screen.getByText("Delete Account?")).toBeInTheDocument();
  });

  it("active game card keyboard Enter opens game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame();
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    const card = screen.getByRole("button", { name: /vs @rival/i });
    card.focus();
    await userEvent.keyboard("{Enter}");

    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("active game card keyboard Space opens game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame();
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    const card = screen.getByRole("button", { name: /vs @rival/i });
    card.focus();
    await userEvent.keyboard(" ");

    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("completed game card keyboard Enter opens game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame({ status: "complete", winner: "u1" });
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    const card = screen.getByRole("button", { name: /vs @rival/i });
    card.focus();
    await userEvent.keyboard("{Enter}");

    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("completed game card keyboard Space opens game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame({ status: "complete", winner: "u1" });
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    const card = screen.getByRole("button", { name: /vs @rival/i });
    card.focus();
    await userEvent.keyboard(" ");

    expect(onOpenGame).toHaveBeenCalledWith(game);
  });

  it("delete error shows in modal and can be dismissed", async () => {
    defaultProps.onDeleteAccount.mockRejectedValueOnce(new Error("Delete failed"));
    renderWithProviders(<Lobby {...defaultProps} />);

    await userEvent.click(screen.getByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Delete failed")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("×"));
    expect(screen.queryByText("Delete failed")).not.toBeInTheDocument();
  });

  it("delete non-Error shows fallback message", async () => {
    defaultProps.onDeleteAccount.mockRejectedValueOnce("string error");
    renderWithProviders(<Lobby {...defaultProps} />);

    await userEvent.click(screen.getByText("Delete Account"));
    await userEvent.click(screen.getByText("Delete Forever"));

    await waitFor(() => {
      expect(screen.getByText("Deletion failed — try again")).toBeInTheDocument();
    });
  });

  it("helper functions work for player2 perspective", () => {
    const game = makeGame({
      player1Uid: "other",
      player2Uid: "u1",
      player1Username: "someone",
      player2Username: "sk8r",
      currentTurn: "u1",
      p1Letters: 2,
      p2Letters: 4,
    });
    renderWithProviders(<Lobby {...defaultProps} games={[game]} />);

    // opponent should be player1's username since profile is player2
    expect(screen.getByText(/vs @someone/)).toBeInTheDocument();
    // my turn → "Your turn"
    expect(screen.getByText("Your turn")).toBeInTheDocument();
  });

  it("non-matching key on done game card does not open game", async () => {
    const onOpenGame = vi.fn();
    const game = makeGame({ status: "complete", winner: "u1" });
    renderWithProviders(<Lobby {...defaultProps} games={[game]} onOpenGame={onOpenGame} />);

    const card = screen.getByRole("button", { name: /vs @rival/i });
    card.focus();
    await userEvent.keyboard("a");

    expect(onOpenGame).not.toHaveBeenCalled();
  });

  it("inner modal click stops propagation", async () => {
    renderWithProviders(<Lobby {...defaultProps} />);

    await userEvent.click(screen.getByText("Delete Account"));
    expect(screen.getByText("Delete Account?")).toBeInTheDocument();

    // Click inside the modal content (inner div) — should NOT close
    await userEvent.click(screen.getByText("Delete Account?"));

    expect(screen.getByText("Delete Account?")).toBeInTheDocument();
  });
});
