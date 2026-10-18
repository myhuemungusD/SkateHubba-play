import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  fetchAnalytics: vi.fn(),
  listAnnouncements: vi.fn(),
  createAnnouncement: vi.fn(),
  endAnnouncement: vi.fn(),
}));
vi.mock("../../../../services/adminInsights", () => ({
  AUDIENCES: ["all", "testers", "pros"],
  TITLE_MAX: 80,
  BODY_MAX: 240,
  ...h,
}));
import { AdminInsightsPanel } from "../AdminInsightsPanel";

const snap = {
  dailyPlayers: 3,
  weeklyPlayers: 10,
  newPlayers7d: 4,
  gamesStarted7d: 12,
  gamesFinished7d: 8,
  clipsPosted7d: 20,
  retention: { cohort: 4, returned: 1 },
  generatedAtMs: 1,
};
const ann = (o: Record<string, unknown> = {}) => ({
  id: "a1",
  title: "Jam",
  body: "Sat",
  audience: "pros",
  push: true,
  active: true,
  pushCount: 5,
  createdAtMs: 1,
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.fetchAnalytics.mockResolvedValue(snap);
  h.listAnnouncements.mockResolvedValue([]);
  h.createAnnouncement.mockResolvedValue("n1");
  h.endAnnouncement.mockResolvedValue(undefined);
});

describe("AnalyticsSection", () => {
  it("shows stats and refreshes", async () => {
    render(<AdminInsightsPanel />);
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
    expect(await screen.findByText("Players today")).toBeInTheDocument();
    expect(screen.getByText("25% of 4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "REFRESH" }));
    await waitFor(() => expect(h.fetchAnalytics).toHaveBeenCalledTimes(2));
  });
  it("shows a dash with an empty cohort and an error on failure", async () => {
    h.fetchAnalytics.mockResolvedValueOnce({ ...snap, retention: { cohort: 0, returned: 0 } });
    const { unmount } = render(<AdminInsightsPanel />);
    expect(await screen.findByText("— of 0")).toBeInTheDocument();
    unmount();
    h.fetchAnalytics.mockRejectedValueOnce(new Error("denied"));
    render(<AdminInsightsPanel />);
    expect(await screen.findByText("Couldn't load analytics.")).toBeInTheDocument();
  });
});

describe("AnnouncementsSection", () => {
  it("lists announcements and ends a live one", async () => {
    h.listAnnouncements.mockResolvedValue([
      ann(),
      ann({ id: "a2", push: false, active: false, audience: "all" }),
      ann({ id: "a3", pushCount: null, audience: "testers" }),
    ]);
    render(<AdminInsightsPanel />);
    expect(await screen.findByText("Verified pros · push to 5 · live")).toBeInTheDocument();
    expect(screen.getByText("Everyone · ended")).toBeInTheDocument();
    expect(screen.getByText("Testers · push · live")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "END" })[0]);
    await waitFor(() => expect(h.endAnnouncement).toHaveBeenCalledWith("a1"));
  });
  it("reports load and end failures", async () => {
    h.listAnnouncements.mockRejectedValueOnce(new Error("x"));
    const { unmount } = render(<AdminInsightsPanel />);
    expect(await screen.findByText("Couldn't load announcements.")).toBeInTheDocument();
    expect(screen.getByText("No announcements yet.")).toBeInTheDocument();
    unmount();
    h.listAnnouncements.mockResolvedValue([ann()]);
    h.endAnnouncement.mockRejectedValueOnce(new Error("x"));
    render(<AdminInsightsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "END" }));
    expect(await screen.findByText("Couldn't end that announcement.")).toBeInTheDocument();
  });
  it("posts a banner without confirming", async () => {
    render(<AdminInsightsPanel />);
    fireEvent.change(screen.getByLabelText("Announcement title"), { target: { value: "Jam" } });
    fireEvent.change(screen.getByLabelText("Announcement message"), { target: { value: "Sat" } });
    fireEvent.change(screen.getByLabelText("Audience"), { target: { value: "testers" } });
    fireEvent.click(screen.getByRole("button", { name: "POST" }));
    await waitFor(() =>
      expect(h.createAnnouncement).toHaveBeenCalledWith({
        title: "Jam",
        body: "Sat",
        audience: "testers",
        push: false,
      }),
    );
    expect(await screen.findByText("Posted as an in-app banner.")).toBeInTheDocument();
  });
  it("confirms before a push and stops if cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<AdminInsightsPanel />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "POST" }));
    expect(h.createAnnouncement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "POST" }));
    expect(await screen.findByText("Posted. Pushes are going out now.")).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });
  it("shows validation messages and a generic failure", async () => {
    h.createAnnouncement.mockRejectedValueOnce(new Error("Title must be 1–80 characters."));
    render(<AdminInsightsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "POST" }));
    expect(await screen.findByText("Title must be 1–80 characters.")).toBeInTheDocument();
    h.createAnnouncement.mockRejectedValueOnce(new Error("permission-denied"));
    fireEvent.click(screen.getByRole("button", { name: "POST" }));
    expect(await screen.findByText("Couldn't post that announcement.")).toBeInTheDocument();
    h.createAnnouncement.mockRejectedValueOnce("x");
    fireEvent.click(screen.getByRole("button", { name: "POST" }));
    await waitFor(() => expect(h.createAnnouncement).toHaveBeenCalledTimes(3));
  });
});
