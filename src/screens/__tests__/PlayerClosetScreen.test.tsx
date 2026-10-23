import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const svc = vi.hoisted(() => ({ fetchLockerItems: vi.fn() }));
const log = vi.hoisted(() => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../services/locker", () => svc);
vi.mock("../../services/logger", () => log);

import { PlayerClosetScreen } from "../PlayerClosetScreen";

function item(id: string, acquiredAt = new Date("2026-03-01")) {
  return {
    id,
    type: "shoes",
    brand: "Brand",
    name: `Shoe ${id}`,
    imageUrl: null,
    rarity: "common",
    acquiredAt,
    provenanceReason: null,
    equipped: false,
    itemDefId: null,
  };
}

function renderAt(uid = "u1", fallback = "/player/u1") {
  return render(
    <MemoryRouter initialEntries={[`/player/${uid}/closet`]}>
      <Routes>
        <Route path="/player/:uid/closet" element={<PlayerClosetScreen uid={uid} backFallback={fallback} />} />
        <Route path="/player/:uid" element={<p>profile page</p>} />
        <Route path="/me" element={<p>my profile</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PlayerClosetScreen", () => {
  beforeEach(() => {
    svc.fetchLockerItems.mockReset();
    log.logger.warn.mockReset();
  });

  it("loads that skater's closet and shows the full grid with a count", async () => {
    svc.fetchLockerItems.mockResolvedValue([item("a", new Date("2026-01-01")), item("b", new Date("2026-05-01"))]);
    renderAt();
    expect(screen.getByRole("status")).toHaveTextContent("Loading closet");
    expect(screen.getByRole("heading", { level: 1, name: "Closet" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("closet-grid")).toBeInTheDocument());
    expect(svc.fetchLockerItems).toHaveBeenCalledWith("u1");
    expect(screen.getByTestId("closet-screen-count")).toHaveTextContent("2 items");
    const cards = document.querySelectorAll("[data-testid^=closet-item-]");
    expect(cards[0]).toHaveAttribute("data-testid", "closet-item-b");
  });

  it("uses the singular count for one item", async () => {
    svc.fetchLockerItems.mockResolvedValue([item("a")]);
    renderAt();
    expect(await screen.findByTestId("closet-screen-count")).toHaveTextContent("1 item");
  });

  it("shows an empty state", async () => {
    svc.fetchLockerItems.mockResolvedValue([]);
    renderAt();
    expect(await screen.findByTestId("closet-screen-empty")).toBeInTheDocument();
    expect(screen.getByTestId("closet-screen-count")).toHaveTextContent("0 items");
  });

  it("shows an error with Retry, and Retry reloads", async () => {
    svc.fetchLockerItems.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([item("a")]);
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the closet.");
    expect(log.logger.warn).toHaveBeenCalledWith("closet_screen_load_failed", expect.any(Object));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("closet-item-a")).toBeInTheDocument();
    expect(svc.fetchLockerItems).toHaveBeenCalledTimes(2);
  });

  it("ignores a load that resolves after unmount", async () => {
    let resolve!: (v: unknown[]) => void;
    svc.fetchLockerItems.mockReturnValue(new Promise((r) => (resolve = r)));
    const { unmount } = renderAt();
    unmount();
    resolve([item("a")]);
    await Promise.resolve();
    expect(screen.queryByTestId("closet-grid")).toBeNull();
  });

  it("ignores a failure that lands after unmount", async () => {
    let reject!: (e: unknown) => void;
    svc.fetchLockerItems.mockReturnValue(new Promise((_, r) => (reject = r)));
    const { unmount } = renderAt();
    unmount();
    reject(new Error("late"));
    await waitFor(() => expect(log.logger.warn).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Back on a cold open returns to the profile it belongs to", async () => {
    svc.fetchLockerItems.mockResolvedValue([]);
    renderAt("u1", "/player/u1");
    fireEvent.click(screen.getByRole("button", { name: "Back to profile" }));
    expect(await screen.findByText("profile page")).toBeInTheDocument();
  });

  it("Back from your own closet returns to /me", async () => {
    svc.fetchLockerItems.mockResolvedValue([]);
    renderAt("me", "/me");
    fireEvent.click(screen.getByTestId("screen-back"));
    expect(await screen.findByText("my profile")).toBeInTheDocument();
  });
});
