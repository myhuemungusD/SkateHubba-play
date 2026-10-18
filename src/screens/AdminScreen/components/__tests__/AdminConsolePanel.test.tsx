import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  listBans: vi.fn(),
  searchUsers: vi.fn(),
  getUserSummary: vi.fn(),
  getFeatureTesterUids: vi.fn(),
  unbanUser: vi.fn(),
}));
vi.mock("../../../../services/admin.console", () => h);
vi.mock("../../../../services/admin.bans", () => ({ unbanUser: h.unbanUser }));

import { AdminConsolePanel } from "../AdminConsolePanel";

beforeEach(() => {
  vi.clearAllMocks();
  h.listBans.mockResolvedValue([]);
  h.getFeatureTesterUids.mockResolvedValue([]);
});

describe("AdminConsolePanel", () => {
  it("lists bans and lifts one", async () => {
    h.listBans
      .mockResolvedValueOnce([
        { uid: "u1", username: "kid", bannedBy: "a", bannedByUsername: "boss", reason: "spam", bannedAtMs: 1 },
        { uid: "u2", username: "", bannedBy: "", bannedByUsername: "", reason: "", bannedAtMs: null },
      ])
      .mockResolvedValueOnce([]);
    h.unbanUser.mockResolvedValue(undefined);
    render(<AdminConsolePanel />);
    expect(await screen.findByText("@kid")).toBeInTheDocument();
    expect(screen.getByText("@u2")).toBeInTheDocument();
    expect(screen.getByText(/By @unknown/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "LIFT BAN" })[0]);
    expect(await screen.findByText("Nobody is banned.")).toBeInTheDocument();
    expect(h.unbanUser).toHaveBeenCalledWith("u1");
  });

  it("shows ban load and lift errors", async () => {
    h.listBans.mockRejectedValueOnce(new Error("x"));
    const { unmount } = render(<AdminConsolePanel />);
    expect(await screen.findByText("Couldn't load bans.")).toBeInTheDocument();
    unmount();
    h.listBans.mockResolvedValue([
      { uid: "u1", username: "kid", bannedBy: "", bannedByUsername: "", reason: "", bannedAtMs: null },
    ]);
    h.unbanUser.mockRejectedValue(new Error("no"));
    render(<AdminConsolePanel />);
    fireEvent.click(await screen.findByRole("button", { name: "LIFT BAN" }));
    expect(await screen.findByText("Couldn't lift that ban.")).toBeInTheDocument();
  });

  it("searches users and opens a summary", async () => {
    h.searchUsers.mockResolvedValue([{ uid: "m", username: "mike" }]);
    h.getUserSummary.mockResolvedValueOnce({
      uid: "m",
      username: "mike",
      wins: 2,
      losses: 1,
      isVerifiedPro: true,
      isBanned: true,
      reportsAgainst: 3,
      openReportsAgainst: 1,
      badges: 5,
    });
    render(<AdminConsolePanel />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "mi" } });
    fireEvent.click(screen.getByRole("button", { name: "SEARCH" }));
    fireEvent.click(await screen.findByRole("button", { name: "@mike" }));
    expect(await screen.findByTestId("user-summary")).toHaveTextContent("Verified pro, Banned");
    expect(screen.getByText("3 (1 open)")).toBeInTheDocument();
  });

  it("handles empty, missing and failing searches", async () => {
    h.searchUsers.mockResolvedValueOnce([]);
    render(<AdminConsolePanel />);
    fireEvent.click(screen.getByRole("button", { name: "SEARCH" }));
    expect(await screen.findByText("No players match.")).toBeInTheDocument();
    h.searchUsers.mockRejectedValueOnce(new Error("x"));
    fireEvent.click(screen.getByRole("button", { name: "SEARCH" }));
    expect(await screen.findByText("Search failed.")).toBeInTheDocument();
    h.searchUsers.mockResolvedValue([{ uid: "m", username: "mike" }]);
    fireEvent.click(screen.getByRole("button", { name: "SEARCH" }));
    h.getUserSummary.mockResolvedValueOnce(null);
    fireEvent.click(await screen.findByRole("button", { name: "@mike" }));
    expect(await screen.findByText("That player has no profile.")).toBeInTheDocument();
    h.getUserSummary.mockRejectedValueOnce(new Error("x"));
    fireEvent.click(screen.getByRole("button", { name: "@mike" }));
    expect(await screen.findByText("Couldn't load that player.")).toBeInTheDocument();
    h.getUserSummary.mockResolvedValueOnce({
      uid: "m",
      username: "mike",
      wins: 0,
      losses: 0,
      isVerifiedPro: false,
      isBanned: false,
      reportsAgainst: 0,
      openReportsAgainst: 0,
      badges: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "@mike" }));
    expect(await screen.findByTestId("user-summary")).toHaveTextContent("Active");
  });

  it("shows feature switches and testers", async () => {
    h.getFeatureTesterUids.mockResolvedValue(["j", "m"]);
    render(<AdminConsolePanel />);
    expect(screen.getByText("Testers: loading…")).toBeInTheDocument();
    expect(await screen.findByText("Testers: j, m")).toBeInTheDocument();
    expect(screen.getAllByText("Tester-only").length).toBeGreaterThan(0);
  });

  it("shows none when there are no testers and ignores late results", async () => {
    render(<AdminConsolePanel />);
    expect(await screen.findByText("Testers: none")).toBeInTheDocument();
    let done: (v: string[]) => void = () => {};
    h.getFeatureTesterUids.mockReturnValue(new Promise((r) => (done = r)));
    const { unmount } = render(<AdminConsolePanel />);
    unmount();
    done(["x"]);
    await waitFor(() => expect(h.getFeatureTesterUids).toHaveBeenCalledTimes(2));
  });
});
