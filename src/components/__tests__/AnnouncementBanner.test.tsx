import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  getActiveAnnouncement: vi.fn(),
  dismissedAnnouncements: vi.fn(() => [] as string[]),
  dismissAnnouncement: vi.fn(),
  fetchIsFeatureTester: vi.fn(),
}));
vi.mock("../../services/adminInsights", () => ({
  getActiveAnnouncement: h.getActiveAnnouncement,
  dismissedAnnouncements: h.dismissedAnnouncements,
  dismissAnnouncement: h.dismissAnnouncement,
}));
vi.mock("../../services/featureTesters", () => ({ fetchIsFeatureTester: h.fetchIsFeatureTester }));
import { AnnouncementBanner } from "../AnnouncementBanner";

const ann = { id: "a1", title: "Jam", body: "Saturday", audience: "all" };
beforeEach(() => {
  vi.clearAllMocks();
  h.fetchIsFeatureTester.mockResolvedValue(true);
  h.dismissedAnnouncements.mockReturnValue([]);
});

describe("AnnouncementBanner", () => {
  it("shows the active announcement and dismisses it", async () => {
    h.getActiveAnnouncement.mockResolvedValue(ann);
    render(<AnnouncementBanner uid="u" isPro />);
    expect(await screen.findByText("Saturday")).toBeInTheDocument();
    expect(h.getActiveAnnouncement).toHaveBeenCalledWith({ isPro: true, isTester: true });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss announcement" }));
    expect(h.dismissAnnouncement).toHaveBeenCalledWith("a1");
    expect(screen.queryByTestId("announcement-banner")).toBeNull();
  });
  it("stays hidden when dismissed, empty, failed or unmounted", async () => {
    h.dismissedAnnouncements.mockReturnValue(["a1"]);
    h.getActiveAnnouncement.mockResolvedValue(ann);
    const a = render(<AnnouncementBanner uid="u" isPro={false} />);
    await waitFor(() => expect(h.getActiveAnnouncement).toHaveBeenCalled());
    expect(screen.queryByTestId("announcement-banner")).toBeNull();
    a.unmount();
    h.getActiveAnnouncement.mockResolvedValue(null);
    const b = render(<AnnouncementBanner uid="u" isPro={false} />);
    await waitFor(() => expect(h.getActiveAnnouncement).toHaveBeenCalledTimes(2));
    b.unmount();
    h.getActiveAnnouncement.mockRejectedValue(new Error("x"));
    const c = render(<AnnouncementBanner uid="u" isPro={false} />);
    await waitFor(() => expect(h.getActiveAnnouncement).toHaveBeenCalledTimes(3));
    c.unmount();
    h.getActiveAnnouncement.mockResolvedValue(ann);
    h.dismissedAnnouncements.mockReturnValue([]);
    const d = render(<AnnouncementBanner uid="u" isPro={false} />);
    d.unmount();
    await waitFor(() => expect(h.getActiveAnnouncement).toHaveBeenCalledTimes(4));
    expect(screen.queryByTestId("announcement-banner")).toBeNull();
  });
  it("skips the tester read in the native shell and asks as a non-tester", async () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    try {
      h.getActiveAnnouncement.mockResolvedValue(ann);
      render(<AnnouncementBanner uid="u" isPro={false} />);
      expect(await screen.findByText("Saturday")).toBeInTheDocument();
      expect(h.fetchIsFeatureTester).not.toHaveBeenCalled();
      expect(h.getActiveAnnouncement).toHaveBeenCalledWith({ isPro: false, isTester: false });
    } finally {
      delete (globalThis as { Capacitor?: unknown }).Capacitor;
    }
  });
});
