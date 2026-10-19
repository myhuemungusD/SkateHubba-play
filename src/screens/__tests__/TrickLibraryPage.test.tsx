import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { TrickLibraryEntry } from "../../types/trickLibrary";

const h = vi.hoisted(() => ({
  listApprovedTricks: vi.fn(),
  listMySubmissions: vi.fn(),
  listPendingTricks: vi.fn(),
  moderateTrick: vi.fn(),
  submitTrick: vi.fn(),
  voteTrick: vi.fn(),
  clearTrickVote: vi.fn(),
  getMyTrickVote: vi.fn(),
  getTrickScore: vi.fn(),
  isAdmin: false,
  warn: vi.fn(),
}));

vi.mock("../../services/trickLibrary", () => ({
  listApprovedTricks: h.listApprovedTricks,
  listMySubmissions: h.listMySubmissions,
  listPendingTricks: h.listPendingTricks,
  moderateTrick: h.moderateTrick,
  submitTrick: h.submitTrick,
  voteTrick: h.voteTrick,
  clearTrickVote: h.clearTrickVote,
  getMyTrickVote: h.getMyTrickVote,
  getTrickScore: h.getTrickScore,
}));
vi.mock("../../hooks/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: h.isAdmin, loading: false }) }));
vi.mock("../../services/logger", () => ({ logger: { warn: h.warn } }));

import { TrickLibraryPage } from "../TrickLibraryPage";

const trick = (over: Partial<TrickLibraryEntry> = {}): TrickLibraryEntry => ({
  id: "t1",
  name: "Kickflip",
  difficulty: "beginner",
  submittedBy: "u2",
  submittedAt: 1,
  status: "approved",
  ...over,
});

function renderPage(emailVerified = true) {
  return render(
    <MemoryRouter>
      <TrickLibraryPage uid="u1" emailVerified={emailVerified} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  h.isAdmin = false;
  h.listApprovedTricks.mockResolvedValue([]);
  h.listMySubmissions.mockResolvedValue([]);
  h.listPendingTricks.mockResolvedValue([]);
  h.getMyTrickVote.mockResolvedValue(null);
  h.getTrickScore.mockResolvedValue({ up: 2, down: 0 });
});

describe("TrickLibraryPage", () => {
  it("shows the empty state and hides the admin queue for non-admins", async () => {
    renderPage();
    expect(await screen.findByText(/No tricks yet/)).toBeInTheDocument();
    expect(screen.queryByText("Review queue")).toBeNull();
    expect(h.listPendingTricks).not.toHaveBeenCalled();
  });

  it("lists approved tricks with votes and toggles a vote", async () => {
    h.listApprovedTricks.mockResolvedValue([
      trick({ description: "pop and flick", videoUrl: "https://v" }),
      trick({ id: "t2", name: "Tre", difficulty: "expert" }),
    ]);
    renderPage();
    const up = await screen.findAllByRole("button", { name: "Up (2)" });
    await userEvent.click(up[0]);
    await waitFor(() => expect(h.voteTrick).toHaveBeenCalledWith("u1", "t1", "up"));
    const pressed = await screen.findByRole("button", { name: "Up (3)" });
    expect(pressed).toHaveAttribute("aria-pressed", "true");
    // Same vote again takes it back.
    await userEvent.click(pressed);
    await waitFor(() => expect(h.clearTrickVote).toHaveBeenCalledWith("u1", "t1"));
    // Switch from nothing to down.
    await userEvent.click((await screen.findAllByRole("button", { name: "Down (0)" }))[0]);
    await waitFor(() => expect(h.voteTrick).toHaveBeenCalledWith("u1", "t1", "down"));
    expect(screen.getByText("pop and flick")).toBeInTheDocument();
  });

  it("swaps an existing up vote to down and logs a failed vote", async () => {
    h.listApprovedTricks.mockResolvedValue([trick()]);
    h.getMyTrickVote.mockResolvedValue("up");
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Down (0)" }));
    expect(await screen.findByRole("button", { name: "Up (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Down (1)" })).toHaveAttribute("aria-pressed", "true");
    h.voteTrick.mockRejectedValueOnce(new Error("nope"));
    await userEvent.click(screen.getByRole("button", { name: "Up (1)" }));
    await waitFor(() => expect(h.warn).toHaveBeenCalledWith("trick_vote_failed", expect.anything()));
  });

  it("logs when vote reads fail", async () => {
    h.listApprovedTricks.mockResolvedValue([trick()]);
    h.getTrickScore.mockRejectedValue(new Error("down"));
    renderPage();
    await waitFor(() => expect(h.warn).toHaveBeenCalledWith("trick_votes_read_failed", expect.anything()));
  });

  it("submits a trick, shows my submissions, and surfaces errors", async () => {
    h.submitTrick.mockResolvedValueOnce("new");
    h.listMySubmissions.mockResolvedValue([
      trick({ id: "m1", name: "Heelflip", status: "pending", submittedBy: "u1" }),
      trick({ id: "m2", name: "Bigspin", status: "rejected", submittedBy: "u1" }),
    ]);
    renderPage();
    expect(await screen.findByText("Waiting for review")).toBeInTheDocument();
    expect(screen.getByText("Not added")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Name"), "Varial");
    await userEvent.selectOptions(screen.getByLabelText("Difficulty"), "intermediate");
    await userEvent.type(screen.getByLabelText(/How to do it/), "scoop");
    await userEvent.click(screen.getByRole("button", { name: "Send for review" }));
    expect(await screen.findByText(/Sent for review/)).toBeInTheDocument();
    expect(h.submitTrick).toHaveBeenCalledWith("u1", {
      name: "Varial",
      difficulty: "intermediate",
      description: "scoop",
    });

    h.submitTrick.mockRejectedValueOnce(new Error("Give the trick a name."));
    await userEvent.type(screen.getByLabelText("Name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Send for review" }));
    expect(await screen.findByText("Give the trick a name.")).toBeInTheDocument();

    h.submitTrick.mockRejectedValueOnce("weird");
    await userEvent.click(screen.getByRole("button", { name: "Send for review" }));
    expect(await screen.findByText("Couldn't send that. Try again.")).toBeInTheDocument();
  });

  it("asks unverified users to verify and hides voting", async () => {
    h.listApprovedTricks.mockResolvedValue([trick()]);
    renderPage(false);
    expect(await screen.findByText(/Verify your email to add tricks/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Up/ })).toBeNull();
  });

  it("shows a load error", async () => {
    h.listApprovedTricks.mockRejectedValue(new Error("offline"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the trick library");
  });

  it("lets an admin approve and reject from the review queue", async () => {
    h.isAdmin = true;
    h.listPendingTricks.mockResolvedValue([
      trick({ id: "p1", name: "Impossible", status: "pending" }),
      trick({ id: "p2", name: "Casper", status: "pending" }),
    ]);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Approve Impossible" }));
    await waitFor(() => expect(h.moderateTrick).toHaveBeenCalledWith("u1", "p1", "approved"));
    await userEvent.click(await screen.findByRole("button", { name: "Reject Casper" }));
    await waitFor(() => expect(h.moderateTrick).toHaveBeenCalledWith("u1", "p2", "rejected"));
    expect(await screen.findByText("Nothing waiting.")).toBeInTheDocument();
  });

  it("logs when moderation or the queue fails", async () => {
    h.isAdmin = true;
    h.listPendingTricks.mockResolvedValueOnce([trick({ id: "p3", name: "Darkslide", status: "pending" })]);
    h.moderateTrick.mockRejectedValueOnce(new Error("denied"));
    const { unmount } = renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Approve Darkslide" }));
    await waitFor(() => expect(h.warn).toHaveBeenCalledWith("trick_moderate_failed", expect.anything()));
    unmount();
    h.listPendingTricks.mockRejectedValueOnce(new Error("denied"));
    renderPage();
    await waitFor(() => expect(h.warn).toHaveBeenCalledWith("trick_queue_load_failed", expect.anything()));
  });
});
